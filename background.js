/**
 * background.js
 * Service worker for EM Dashboard
 * Data is fetched on panel open (not on a background timer).
 * This service worker handles: data fetching, alert rules, toolbar badge, notifications.
 */

import * as jiraAPI from './src/jira-api.js';
import * as sentryAPI from './src/sentry-api.js';
import * as alerts from './src/alerts.js';
import { parseExtraBoardSpec, parseSentryViewSpec, normalizeStory, isStoryDone } from './src/parsers.js';
import { attachCloseTimestamps } from './src/changelog-parser.js';
import { computeBurndownSeries } from './src/burndown.js';
import { extractWorklogs, computeTimesheet, sortTimesheetMembers } from './src/timesheet.js';
import { setCachedSprintData, detectSprintChange } from './src/sprint-cache.js';

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
      { withChangelog: true, withWorklogs: true }
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
    const { dayIndex: computeDayIndex } = await import('./src/changelog-parser.js');
    const normalizedStories = withChangelog.map((story, i) => {
      if (story.closedAt === null && story.statusCategory === 'done') {
        const raw = stories[i];
        const updated = raw?.fields?.updated;
        if (updated) {
          const closeDay = computeDayIndex(updated, activeSprint.startDate);
          return { ...story, closedAt: updated, closedDay: Math.max(0, closeDay) };
        }
      }
      return story;
    });
    
    console.log(`[background] Stories with close dates: ${normalizedStories.filter(s=>s.closedAt).length}/${normalizedStories.length}`);
    
    const startDate = activeSprint.startDate ? new Date(activeSprint.startDate) : new Date();
    const endDate = activeSprint.endDate ? new Date(activeSprint.endDate) : new Date();
    const now = new Date();
    
    const totalDays = Math.max(1, Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000)));
    const daysElapsed = Math.max(0, Math.ceil((now - startDate) / (24 * 60 * 60 * 1000)));
    
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
      
      // Burndown
      const burndown = computeBurndownSeries(
        { startDate: activeSprint.startDate, totalDays, totalPoints },
        normalizedStories
      );
      
      // Timesheet — extract worklogs from the sprint stories response
      const { worklogs: inlineWorklogs, needsFullFetch } = extractWorklogs(stories);
      let allWorklogs = [...inlineWorklogs];
      
      // Fetch full worklogs for issues that had more than the inline limit
      if (needsFullFetch.length > 0) {
        console.log(`[background] Fetching full worklogs for ${needsFullFetch.length} issues...`);
        const fullWlResults = await Promise.allSettled(
          needsFullFetch.map(key => client.getIssueWorklogs(key))
        );
        for (const r of fullWlResults) {
          if (r.status === 'fulfilled') allWorklogs.push(...r.value);
        }
      }
      
      const timesheetRaw = computeTimesheet(allWorklogs, activeSprint.startDate, workingDays);
      const timesheet = sortTimesheetMembers(timesheetRaw);
      
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
        sprintId: activeSprint.id,
        totalDays,
        startDate: activeSprint.startDate,
        endDate: activeSprint.endDate,
        week1Label: 'Week 1',
        week2Label: 'Week 2'
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
            try {
              const kanbanIssues = await client.getKanbanBoardIssues(extraBoardId, storyPointsField);
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
      // Handle both old string format and new object format
      let label, viewId, projectIds = [];
      if (typeof view === 'string') {
        if (view.includes('|')) {
          [label, viewId] = view.split('|').map(s => s.trim());
        } else {
          viewId = view.trim();
          label = `View ${viewId}`;
        }
      } else {
        label = view.label || `View ${view.viewId}`;
        viewId = view.viewId;
        projectIds = view.projectIds || [];
      }
      
      console.log(`[background] Fetching Sentry view "${label}" (${viewId}) projects:[${projectIds.join(',')}]...`);
      
      try {
        const issues = await client.getIssuesFromView(viewId, projectIds, 'production');
        console.log(`[background] View "${label}" → ${issues.length} issues`);
        viewResults.push({ label, viewId, issues, count: issues.length });
        allIssues.push(...issues.map(i => ({ ...i, _viewId: viewId, _viewLabel: label })));
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
