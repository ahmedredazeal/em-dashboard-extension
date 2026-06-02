/**
 * background.js
 * Service worker for EM Dashboard
 * Data is fetched on panel open (not on a background timer).
 * This service worker handles: data fetching, alert rules, toolbar badge, notifications.
 */

import * as jiraAPI from './src/jira-api.js';
import * as sentryAPI from './src/sentry-api.js';
import * as alerts from './src/alerts.js';
import { parseExtraBoardSpec, parseSentryViewSpec, parseSentryUrl, normalizeStory, isStoryDone } from './src/parsers.js';
import { attachCloseTimestamps, dayIndex } from './src/changelog-parser.js';
import { computeBurndownSeries } from './src/burndown.js';
import { extractWorklogs, computeTimesheet, sortTimesheetMembers } from './src/timesheet.js';
import { setCachedSprintData, detectSprintChange } from './src/sprint-cache.js';
import { runMigrations } from './src/migrations.js';
import { recordTrendSample } from './src/sentry-trend.js';
import { extractWorklogsFromIssues, aggregateWorklogs, aggregateByIssueType } from './src/worklog-aggregator.js';

// Run data migrations on service worker init (idempotent — flagged per migration)
runMigrations().catch(err => console.warn('[background] Migration failed:', err.message));

/**
 * Initialize on extension install/update
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[background] EM Dashboard installed/updated');
  
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
  console.log('[background] EM Dashboard starting up');
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Clear any stale alarms from old versions
  await chrome.alarms.clearAll();
});

/**
 * Main dashboard check routine
 * Fetches data from Jira + Sentry, runs alert rules, updates badge
 */
