/**
 * background.js
 * Service worker for Zealer Dashboard
 * Data is fetched on panel open (not on a background timer).
 * This service worker handles: data fetching, alert rules, toolbar badge, notifications.
 */

import * as jiraAPI from './src/jira-api.js';
import * as sentryAPI from './src/sentry-api.js';
import * as alerts from './src/alerts.js';
import { parseExtraBoardSpec, parseSentryViewSpec, parseSentryUrl, normalizeStory, isStoryDone, normalizeBug } from './src/parsers.js';
import { attachCloseTimestamps, dayIndex, estimateAtSprintStart, sprintAddDay, createdDayAfterStart } from './src/changelog-parser.js';
import { buildUsageEnvelope, buildErrorEnvelope, buildTransactionEnvelope, sendEnvelope } from './src/usage-telemetry.js';
import { computeBurndownSeries } from './src/burndown.js';
import { extractWorklogs, computeTimesheet, sortTimesheetMembers } from './src/timesheet.js';
import { setCachedSprintData, detectSprintChange } from './src/sprint-cache.js';
import { buildMilestoneData } from './src/milestones.js';
import { countReopens } from './src/bug-reports.js';
import { runMigrations } from './src/migrations.js';
import { recordTrendSample, getTrendSamples } from './src/sentry-trend.js';
import { extractWorklogsFromIssues, aggregateWorklogs, aggregateByIssueType } from './src/worklog-aggregator.js';

// Run data migrations on service worker init (idempotent — flagged per migration)
runMigrations().catch(err => console.warn('[background] Migration failed:', err.message));

// ── Usage + error telemetry (Sentry) ─────────────────────────────────────
// Sends telemetry to the `zealer-dashboard` Sentry project via its HTTP
// envelope endpoint (no SDK — see src/usage-telemetry.js for why). This project
// holds BOTH usage and errors; every event carries an `event_type` tag so they
// filter apart in Sentry. Identity (email) is attached the sanctioned way via
// the event `user` field. Fire-and-forget; never blocks or breaks the dashboard.
//
// The DSN is a write-only PUBLIC ingestion key (safe to ship in the client).
const SENTRY_DSN = 'https://d37912f11b66e35d67727fd9e4ddff10@o164516.ingest.us.sentry.io/4511565732773888';

/** Build the Sentry `user` object from the resolved Jira identity. */
function telemetryUser(currentUser) {
  if (!currentUser) return undefined;
  const u = {};
  if (currentUser.emailAddress) u.email = currentUser.emailAddress;
  if (currentUser.accountId)    u.id = currentUser.accountId;
  if (currentUser.displayName)  u.username = currentUser.displayName;
  return Object.keys(u).length ? u : undefined;
}

/** Common event context (release, environment, identity, squad/role tags). */
function telemetryContext(currentUser, settings) {
  return {
    user: telemetryUser(currentUser),
    release: chrome.runtime.getManifest().version,
    tags: {
      role:  settings?.role || '',
      squad: settings?.squad?.key || '',
    },
  };
}

/**
 * Fire an `app_opened` usage event the first time a user's Jira identity is
 * known in a session. Replaces the old Google-Form/Sheet ping.
 */
async function maybeLogUsage(currentUser, settings) {
  if (!currentUser?.accountId && !currentUser?.emailAddress) {
    console.log('[telemetry] no Jira identity resolved yet — skip'); return;
  }
  try {
    // Once per browser session (cleared when the SW restarts). We intentionally
    // log per session rather than once-ever so we can see active usage over time.
    const { telemetrySessionLogged } = await chrome.storage.session.get('telemetrySessionLogged');
    if (telemetrySessionLogged) return;

    const ctx = telemetryContext(currentUser, settings);
    const envelope = buildUsageEnvelope('app_opened', ctx);
    const ok = await sendEnvelope(SENTRY_DSN, envelope);
    if (ok) {
      console.log('[telemetry] app_opened sent ✓ for', ctx.user?.email || ctx.user?.id);
      chrome.storage.session.set({ telemetrySessionLogged: true });
    }
  } catch (err) {
    console.warn('[telemetry] app_opened error (ignored):', err?.message);
  }
}

/** Track a feature/section view (gantt, timesheet, insights, boards). */
async function trackSectionView(section, currentUser, settings) {
  try {
    const ctx = telemetryContext(currentUser, settings);
    ctx.tags = { ...ctx.tags, section };
    await sendEnvelope(SENTRY_DSN, buildUsageEnvelope('section_viewed', ctx));
  } catch (err) {
    console.warn('[telemetry] section_viewed error (ignored):', err?.message);
  }
}

/** Capture a handled failure as a Sentry error event. */
async function trackError(message, currentUser, settings, extra = {}) {
  try {
    const ctx = telemetryContext(currentUser, settings);
    ctx.extra = extra;
    await sendEnvelope(SENTRY_DSN, buildErrorEnvelope(message, ctx));
  } catch (err) {
    console.warn('[telemetry] error-capture failed (ignored):', err?.message);
  }
}

/**
 * Initialize on extension install/update
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[background] Zealer Dashboard installed/updated');
  
  // Configure side panel to open on action click
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log('[background] Side panel configured to open on click');
  
  // Clear any previously registered alarms (cleanup from old versions)
  await chrome.alarms.clearAll();
  console.log('[background] Background alarms cleared — data fetches on panel open only');
});

/**
 * Configure side panel on startup (when Chrome restarts)
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[background] Zealer Dashboard starting up');
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Clear any stale alarms from old versions
  await chrome.alarms.clearAll();
});

/**
 * Merge {accountId, name} roster entries. Normalizes legacy string entries,
 * dedupes by accountId (preferred) then by name, and collapses a legacy
 * name-only entry once a matching accountId is discovered. Returns objects.
 */
function mergeRoster(existing, additions) {
  const norm = d => (typeof d === 'string')
    ? { accountId: null, name: d }
    : { accountId: d.accountId || null, name: d.name || '' };
  const byId = new Map();   // accountId -> {accountId,name}
  const byName = new Map(); // name -> {accountId:null,name} (only when no accountId)
  const put = (r0) => {
    const r = norm(r0);
    if (!r.accountId && !r.name) return;
    if (r.accountId) {
      const prev = byId.get(r.accountId);
      byId.set(r.accountId, { accountId: r.accountId, name: r.name || prev?.name || '' });
      if (r.name) byName.delete(r.name); // collapse legacy name-only duplicate
    } else if (![...byId.values()].some(e => e.name === r.name)) {
      byName.set(r.name, r);
    }
  };
  for (const r of (existing || []))  put(r);
  for (const r of (additions || [])) put(r);
  return [...byId.values(), ...byName.values()];
}

/**
 * Main dashboard check routine
 * Fetches data from Jira + Sentry, runs alert rules, updates badge
 */
async function checkDashboard() {
  try {
    // Check if credentials are configured
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings;
    
    // Jira credentials are the minimum requirement to start loading data.
    // Sentry is optional — missing Sentry just means the reliability section stays empty.
    if (!settings?.jira?.token || !settings?.jira?.email || !settings?.jira?.baseUrl) {
      console.log('[background] Jira credentials not configured, skipping check');
      return;
    }
    
    console.log('[background] Fetching data...');
    
    // Build shared state
    const state = {
      sprintHistory: [], currentSprint: null,
      supportTickets: [], sentryIssues: [],
      sentryViews: [], slaHours: 48
    };

    /**
     * Save whatever is currently in state to storage and notify the popup.
     * Called after EACH source completes so the popup updates incrementally.
     */
    async function saveAndNotify(source) {
      await chrome.storage.local.set({
        sprintHistory: state.sprintHistory,
        currentSprint: state.currentSprint,
        supportTickets: state.supportTickets,
        sentryIssues: state.sentryIssues,
        sentryViews: state.sentryViews || [],
        extraBoardsData: state.extraBoardsData || [],
        milestonesData: state.milestonesData || [],
        bugReports: state.bugReports || { bugs: [], sprintWindows: [] }
      });
      // Push to popup if it is open (ignore error if not)
      chrome.runtime.sendMessage({ type: 'partial-update', source })
        .catch(() => {});
      console.log(`[background] Saved + notified popup (source: ${source})`);
    }

    // Launch both fetches concurrently but handle each as it resolves
    const _jiraFetchStart = Date.now();
    const jiraPromise = fetchJiraData(settings)
      .then(async data => {
        state.sprintHistory   = data.sprintHistory   || [];
        state.currentSprint   = data.currentSprint   || null;
        state.supportTickets  = data.supportTickets  || [];
        state.extraBoardsData = data.extraBoardsData || [];
        state.milestonesData  = data.milestonesData  || [];
        state.bugReports      = data.bugReports       || { bugs: [], sprintWindows: [] };
        if (data.currentUser) {
          state.currentUser = data.currentUser;
          await chrome.storage.local.set({ currentUser: data.currentUser });
          // Make identity available to telemetry message handlers (section/timing).
          chrome.storage.session.set({ lastCurrentUser: data.currentUser });
          maybeLogUsage(data.currentUser, settings);   // app_opened (once per session)
        } else {
          // Loud log: this was a silent skip path — if you see this, Jira's
          // /myself call failed or returned nothing, so no usage ping fires.
          console.warn('[telemetry] SKIPPED — fetchJiraData returned no currentUser (getCurrentUser failed?)');
        }
        await saveAndNotify('jira');
        // Performance: record the Jira fetch as a Sentry transaction.
        if (data.currentUser) {
          try {
            const ctx = telemetryContext(data.currentUser, settings);
            const env = buildTransactionEnvelope('jira.fetch', {
              ...ctx, startMs: _jiraFetchStart, endMs: Date.now(),
              spans: [{ op: 'http.client', description: 'fetchJiraData', startMs: _jiraFetchStart, endMs: Date.now() }],
            });
            sendEnvelope(SENTRY_DSN, env);
          } catch (e) { console.warn('[telemetry] jira.fetch txn failed (ignored):', e?.message); }
        }
      })
      .catch(err => {
        console.error('[background] Jira fetch failed:', err.message);
        // Report to Sentry telemetry — a failing Jira fetch is the core data
        // path breaking; capture it as queryable signal, not just a console log.
        (async () => {
          try {
            const { lastCurrentUser } = await chrome.storage.session.get('lastCurrentUser');
            const ctx = telemetryContext(lastCurrentUser, settings);
            ctx.extra = { reason: err.message };
            await sendEnvelope(SENTRY_DSN, buildErrorEnvelope('Jira fetch failed', ctx));
          } catch { /* never let telemetry break the catch */ }
        })();
      });

    const sentryPromise = fetchSentryData(settings)
      .then(async data => {
        state.sentryIssues = data.issues      || [];
        state.sentryViews  = data.viewResults || [];
        await saveAndNotify('sentry');
      })
      .catch(err => console.warn('[background] Sentry fetch failed (non-fatal — dashboard works without Sentry):', err.message));

    // Wait for both to finish before running alert rules + badge
    await Promise.allSettled([jiraPromise, sentryPromise]);
    
    // Enrich state for alert rules: settings (workingDays etc.) and per-view
    // Sentry trend samples (for day-over-day spike detection).
    state.settings = settings;
    state.sentryTrendSamples = {};
    try {
      for (const view of (state.sentryViews || [])) {
        const months = await getTrendSamples(view.viewId, 2);
        const today = new Date().toISOString().slice(0, 10);
        const cutoff = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
        const flat = months
          .flatMap(m => (m.samples || []).map(s => ({
            date: `${m.yearMonth}-${String(s.day).padStart(2, '0')}`,
            count: s.count
          })))
          .filter(s => s.date >= cutoff && s.date < today)
          .sort((a, b) => a.date.localeCompare(b.date));
        state.sentryTrendSamples[view.viewId] = flat;
      }
    } catch (e) { console.warn('[background] sentryTrendSamples read failed:', e.message); }

    // Run alert rules over complete state
    const newAlerts = alerts.checkAlerts(state);
    console.log(`[background] ${newAlerts.length} new alerts fired`);
    
    const existingResult = await chrome.storage.local.get(['alerts']);
    const existingAlerts = existingResult.alerts || [];
    const mergedAlerts = alerts.mergeAlerts(existingAlerts, newAlerts);
    
    await chrome.storage.local.set({ alerts: mergedAlerts });
    await updateBadge(mergedAlerts);
    await notifyHighSeverity(newAlerts, settings);
    
    await chrome.storage.local.set({
      cache: { lastFetch: { jira: Date.now(), sentry: Date.now() } }
    });
    
    console.log('[background] Dashboard check complete');
    
  } catch (error) {
    console.error('[background] Dashboard check failed:', error);
    throw error; // Re-throw so message handler reports to popup
  }
}

/**
 * Fetch Jira data
 */