async function checkDashboard() {
  try {
    // Check if credentials are configured
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings;
    
    if (!settings?.jira?.token || !settings?.sentry?.token) {
      console.log('[background] Credentials not configured, skipping check');
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
        extraBoardsData: state.extraBoardsData || []
      });
      // Push to popup if it is open (ignore error if not)
      chrome.runtime.sendMessage({ type: 'partial-update', source })
        .catch(() => {});
      console.log(`[background] Saved + notified popup (source: ${source})`);
    }

    // Launch both fetches concurrently but handle each as it resolves
    const jiraPromise = fetchJiraData(settings)
      .then(async data => {
        state.sprintHistory   = data.sprintHistory   || [];
        state.currentSprint   = data.currentSprint   || null;
        state.supportTickets  = data.supportTickets  || [];
        state.extraBoardsData = data.extraBoardsData || [];
        await saveAndNotify('jira');
      })
      .catch(err => console.error('[background] Jira fetch failed:', err.message));

    const sentryPromise = fetchSentryData(settings)
      .then(async data => {
        state.sentryIssues = data.issues      || [];
        state.sentryViews  = data.viewResults || [];
        await saveAndNotify('sentry');
      })
      .catch(err => console.error('[background] Sentry fetch failed:', err.message));

    // Wait for both to finish before running alert rules + badge
    await Promise.allSettled([jiraPromise, sentryPromise]);
    
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
  
  const squadKey = settings.squad?.key;
  
  if (!squadKey) {
    throw new Error('Squad project key not configured');
  }
  
  console.log(`[background] Jira fetch for project ${squadKey} (auto-discover board)`);
  
  // Always auto-discover main board from project key
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
    
    const startDate = activeSprint.startDate ? new Date(activeSprint.startDate) : new Date();
    const endDate = activeSprint.endDate ? new Date(activeSprint.endDate) : new Date();
    const now = new Date();

    // Calendar-date based (matches changelog-parser.dayIndex), so the burndown's
    // "today" and each ticket's close day are measured the same way. Raw 24h
    // windows broke this when sprints start mid-afternoon.
    const totalDays = Math.max(1, dayIndex(activeSprint.endDate || now.toISOString(), activeSprint.startDate || now.toISOString()));
    const todayCalIdx = Math.max(0, Math.min(dayIndex(now.toISOString(), activeSprint.startDate || now.toISOString()), totalDays));
    const daysElapsed = Math.min(todayCalIdx + 1, totalDays); // 1-based for the "Day X of Y" header
    
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
      totalDays,
      daysElapsed,
      stories: normalizedStories
    };
    console.log('[background] Current sprint:', currentSprint.name, `${totalPoints}pt/${totalDays}d`);
    
    // Compute and cache sprint analytics (burndown + timesheet)
    try {
      const workingDays = settings.ui?.workingDays || [0, 1, 2, 3, 4]; // Sun-Thu default
      
      // Burndown — todayIndex is the calendar-date index of "now" (same basis
      // as each ticket's closedDay), so today's closures land on today's point.
      const burndown = computeBurndownSeries(
        { startDate: activeSprint.startDate, totalDays, totalPoints, daysElapsed, todayIndex: todayCalIdx },
        normalizedStories
      );
      
      // Timesheet — fetch worklogs across ALL projects for all assignees.
      // Uses worklogAuthor JQL so we capture time logged on any squad's tickets,
      // not just HRM. One embedded-worklog search replaces the old N+1 approach.
      let allWorklogs = [];
      try {
        // Collect unique account IDs from sprint stories
        const accountIds = [...new Set(
          (stories || [])
            .map(s => s.assigneeAccountId)
            .filter(Boolean)
        )];
        
        let issues = [];
        // Slice to YYYY-MM-DD — Jira sprint dates are ISO datetime strings
        const wlStart = (activeSprint.startDate || '').slice(0, 10);
        const wlEnd   = (activeSprint.endDate   || '').slice(0, 10);
        
        if (!wlStart || !wlEnd) {
          console.warn('[background] Sprint has no startDate/endDate — skipping worklog fetch');
        } else if (accountIds.length > 0) {
          // Option A: cross-squad query by author IDs (preferred)
          const worklogPromise = client.getTeamWorklogs(accountIds, wlStart, wlEnd);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Worklog fetch timeout after 15s')), 15000)
          );
          issues = await Promise.race([worklogPromise, timeoutPromise]);
          console.log(`[background] Cross-squad worklogs: ${issues.length} issues for ${accountIds.length} members`);
        } else {
          // Fallback: project-scoped query when account IDs unavailable (old cache)
          console.warn('[background] No assignee account IDs — falling back to project-scoped worklog query');
          const jql = `project = "${squadKey}" AND worklogDate >= "${wlStart}" AND worklogDate <= "${wlEnd}"`;
          const result = await client._search({
            jql,
            fields: ['worklog','project','issuetype','priority','timeoriginalestimate','summary'],
            maxResults: 200,
          });
          issues = result.issues || [];
          console.log(`[background] Project-scoped worklogs (fallback): ${issues.length} issues`);
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
      
      // Persist discovered member names so settings page can show checkboxes.
      // Discover from BOTH worklog authors AND sprint assignees — so the filter
      // shows everyone with a ticket this sprint (the full team), not only the
      // few who have logged time. This also repopulates the full list quickly
      // if chrome.storage.local was reset (e.g. extension reloaded from a new
      // folder), instead of collapsing to just the current time-loggers.
      const assigneeNames = (normalizedStories || [])
        .map(s => s.assignee)
        .filter(Boolean);
      const discoveredNames = [...new Set([
        ...timesheet.map(m => m.name),
        ...assigneeNames
      ])];
      if (discoveredNames.length > 0) {
        const settingsResult = await chrome.storage.local.get(['settings']);
        const currentSettings = settingsResult.settings || {};
        const existingNames = currentSettings.analytics?.discoveredMembers || [];
        const merged = [...new Set([...existingNames, ...discoveredNames])];
        if (merged.length !== existingNames.length) {
          await chrome.storage.local.set({
            settings: {
              ...currentSettings,
              analytics: { ...currentSettings.analytics, discoveredMembers: merged }
            }
          });
          console.log(`[background] Discovered ${merged.length} team members for timesheet`);
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
    console.error('[background] Failed to fetch active sprint:', err.message);
  }
  
  // Sprint history
  let sprintHistory = [];
  if (boardId) {
    try {
      sprintHistory = await client.getSprintHistory(boardId, 5);
    } catch (err) {
      console.warn('[background] Failed to fetch sprint history:', err.message);
    }
  }
  
  // Support tickets
  let supportTickets = [];
  try {
    supportTickets = await client.getSupportTickets(squadKey);
  } catch (err) {
    console.warn('[background] Failed to fetch support tickets:', err.message);
  }
  
  // Extra boards — fetch active sprint + stories for each
  const extraBoardsData = [];
  const rawExtraBoards = settings.squad?.extraBoards || [];
  console.log(`[background] Extra boards config: ${JSON.stringify(rawExtraBoards)}`);
  
  if (rawExtraBoards.length > 0) {
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
        
        let boardEntry;
        
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
          
          boardEntry = {
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
              
              boardEntry = {
                boardId: extraBoardId, boardLabel, boardType: 'kanban',
                sprintName: null, startDate: null, endDate: null,
                totalStories: stories.length, completedStories: done.length,
                totalPoints, completedPoints, stories, error: null
              };
              console.log(`[background] Kanban board ${extraBoardId}: ${stories.length} issues`);
            } catch (kanbanErr) {
              boardEntry = {
                boardId: extraBoardId, boardLabel, boardType: 'kanban',
                sprintName: null, stories: [],
                totalStories: 0, completedStories: 0, totalPoints: 0, completedPoints: 0,
                error: kanbanErr.message
              };
            }
          } else {
            // Some other error (401, 404, network)
            boardEntry = {
              boardId: extraBoardId, boardLabel, boardType: 'unknown',
              sprintName: null, stories: [],
              totalStories: 0, completedStories: 0, totalPoints: 0, completedPoints: 0,
              error: sprintErr.message
            };
          }
        }
        
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
  } else {
    console.log('[background] No extra boards configured');
  }
  
  console.log(`[background] fetchJiraData returning with ${extraBoardsData.length} extra board(s)`);
  return { sprintHistory, currentSprint, supportTickets, extraBoardsData };
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
        const issues = await client.getIssuesFromView(viewId, projectIds, environment, viewParams);
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
        console.error(`[background] Failed view ${viewId}:`, error.message);
        viewResults.push({ label, viewId, issues: [], count: 0, error: error.message });
      }
    }
  } else {
    const issues = await client.getUnresolvedIssues(100);
    viewResults.push({ label: 'Unresolved Issues', viewId: null, issues, count: issues.length });
    allIssues.push(...issues);
  }
  
  return { viewResults, issues: allIssues };
}