async function fetchJiraData(settings) {
  const client = new jiraAPI.JiraClient(
    settings.jira.baseUrl,
    settings.jira.email,
    settings.jira.token
  );

  // Fetch current user early — needed for engineer "me" scope
  let currentUser = null;
  try {
    currentUser = await client.getCurrentUser();
    console.log(`[background] Current user: ${currentUser.displayName} (${currentUser.accountId})`);
  } catch (e) {
    console.warn('[background] getCurrentUser failed:', e.message);
  }

  // Squad key — required for all Jira queries
  const squadKey = settings.squad?.key;

  if (!squadKey) {
    throw new Error('Squad project key not configured');
  }
  
  console.log(`[background] Jira fetch for project ${squadKey} (auto-discover board)`);
  
  // Always auto-discover main board from project key
  const { currentSprint, boardId, storyPointsField } = await fetchCurrentSprint(client, settings, squadKey);
  
  // Sprint history
  const sprintHistory = await fetchSprintHistory(client, boardId);

  // Support tickets
  const supportTickets = await fetchSupportTickets(client, squadKey);

  // Milestones (OKRs / Dev Plans) — backlog tickets grouped by label.
  const milestonesData = await fetchMilestones(client, settings, squadKey, storyPointsField);

  // Extra boards — fetch active sprint + stories for each
  const extraBoardsData = await fetchExtraBoards(client, settings, squadKey, storyPointsField);
  console.log(`[background] fetchJiraData returning with ${extraBoardsData.length} extra board(s)`);

  // Bug reports (T-BR-1) — squad bugs + last 6 sprint windows for the trend.
  const bugReports = await fetchBugReports(client, squadKey, boardId);

  return { sprintHistory, currentSprint, supportTickets, extraBoardsData, milestonesData, currentUser, bugReports };
}

/**
 * Current sprint — the core fetch: active sprint, stories, points, changelog
 * close-dates, sprint-day geometry, committed-scope reconstruction, subtasks,
 * burndown/timesheet analytics, roster discovery, sprint-change detection, and
 * cache write. Returns the three values the rest of the orchestrator depends on:
 * { currentSprint, boardId, storyPointsField }.
 *
 * IMPORTANT (TDZ): the internal ordering is load-bearing and unchanged from the
 * original inline block — sprint-day geometry (totalDays etc.) MUST be computed
 * before the committed-scope loop that clamps against it. Do not reorder.
 *
 * Whole body is wrapped in a non-fatal try/catch: on any failure it returns the
 * default no-sprint values (currentSprint=null) so the dashboard shows the
 * no-sprint state instead of dying.
 */
async function fetchCurrentSprint(client, settings, squadKey) {
  let currentSprint = null;
  let boardId = null;
  let storyPointsField = 'customfield_10016'; // default, overridden by board config
  try {
    console.log(`[background] Auto-discovering board for ${squadKey}...`);
    const activeSprint = await client.getActiveSprintByProject(squadKey);
    boardId = activeSprint.boardId;
    console.log(`[background] Auto-discovered board: ${activeSprint.boardName} (id=${boardId})`);
    console.log('[background] Active sprint:', activeSprint.name, 'id=' + activeSprint.id);
    
    // Auto-detect story points field from board configuration
    storyPointsField = await client.getStoryPointsField(boardId);
    console.log(`[background] Story points field: ${storyPointsField}`);
    
    const stories = await client.getSprintStories(
      activeSprint.id, squadKey, storyPointsField,
      { withChangelog: true }
    );
    console.log(`[background] Fetched ${stories.length} stories from sprint (with changelog+worklogs)`);
    
    // Extract story points using detected field + common fallbacks
    const POINT_FIELDS = [storyPointsField, 'customfield_10016', 'customfield_10026', 'customfield_10004'];
    const getPoints = (story) => {
      for (const f of POINT_FIELDS) {
        const v = story.fields?.[f];
        if (typeof v === 'number' && v >= 0) return v;
      }
      return 0;
    };
    
    const totalPoints = stories.reduce((sum, s) => sum + getPoints(s), 0);
    const completedStories = stories.filter(s => {
      const statusName = (s.fields.status?.name || '').toLowerCase();
      const statusCat = (s.fields.status?.statusCategory?.key || '').toLowerCase();
      return statusCat === 'done' || statusName === 'done' || statusName === 'closed' || statusName === 'resolved';
    });
    const completedPoints = completedStories.reduce((sum, s) => sum + getPoints(s), 0);
    
    // Normalize stories using tested normalizeStory from parsers.js
    const baseStories = stories.map(s => normalizeStory(s, storyPointsField));
    
    // Attach changelog close timestamps for burndown actual line
    const withChangelog = attachCloseTimestamps(stories, baseStories, activeSprint.startDate);
    
    // Fallback: if a story is in done status but has no changelog close date,
    // use the `updated` field — it's the last time the ticket changed state
    const normalizedStories = withChangelog.map((story, i) => {
      if (story.closedAt === null && story.statusCategory === 'done') {
        const raw = stories[i];
        const updated = raw?.fields?.updated;
        if (updated) {
          const closeDay = dayIndex(updated, activeSprint.startDate);
          return { ...story, closedAt: updated, closedDay: Math.max(0, closeDay) };
        }
      }
      return story;
    });
    
    console.log(`[background] Stories with close dates: ${normalizedStories.filter(s=>s.closedAt).length}/${normalizedStories.length}`);

    // ── Sprint day geometry — MUST be computed BEFORE the scope loop below:
    // addScope() clamps with totalDays, and const TDZ means the first real
    // scope change would otherwise throw "Cannot access 'totalDays' before
    // initialization" and silently kill the whole sprint fetch (popup then
    // renders stale cache with no scope step anywhere).
    const startDate = activeSprint.startDate ? new Date(activeSprint.startDate) : new Date();
    const endDate = activeSprint.endDate ? new Date(activeSprint.endDate) : new Date();
    const now = new Date();

    // Calendar-date based (matches changelog-parser.dayIndex), so the burndown's
    // "today" and each ticket's close day are measured the same way. Raw 24h
    // windows broke this when sprints start mid-afternoon.
    const totalDays = Math.max(1, dayIndex(activeSprint.endDate || now.toISOString(), activeSprint.startDate || now.toISOString()));
    const todayCalIdx = Math.max(0, Math.min(dayIndex(now.toISOString(), activeSprint.startDate || now.toISOString()), totalDays));
    const daysElapsed = Math.min(todayCalIdx + 1, totalDays); // 1-based for the "Day X of Y" header

    // ── Committed baseline + scope changes ────────────────────────────
    // Reconstruct the sprint-start committed scope from changelogs so the
    // burndown matches Jira: estimate changes and mid-sprint additions are shown
    // as scope-change steps rather than silently rebasing the guideline.
    let committedPoints = 0;
    const scopeByDay = {}; // { [dayIndex]: { added, removed, estimateDelta } }
    const addScope = (day, field, pts) => {
      const d = Math.max(0, Math.min(day, totalDays));
      if (!scopeByDay[d]) scopeByDay[d] = { added: 0, removed: 0, estimateDelta: 0 };
      scopeByDay[d][field] += pts;
    };

    for (let i = 0; i < normalizedStories.length; i++) {
      const story = normalizedStories[i];
      const raw   = stories[i];
      const currentPts = story.points || 0;

      // Was this issue added to the sprint after it started?
      // A ticket is a mid-sprint scope addition when EITHER:
      //  (a) the changelog shows it was moved INTO this sprint after start, OR
      //  (b) it was CREATED after the sprint started — tickets created directly
      //      inside an active sprint have NO Sprint changelog entry at all
      //      (sprint set at creation), which is how additions were silently
      //      absorbed into the committed baseline. Jira flags created>start
      //      as scope; now we do too.
      const addedDay = sprintAddDay(raw, activeSprint.startDate, activeSprint.id)
                    ?? createdDayAfterStart(raw, activeSprint.startDate);
      if (addedDay !== null) {
        if (currentPts > 0) {
          addScope(addedDay, 'added', currentPts);
        }
        continue; // not part of the committed baseline
      }

      // Sprint-start estimate (or current if no estimate changes after start).
      const { startEst, changeDayAfterStart } = estimateAtSprintStart(raw, activeSprint.startDate, storyPointsField);
      const baselinePts = startEst !== null ? startEst : currentPts;
      committedPoints += baselinePts;

      // Estimate was changed mid-sprint → treat as a scope change on that day.
      if (startEst !== null && currentPts !== startEst) {
        const delta = currentPts - startEst;
        addScope(changeDayAfterStart ?? 0, 'estimateDelta', delta);
      }
    }

    // Safety: fall back to live total if reconstruction produced 0 (e.g. no changelog).
    if (committedPoints === 0) committedPoints = totalPoints;

    // Subtasks — Gantt-only (separate fetch so points never double-count
    // into the burndown/committed baseline). Non-fatal on failure.
    let sprintSubtasks = [];
    try {
      const rawSubs = await client.getSprintSubtasks(activeSprint.id, squadKey, storyPointsField);
      sprintSubtasks = rawSubs.map(i => normalizeStory(i, storyPointsField));
      console.log(`[background] Sprint subtasks for Gantt: ${sprintSubtasks.length}`);
    } catch (subErr) {
      console.warn('[background] Subtask fetch skipped (non-fatal):', subErr.message);
    }

    currentSprint = {
      id: activeSprint.id,
      name: activeSprint.name,
      boardId,
      boardName: activeSprint.boardName,
      startDate: activeSprint.startDate,
      endDate: activeSprint.endDate,
      totalStories: stories.length,
      completedStories: completedStories.length,
      totalPoints,
      completedPoints,
      committedPoints,
      totalDays,
      daysElapsed,
      todayIndex: todayCalIdx,
      scopeByDay,
      stories: normalizedStories,
      subtasks: sprintSubtasks
    };
    console.log('[background] Current sprint:', currentSprint.name, `${totalPoints}pt/${totalDays}d`);
    
    // Compute and cache sprint analytics (burndown + timesheet)
    try {
      const workingDays = settings.ui?.workingDays || [0, 1, 2, 3, 4]; // Sun-Thu default
      
      // Burndown — todayIndex is the calendar-date index of "now" (same basis
      // as each ticket's closedDay), so today's closures land on today's point.
      const burndown = computeBurndownSeries(
        { startDate: activeSprint.startDate, totalDays, totalPoints, committedPoints, scopeByDay, daysElapsed, todayIndex: todayCalIdx },
        normalizedStories
      );
      
      // Timesheet — fetch worklogs across ALL projects (boards) for the squad.
      // Author list = sprint assignees ∪ persisted roster, so the cross-project
      // worklogAuthor query runs even early in a sprint when tickets are still
      // unassigned (previously that fell back to a project-scoped query that
      // could only ever show the squad's own board — e.g. HRM but never ATH).
      let allWorklogs = [];
      try {
        const assigneeIds = [...new Set(
          (stories || [])
            .map(s => s.assigneeAccountId)
            .filter(Boolean)
        )];
        const rosterIds = (settings.analytics?.discoveredMembers || [])
          .map(m => (typeof m === 'string' ? null : m.accountId))
          .filter(Boolean);
        let accountIds = [...new Set([...assigneeIds, ...rosterIds])];

        let issues = [];
        // Slice to YYYY-MM-DD — Jira sprint dates are ISO datetime strings
        const wlStart = (activeSprint.startDate || '').slice(0, 10);
        const wlEnd   = (activeSprint.endDate   || '').slice(0, 10);

        if (!wlStart || !wlEnd) {
          console.warn('[background] Sprint has no startDate/endDate — skipping worklog fetch');
        } else {
          if (accountIds.length === 0) {
            // Discovery pass (fresh install, empty roster): who logged time on
            // the squad's own board this sprint? Their IDs then drive the
            // cross-project query below.
            console.warn('[background] No assignees or roster — running project-scoped discovery pass');
            const jql = `project = "${squadKey}" AND worklogDate >= "${wlStart}" AND worklogDate <= "${wlEnd}"`;
            const result = await client._search({
              jql,
              fields: ['worklog','project','issuetype','priority','timeoriginalestimate','summary'],
              maxResults: 200,
            });
            const discoveryIssues = result.issues || [];
            const discoveredIds = [...new Set(
              extractWorklogsFromIssues(discoveryIssues, [], wlStart, wlEnd)
                .map(w => w.authorId)
                .filter(Boolean)
            )];
            console.log(`[background] Discovery pass: ${discoveredIds.length} authors on ${squadKey} this sprint`);
            accountIds = discoveredIds;
            issues = discoveryIssues; // final fallback if even discovery found nobody
          }

          if (accountIds.length > 0) {
            // Cross-project query by author IDs — captures time on ANY board
            const worklogPromise = client.getTeamWorklogs(accountIds, wlStart, wlEnd);
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Worklog fetch timeout after 15s')), 15000)
            );
            issues = await Promise.race([worklogPromise, timeoutPromise]);
            console.log(`[background] Cross-project worklogs: ${issues.length} issues for ${accountIds.length} members`);
          }
        }

        allWorklogs = extractWorklogsFromIssues(
          issues, accountIds, wlStart, wlEnd
        );
        console.log(`[background] Sprint worklogs: ${allWorklogs.length} entries across ${new Set(allWorklogs.map(w=>w.projectKey)).size} projects`);
      } catch (wlErr) {
        console.warn('[background] Worklog fetch skipped (non-fatal):', wlErr.message);
      }
      
      const timesheetRaw = aggregateWorklogs(allWorklogs);
      const timesheet = timesheetRaw.sort((a, b) => b.total - a.total);
      const issueTypeSplit = aggregateByIssueType(allWorklogs);
      
      // Persist a discovered-member ROSTER ({accountId, name}) so the filter can
      // key on accountId (stable) while showing display names. Discover from BOTH
      // worklog authors AND sprint assignees so the filter shows the whole team,
      // not only those who have logged time.
      const rosterAdditions = [
        ...timesheet.map(m => ({ accountId: m.accountId, name: m.name })),
        ...(normalizedStories || []).map(s => ({ accountId: s.assigneeAccountId, name: s.assignee })),
      ].filter(r => r.accountId || r.name);

      if (rosterAdditions.length > 0) {
        const settingsResult = await chrome.storage.local.get(['settings']);
        const currentSettings = settingsResult.settings || {};
        // When an EM has manually curated the squad list, respect that choice
        // and don't auto-add newly discovered members on top of it.
        if (currentSettings.analytics?.squadMembersCurated) {
          console.log('[background] Squad members curated by EM — skipping auto-discovery update');
        } else {
          const existing = currentSettings.analytics?.discoveredMembers || [];
          const merged = mergeRoster(existing, rosterAdditions);
          if (JSON.stringify(merged) !== JSON.stringify(existing.map(d => typeof d === 'string' ? { accountId: null, name: d } : d))) {
            await chrome.storage.local.set({
              settings: {
                ...currentSettings,
                analytics: { ...currentSettings.analytics, discoveredMembers: merged }
              }
            });
            console.log(`[background] Discovered ${merged.length} team members (roster) for timesheet`);
          }
        }
      }
      
      // Detect sprint change (notify popup if sprint rotated)
      const oldSprintName = await detectSprintChange(activeSprint.name);
      if (oldSprintName) {
        console.log(`[background] Sprint changed: "${oldSprintName}" → "${activeSprint.name}"`);
        chrome.runtime.sendMessage({
          type: 'sprint-changed',
          oldSprintName,
          newSprintName: activeSprint.name
        }).catch(() => {}); // popup may not be open
      }
      
      // Save to cache
      await setCachedSprintData(activeSprint.name, {
        burndown,
        timesheet,
        issueTypeSplit,
        sprintId: activeSprint.id,
        totalDays,
        startDate: (activeSprint.startDate || '').slice(0, 10),
        endDate:   (activeSprint.endDate   || '').slice(0, 10),
      });
      
      console.log(`[background] Analytics cached for "${activeSprint.name}": burndown hasActual=${burndown.hasActualData}, members=${timesheet.length}`);
    } catch (analyticsErr) {
      console.warn('[background] Analytics computation failed (non-fatal):', analyticsErr.message);
    }
  } catch (err) {
    console.warn('[background] Failed to fetch active sprint (non-fatal — shows no-sprint state):', err.message);
  }

  return { currentSprint, boardId, storyPointsField };
}