/**
 * Update toolbar badge with unacknowledged alert count
 */
async function updateBadge(alertList) {
  const unacknowledged = alertList.filter(a => !a.acknowledged).length;
  
  if (unacknowledged === 0) {
    await chrome.action.setBadgeText({ text: '' });
  } else {
    await chrome.action.setBadgeText({ text: String(unacknowledged) });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }); // red
  }
}

/**
 * Send desktop notifications for high-severity alerts
 */
async function notifyHighSeverity(newAlerts, settings) {
  if (!settings.alerts?.desktopNotifications) return;
  
  const highSeverity = newAlerts.filter(a => a.severity === 'high');
  
  for (const alert of highSeverity) {
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'EM Dashboard Alert',
        message: alert.message,
        priority: 2
      });
    } catch (error) {
      console.error('[background] Failed to send notification:', error);
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
        const issues = await client.getTeamWorklogs(accountIds, startDate, endDate);
        const rawWorklogs = extractWorklogsFromIssues(issues, accountIds, startDate, endDate);
        const members = aggregateWorklogs(rawWorklogs);
        const issueTypeSplit = aggregateByIssueType(rawWorklogs);
        const payload = { fetchedAt: new Date().toISOString(), members, issueTypeSplit, startDate, endDate };
        await chrome.storage.local.set({ [cacheKey]: payload });
        chrome.runtime.sendMessage({ type: 'quarter-worklogs-ready', cacheKey }).catch(() => {});
        console.log(`[background] Quarter ${q} ${year}: ${members.length} members cached`);
      } catch (e) {
        console.error('[background] Quarter worklog fetch failed:', e.message);
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