// ── fetchJiraData section helpers (S-5) ──────────────────────────────────
// Extracted from the fetchJiraData orchestrator to keep each concern named and
// readable. Each is a self-contained fetch with its own non-fatal try/catch;
// behaviour is identical to the previous inline blocks.

/** Recent closed sprints for the history view (non-fatal). */
async function fetchSprintHistory(client, boardId) {
  if (!boardId) return [];
  try {
    return await client.getSprintHistory(boardId, 5);
  } catch (err) {
    console.warn('[background] Failed to fetch sprint history:', err.message);
    return [];
  }
}

/** Support tickets for the squad (non-fatal). */
async function fetchSupportTickets(client, squadKey) {
  try {
    return await client.getSupportTickets(squadKey);
  } catch (err) {
    console.warn('[background] Failed to fetch support tickets:', err.message);
    return [];
  }
}

/**
 * Milestones (OKRs / Dev Plans) — backlog tickets grouped by configured label.
 * One JQL for all labels; progress is by ticket count. Non-fatal.
 */
async function fetchMilestones(client, settings, squadKey, storyPointsField) {
  const milestoneConfigs = settings.milestones || [];
  if (milestoneConfigs.length === 0) return [];
  try {
    const labelList = milestoneConfigs.map(m => `"${m.label}"`).join(',');
    const jql = `project = "${squadKey}" AND labels in (${labelList}) AND issuetype not in subTaskIssueTypes() ORDER BY created ASC`;
    const result = await client._search({
      jql,
      fields: ['summary','status','assignee','issuetype','priority',
               storyPointsField,'customfield_10016','customfield_10026',
               'duedate','labels'],
      maxResults: 200,
    });
    const msTickets = (result.issues || []).map(i => normalizeStory(i, storyPointsField));
    const milestonesData = buildMilestoneData(milestoneConfigs, msTickets);
    console.log(`[background] Milestones: ${milestonesData.length} configured, ${msTickets.length} labelled tickets`);
    return milestonesData;
  } catch (msErr) {
    console.warn('[background] Milestones fetch failed (non-fatal):', msErr.message);
    return milestoneConfigs.map(m => ({ ...m, tickets: [], error: msErr.message }));
  }
}

/**
 * Bug reports (T-BR-1). Fetches the squad's bugs (issue type Bug / QA Bug) plus
 * the last 6 closed sprint windows for the incoming-vs-resolved trend. Returns
 * raw material; the popup computes the per-scope metrics (squad vs my bugs) and
 * renders. Non-fatal — a failure yields an empty, render-safe shape.
 * @returns {{ bugs: Array, sprintWindows: Array<{name,startDate,endDate}> }}
 */
async function fetchBugReports(client, squadKey, boardId) {
  try {
    // Cap volume with a created-floor well before the 6-sprint window (~9 months).
    const floor = new Date();
    floor.setMonth(floor.getMonth() - 9);
    const createdAfter = floor.toISOString().slice(0, 10);

    // Resolve the "App Name" field id (components are unreliable; App Name is
    // always filled). Discovered by display name; null if not found → grouping
    // falls back to "Unspecified".
    const appNameFieldId = await client.findFieldIdByName('App Name');

    const [rawBugs, sprints] = await Promise.all([
      // Note: the bulk /search/jql endpoint does NOT reliably return changelog
      // via expand, so we fetch changelog per-issue below (bounded to in-window
      // bugs) rather than relying on withChangelog here.
      client.getBugs(squadKey, { createdAfter, appNameFieldId }),
      boardId ? client.getRecentClosedSprints(boardId, 6) : Promise.resolve([]),
    ]);

    const bugs = (rawBugs || []).map(b => normalizeBug(b, { appNameFieldId }));
    const sprintWindows = (sprints || []).map(s => ({
      name: s.name, startDate: s.startDate, endDate: s.endDate,
    }));

    // Reopen detection: fetch changelog per-issue, but ONLY for bugs created
    // within the sprint-window range (keeps the call count bounded — the whole
    // reason reopen rate is scoped to the last 6 sprints). If there are no
    // windows yet, skip (reopen rate needs a window anyway).
    if (sprintWindows.length > 0) {
      const starts = sprintWindows.map(w => new Date(w.startDate).getTime()).filter(n => !isNaN(n));
      const ends = sprintWindows.map(w => new Date(w.endDate).getTime()).filter(n => !isNaN(n));
      const lo = Math.min(...starts), hi = Math.max(...ends);
      const inWindow = bugs.filter(b => {
        const t = b.created ? new Date(b.created).getTime() : NaN;
        return !isNaN(t) && t >= lo && t <= hi;
      });
      // Safety cap so a huge window can't fan out into hundreds of calls.
      const CAP = 80;
      const toEnrich = inWindow.slice(0, CAP);
      console.log(`[background] Bug reopen: fetching changelog for ${toEnrich.length} in-window bug(s)${inWindow.length > CAP ? ` (capped from ${inWindow.length})` : ''}`);
      await Promise.all(toEnrich.map(async (b) => {
        const cl = await client.getIssueChangelog(b.key);
        // Recompute reopenCount from the freshly-fetched changelog (single source
        // of truth: the same countReopens used by the metrics + tests).
        b.reopenCount = countReopens(cl);
      }));
    }

    console.log(`[background] Bug reports: ${bugs.length} bugs, ${sprintWindows.length} sprint windows, appNameField=${appNameFieldId || 'none'}`);
    return { bugs, sprintWindows };
  } catch (err) {
    console.warn('[background] Bug reports fetch failed (non-fatal):', err.message);
    return { bugs: [], sprintWindows: [] };
  }
}

/**
 * Extra boards — fetch active sprint + stories for each configured board.
 * Scrum boards resolve to their active sprint; boards that "do not support
 * sprints" fall back to a Kanban issue fetch. Each board is independent and
 * non-fatal — a failure becomes a board entry with an `error` field.
 * @returns {Array} extraBoardsData
 */
async function fetchExtraBoards(client, settings, squadKey, storyPointsField) {
  const extraBoardsData = [];
  const rawExtraBoards = settings.squad?.extraBoards || [];
  console.log(`[background] Extra boards config: ${JSON.stringify(rawExtraBoards)}`);

  if (rawExtraBoards.length === 0) {
    console.log('[background] No extra boards configured');
    return extraBoardsData;
  }

  console.log(`[background] Processing ${rawExtraBoards.length} extra board(s)`);
  for (const boardSpec of rawExtraBoards) {
    const parsed = parseExtraBoardSpec(boardSpec);
    if (!parsed) {
      console.warn(`[background] Skipping invalid extra board spec:`, boardSpec);
      continue;
    }
    const { label: boardLabel, id: extraBoardId } = parsed;
    try {
      console.log(`[background] Extra board "${boardLabel}" (id=${extraBoardId}) — fetching...`);
      const boardEntry = await fetchOneExtraBoard(client, squadKey, storyPointsField, boardLabel, extraBoardId);
      extraBoardsData.push(boardEntry);
      console.log(`[background] Extra board ${extraBoardId} pushed (type=${boardEntry.boardType}, stories=${boardEntry.stories?.length})`);
    } catch (err) {
      extraBoardsData.push({
        boardId: extraBoardId, boardLabel, boardType: 'unknown', sprintName: null, stories: [],
        totalStories: 0, completedStories: 0, totalPoints: 0, completedPoints: 0,
        error: err.message
      });
    }
  }
  return extraBoardsData;
}

/**
 * Fetch a single extra board. Tries Scrum (active sprint) first; on "does not
 * support sprints" falls back to a Kanban issue fetch. Returns a board entry
 * object (with an `error` field on partial failure). Never throws for the
 * Kanban/unknown branches — only the outer scrum-sprint call can reject, which
 * fetchExtraBoards' loop catch handles.
 */
async function fetchOneExtraBoard(client, squadKey, storyPointsField, boardLabel, extraBoardId) {
  try {
    // Try as a Scrum board first (has active sprint)
    const activeSprint = await client.getActiveSprint(extraBoardId);
    console.log(`[background] Extra board ${extraBoardId}: scrum sprint = "${activeSprint.name}"`);

    let stories = [], totalPoints = 0, completedPoints = 0, doneCount = 0;
    try {
      const sprintStories = await client.getSprintStories(activeSprint.id, squadKey, storyPointsField);
      stories = sprintStories.map(s => normalizeStory(s, storyPointsField));
      const done = sprintStories.filter(isStoryDone);
      doneCount = done.length;
      totalPoints = stories.reduce((sum, s) => sum + s.points, 0);
      completedPoints = done.map(s => normalizeStory(s, storyPointsField).points).reduce((sum, p) => sum + p, 0);
    } catch (storyErr) {
      console.warn(`[background] Extra board ${extraBoardId} stories failed:`, storyErr.message);
    }

    return {
      boardId: extraBoardId, boardLabel, boardType: 'scrum',
      sprintName: activeSprint.name,
      startDate: activeSprint.startDate, endDate: activeSprint.endDate,
      totalStories: stories.length, completedStories: doneCount,
      totalPoints, completedPoints, stories, error: null
    };
  } catch (sprintErr) {
    // "The board does not support sprints" → treat as Kanban board
    const isKanban = sprintErr.message?.includes('does not support sprints') ||
                     sprintErr.message?.includes('400');
    if (isKanban) {
      console.log(`[background] Extra board ${extraBoardId}: Kanban board, fetching issues directly`);
      // Filter closed at the API level for support boards — saves bandwidth
      // and removes the need for client-side filtering
      const isSupport = boardLabel.toLowerCase().includes('support');
      try {
        const kanbanIssues = await client.getKanbanBoardIssues(
          extraBoardId, storyPointsField, { excludeClosed: isSupport }
        );
        const stories = kanbanIssues.map(s => normalizeStory(s, storyPointsField));
        const done = kanbanIssues.filter(isStoryDone);
        const totalPoints = stories.reduce((sum, s) => sum + s.points, 0);
        const completedPoints = done.map(s => normalizeStory(s, storyPointsField).points).reduce((sum, p) => sum + p, 0);
        console.log(`[background] Kanban board ${extraBoardId}: ${stories.length} issues`);
        return {
          boardId: extraBoardId, boardLabel, boardType: 'kanban',
          sprintName: null, startDate: null, endDate: null,
          totalStories: stories.length, completedStories: done.length,
          totalPoints, completedPoints, stories, error: null
        };
      } catch (kanbanErr) {
        return {
          boardId: extraBoardId, boardLabel, boardType: 'kanban',
          sprintName: null, stories: [],
          totalStories: 0, completedStories: 0, totalPoints: 0, completedPoints: 0,
          error: kanbanErr.message
        };
      }
    }
    // Some other error (401, 404, network)
    return {
      boardId: extraBoardId, boardLabel, boardType: 'unknown',
      sprintName: null, stories: [],
      totalStories: 0, completedStories: 0, totalPoints: 0, completedPoints: 0,
      error: sprintErr.message
    };
  }
}

/**
 * Fetch Sentry data from saved views
 * Returns issues grouped per view, not merged.
 * Views format: "Label|ID" or just "ID"
 */
async function fetchSentryData(settings) {
  const client = new sentryAPI.SentryClient(
    settings.sentry.baseUrl,
    settings.sentry.org,
    '',
    settings.sentry.token
  );
  
  const viewResults = []; // [{label, viewId, issues, count}]
  const allIssues = []; // flat merged list (for alert rules)
  
  try {
  if (settings.sentry.views && settings.sentry.views.length > 0) {
    for (const view of settings.sentry.views) {
      // New shape only: {label, url}. Legacy entries should have been cleared
      // by the v1_4_4_sentry_url_format migration; if any slip through, skip.
      if (!view || typeof view !== 'object' || !view.url) {
        console.warn(`[background] Skipping legacy/invalid Sentry view entry:`, view);
        continue;
      }
      
      const parsed = parseSentryUrl(view.url);
      if (!parsed) {
        console.warn(`[background] Skipping unparseable Sentry view "${view.label}":`, view.url);
        viewResults.push({
          label: view.label || 'Invalid URL',
          viewId: null, issues: [], count: 0,
          error: 'Could not parse view URL — re-paste from Sentry'
        });
        continue;
      }
      
      const label       = view.label || `View ${parsed.viewId}`;
      const viewId      = parsed.viewId;
      const projectIds  = parsed.projectIds;
      const environment = parsed.environment || 'production'; // default if URL omits
      // Forward the view's own query/sort/statsPeriod so the API call matches
      // exactly what Sentry shows — previously these were hardcoded in sentry-api.js
      // (statsPeriod:'7d') causing the count to be lower than the real total.
      const viewParams  = {
        query:       parsed.query,
        sort:        parsed.sort,
        statsPeriod: parsed.statsPeriod,
      };

      console.log(`[background] Fetching Sentry view "${label}" (${viewId}) projects:[${projectIds.join(',')}] env:${environment} period:${parsed.statsPeriod || 'all'}`);
      
      try {
        // Retry once on transient failures (e.g. "Failed to fetch" — a dropped
        // connection or Sentry throttle on one of several near-simultaneous
        // view requests). A single short-backoff retry absorbs almost all of
        // these without surfacing a Chrome extension-error badge.
        let issues;
        try {
          issues = await client.getIssuesFromView(viewId, projectIds, environment, viewParams);
        } catch (firstErr) {
          console.warn(`[background] View ${viewId} fetch failed, retrying once:`, firstErr.message);
          await new Promise(r => setTimeout(r, 800));
          issues = await client.getIssuesFromView(viewId, projectIds, environment, viewParams);
        }
        console.log(`[background] View "${label}" → ${issues.length} issues`);
        viewResults.push({ label, viewId, issues, count: issues.length });
        allIssues.push(...issues.map(i => ({ ...i, _viewId: viewId, _viewLabel: label })));
        
        // Record trend sample if this view is marked for tracking.
        // Multi-view: trackedViewIds is an array; fall back to the legacy
        // single trackedViewId if the array isn't present (pre-migration).
        const trackedIds = Array.isArray(settings.sentry?.trackedViewIds)
          ? settings.sentry.trackedViewIds
          : (settings.sentry?.trackedViewId ? [settings.sentry.trackedViewId] : []);
        if (trackedIds.includes(viewId)) {
          recordTrendSample(viewId, issues.length).catch(e =>
            console.warn('[background] Failed to record trend sample:', e.message)
          );
        }
      } catch (error) {
        // Persistent failure (failed even after one retry). This is handled and
        // non-fatal — the dashboard shows this view as empty and carries on — so
        // log at warn (not error) to avoid flagging the whole extension in
        // chrome://extensions. Report it to Sentry telemetry as a warning so a
        // genuinely broken view is real, queryable signal rather than noise.
        console.warn(`[background] View ${viewId} failed after retry:`, error.message);
        viewResults.push({ label, viewId, issues: [], count: 0, error: error.message });
        try {
          const { lastCurrentUser } = await chrome.storage.session.get('lastCurrentUser');
          const ctx = telemetryContext(lastCurrentUser, settings);
          ctx.extra = { viewId, label, projectIds, reason: error.message };
          ctx.level = 'warning';
          await sendEnvelope(SENTRY_DSN, buildErrorEnvelope(`Sentry view fetch failed: ${label} (${viewId})`, ctx));
        } catch (telErr) {
          console.warn('[telemetry] view-failure report skipped:', telErr?.message);
        }
      }
    }
  } else {
    try {
      const issues = await client.getUnresolvedIssues(100);
      viewResults.push({ label: 'Unresolved Issues', viewId: null, issues, count: issues.length });
      allIssues.push(...issues);
    } catch (error) {
      console.warn('[background] Sentry unresolved fetch failed (non-fatal — view shown empty):', error.message);
      viewResults.push({ label: 'Unresolved Issues', viewId: null, issues: [], count: 0, error: error.message });
    }
  }
  } catch (error) {
    // Total safety net: a single bad project/view must never reject the whole
    // Sentry fetch and blank the dashboard/trend chart. Return partial results.
    console.warn('[background] fetchSentryData unexpected error (non-fatal — returning partial):', error.message);
  }

  return { viewResults, issues: allIssues };
}

/**
 * Update toolbar badge with unacknowledged alert count
 */
async function updateBadge(alertList, snoozeMap = null) {
  // Count only alerts that are actually visible (not acknowledged, not snoozed)
  let snoozes = snoozeMap;
  if (snoozes === null) {
    const r = await chrome.storage.local.get(['alertSnoozes']);
    snoozes = r.alertSnoozes || {};
  }
  const count = alerts.visibleAlerts(alertList, snoozes).length;

  if (count === 0) {
    await chrome.action.setBadgeText({ text: '' });
  } else {
    await chrome.action.setBadgeText({ text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }); // red
  }
}

/**
 * Send desktop notifications for high-severity alerts
 */
async function notifyHighSeverity(newAlerts, settings) {
  if (!settings.alerts?.desktopNotifications) return;

  // T-AS-3: per-rule desktop notification control (default: notify)
  const highSeverity = newAlerts.filter(a => {
    if (a.severity !== 'high') return false;
    const ruleConf = settings.alerts?.rules?.[a.ruleId];
    return ruleConf?.notifyDesktop !== false;
  });

  for (const alert of highSeverity) {
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Zealer Dashboard Alert',
        message: alert.message,
        priority: 2
      });
    } catch (error) {
      console.warn('[background] Failed to send notification (non-fatal):', error);
    }
  }
}

/**
 * Handle messages from popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Lazy quarter worklog fetch
  if (message.type === 'fetch-quarter-worklogs') {
    const { year, q, accountIds, startDate, endDate, cacheKey } = message;
    // Fire-and-forget: we communicate back via chrome.runtime.sendMessage,
    // NOT via sendResponse — so do NOT return true (that would imply sendResponse usage)
    (async () => {
      try {
        const stored = await chrome.storage.local.get(['settings']);
        const settings = stored.settings || {};
        const client = new jiraAPI.JiraClient(
          settings.jira.baseUrl,
          settings.jira.email,
          settings.jira.token
        );
        // Time logged & estimate-vs-actual must reflect each engineer's work
        // ACROSS ALL squads/projects, filtered only by the period. Two passes:
        //   1) project-scoped discovery → who logged on the squad's board this
        //      period (accountId + name);
        //   2) author-scoped cross-project query for those people (+ the known
        //      roster + ids passed from the popup) → their total time everywhere.
        const squadKey = settings.squad?.key;

        let discovered = [];
        try {
          const discoveryIssues = await client.getProjectWorklogs(squadKey, startDate, endDate);
          discovered = extractWorklogsFromIssues(discoveryIssues, [], startDate, endDate)
            .map(w => ({ accountId: w.authorId, name: w.authorName }))
            .filter(r => r.accountId);
        } catch (e) {
          console.warn('[background] Quarter discovery pass failed (continuing):', e.message);
        }

        const rosterIds = (settings.analytics?.discoveredMembers || [])
          .map(m => (typeof m === 'string' ? null : m.accountId)).filter(Boolean);
        const allIds = [...new Set([
          ...(accountIds || []),
          ...rosterIds,
          ...discovered.map(d => d.accountId),
        ])];

        const issues = allIds.length > 0
          ? await client.getTeamWorklogs(allIds, startDate, endDate)
          : await client.getProjectWorklogs(squadKey, startDate, endDate);
        // Filter to roster authors (Jira returns full worklog lists per issue,
        // which can include non-roster authors who touched the same ticket).
        const rawWorklogs = extractWorklogsFromIssues(issues, allIds, startDate, endDate);
        const members = aggregateWorklogs(rawWorklogs);
        const issueTypeSplit = aggregateByIssueType(rawWorklogs);
        const payload = { fetchedAt: new Date().toISOString(), members, issueTypeSplit, startDate, endDate };
        await chrome.storage.local.set({ [cacheKey]: payload });
        chrome.runtime.sendMessage({ type: 'quarter-worklogs-ready', cacheKey }).catch(() => {});
        console.log(`[background] Quarter ${q} ${year}: ${members.length} members across all projects (ids=${allIds.length})`);

        // Fold newly discovered people into the roster so the filter lists them too.
        try {
          if (discovered.length > 0) {
            const sr = await chrome.storage.local.get(['settings']);
            const cs = sr.settings || {};
            if (!cs.analytics?.squadMembersCurated) {
              const existing = cs.analytics?.discoveredMembers || [];
              const merged = mergeRoster(existing, discovered);
              if (JSON.stringify(merged) !== JSON.stringify(existing.map(d => typeof d === 'string' ? { accountId: null, name: d } : d))) {
                await chrome.storage.local.set({
                  settings: { ...cs, analytics: { ...cs.analytics, discoveredMembers: merged } }
                });
              }
            }
          }
        } catch (e) { /* roster update is best-effort */ }
      } catch (e) {
        console.warn('[background] Quarter worklog fetch failed (non-fatal — popup notified):', e.message);
        chrome.runtime.sendMessage({ type: 'quarter-worklogs-error', cacheKey, error: e.message }).catch(() => {});
      }
    })();
    // Return undefined (not true) — we use sendMessage for the reply, not sendResponse
    return;
  }
  
  if (message.type === 'refresh-dashboard') {
    // Acknowledge immediately — popup will receive 'partial-update' messages
    // as each data source (jira, sentry) completes independently.
    sendResponse({ success: true, async: true });
    checkDashboard().catch(err =>
      console.error('[background] checkDashboard failed:', err.message)
    );
    return false; // sync response already sent
  }
  
  if (message.type === 'acknowledge-alert') {
    acknowledgeAlert(message.alertId).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (message.type === 'snooze-alert') {
    snoozeAlert(message.ruleId).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // Telemetry: popup reports a section view (gantt/timesheet/insights/boards).
  if (message.type === 'track-section') {
    (async () => {
      const { settings } = await chrome.storage.local.get('settings');
      const { lastCurrentUser } = await chrome.storage.session.get('lastCurrentUser');
      await trackSectionView(message.section, lastCurrentUser, settings);
      sendResponse({ success: true });
    })().catch(() => sendResponse({ success: false }));
    return true;
  }

  // Telemetry: popup reports a performance transaction (e.g. render timing).
  if (message.type === 'track-timing') {
    (async () => {
      const { settings } = await chrome.storage.local.get('settings');
      const { lastCurrentUser } = await chrome.storage.session.get('lastCurrentUser');
      const ctx = telemetryContext(lastCurrentUser, settings);
      const env = buildTransactionEnvelope(message.name || 'ui.timing', {
        ...ctx, startMs: message.startMs, endMs: message.endMs, spans: message.spans || [],
      });
      await sendEnvelope(SENTRY_DSN, env);
      sendResponse({ success: true });
    })().catch(() => sendResponse({ success: false }));
    return true;
  }
});

/**
 * Acknowledge an alert (mark as read)
 */
async function acknowledgeAlert(alertId) {
  const result = await chrome.storage.local.get(['alerts']);
  const alertList = result.alerts || [];
  
  const alert = alertList.find(a => a.id === alertId);
  if (alert) {
    alert.acknowledged = true;
    await chrome.storage.local.set({ alerts: alertList });
    await updateBadge(alertList);
  }
}

/**
 * Snooze an alert by ruleId until tomorrow. It stays hidden for the rest of
 * today and reappears tomorrow only if its condition still holds (checkAlerts
 * re-fires it on the next data refresh). Keyed by ruleId so a refreshed alert
 * with a new random id stays snoozed.
 */
async function snoozeAlert(ruleId) {
  const result = await chrome.storage.local.get(['alertSnoozes', 'alerts']);
  const snoozes = result.alertSnoozes || {};
  snoozes[ruleId] = alerts.tomorrowKey();
  await chrome.storage.local.set({ alertSnoozes: snoozes });
  // Recompute badge against the snooze map
  await updateBadge(result.alerts || [], snoozes);
}
