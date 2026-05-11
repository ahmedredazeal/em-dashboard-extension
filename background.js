/**
 * background.js
 * Service worker for EM Dashboard
 * Handles: alarms, data fetching, alert rules, toolbar badge, notifications
 */

import * as jiraAPI from './src/jira-api.js';
import * as sentryAPI from './src/sentry-api.js';
import * as alerts from './src/alerts.js';

const ALARM_NAME = 'em-dashboard-check';
const DEFAULT_INTERVAL_MINUTES = 30;

/**
 * Initialize on extension install/update
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[background] EM Dashboard installed/updated');
  
  // Configure side panel to open on action click
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log('[background] Side panel configured to open on click');
  
  // Set up alarm for periodic checks
  await setupAlarm();
  
  // Run initial check
  await checkDashboard();
});

/**
 * Configure side panel on startup (when Chrome restarts)
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[background] EM Dashboard starting up');
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log('[background] Side panel configured on startup');
});

/**
 * Set up periodic alarm
 */
async function setupAlarm() {
  try {
    const result = await chrome.storage.local.get(['settings']);
    const interval = result.settings?.alerts?.cadenceMin || DEFAULT_INTERVAL_MINUTES;
    
    // Clear existing alarm
    await chrome.alarms.clear(ALARM_NAME);
    
    // Create new alarm
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: interval
    });
    
    console.log(`[background] Alarm set for every ${interval} minutes`);
  } catch (error) {
    console.error('[background] Failed to setup alarm:', error);
  }
}

/**
 * Handle alarm triggers
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[background] Alarm triggered, checking dashboard...');
    await checkDashboard();
  }
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
    
    // Fetch data concurrently
    const [jiraData, sentryData] = await Promise.allSettled([
      fetchJiraData(settings),
      fetchSentryData(settings)
    ]);
    
    // Build state object for alert rules
    const state = {
      sprintHistory: [],
      currentSprint: null,
      supportTickets: [],
      sentryIssues: [],
      sentryViews: [],
      slaHours: 48
    };
    
    // Populate state from fetched data
    if (jiraData.status === 'fulfilled') {
      state.sprintHistory = jiraData.value.sprintHistory || [];
      state.currentSprint = jiraData.value.currentSprint || null;
      state.supportTickets = jiraData.value.supportTickets || [];
    } else {
      console.error('[background] Jira fetch failed:', jiraData.reason);
    }
    
    if (sentryData.status === 'fulfilled') {
      state.sentryIssues = sentryData.value.issues || [];
      state.sentryViews = sentryData.value.viewResults || [];
    } else {
      console.error('[background] Sentry fetch failed:', sentryData.reason);
    }
    
    // Run alert rules
    const newAlerts = alerts.checkAlerts(state);
    console.log(`[background] ${newAlerts.length} new alerts fired`);
    
    // Merge with existing alerts
    const existingResult = await chrome.storage.local.get(['alerts']);
    const existingAlerts = existingResult.alerts || [];
    const mergedAlerts = alerts.mergeAlerts(existingAlerts, newAlerts);
    
    // Save alerts
    await chrome.storage.local.set({ alerts: mergedAlerts });
    
    // CRITICAL: Save fetched data to storage so popup.js can render it
    await chrome.storage.local.set({
      sprintHistory: state.sprintHistory,
      currentSprint: state.currentSprint,
      supportTickets: state.supportTickets,
      sentryIssues: state.sentryIssues,
      sentryViews: state.sentryViews || []
    });
    console.log('[background] Saved data to storage:', {
      sprintHistory: state.sprintHistory.length,
      currentSprint: state.currentSprint ? state.currentSprint.name : null,
      supportTickets: state.supportTickets.length,
      sentryIssues: state.sentryIssues.length
    });
    
    // Update badge
    await updateBadge(mergedAlerts);
    
    // Send desktop notifications for high-severity new alerts
    await notifyHighSeverity(newAlerts, settings);
    
    // Update cache timestamp
    await chrome.storage.local.set({
      cache: {
        lastFetch: {
          jira: Date.now(),
          sentry: Date.now()
        }
      }
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
  try {
    console.log(`[background] Auto-discovering board for ${squadKey}...`);
    const activeSprint = await client.getActiveSprintByProject(squadKey);
    boardId = activeSprint.boardId;
    console.log(`[background] Auto-discovered board: ${activeSprint.boardName} (id=${boardId})`);
    console.log('[background] Active sprint:', activeSprint.name, 'id=' + activeSprint.id);
    
    // Auto-detect story points field from board configuration
    const storyPointsField = await client.getStoryPointsField(boardId);
    console.log(`[background] Story points field: ${storyPointsField}`);
    
    const stories = await client.getSprintStories(activeSprint.id, squadKey);
    console.log(`[background] Fetched ${stories.length} stories from sprint`);
    
    // Use the detected story points field
    const getPoints = (story) => {
      const v = story.fields?.[storyPointsField];
      if (typeof v === 'number') return v;
      // Fallback: try other common fields
      for (const f of ['customfield_10016', 'customfield_10026', 'customfield_10004', 'story_points']) {
        const fv = story.fields?.[f];
        if (typeof fv === 'number') return fv;
      }
      return 0;
    };
    
    const totalPoints = stories.reduce((sum, s) => sum + getPoints(s), 0);
    const completedStories = stories.filter(s => s.fields.status?.name === 'Done' || s.fields.status?.statusCategory?.key === 'done');
    const completedPoints = completedStories.reduce((sum, s) => sum + getPoints(s), 0);
    
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
      daysElapsed
    };
    console.log('[background] Current sprint:', currentSprint);
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
  
  // Extra boards (for future use - we'll display them as additional sections)
  const extraBoardsData = [];
  if (settings.squad?.extraBoards && settings.squad.extraBoards.length > 0) {
    console.log(`[background] Fetching ${settings.squad.extraBoards.length} extra boards`);
    for (const extraBoardId of settings.squad.extraBoards) {
      try {
        const sprint = await client.getActiveSprint(extraBoardId);
        extraBoardsData.push({ boardId: extraBoardId, activeSprint: sprint });
      } catch (err) {
        console.warn(`[background] Extra board ${extraBoardId}: ${err.message}`);
      }
    }
  }
  
  return {
    sprintHistory,
    currentSprint,
    supportTickets,
    extraBoardsData
  };
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
    for (const viewSpec of settings.sentry.views) {
      let label, viewId;
      if (viewSpec.includes('|')) {
        [label, viewId] = viewSpec.split('|').map(s => s.trim());
      } else {
        viewId = viewSpec.trim();
        label = `View ${viewId}`;
      }
      
      console.log(`[background] Fetching Sentry view "${label}" (${viewId})...`);
      
      try {
        const issues = await client.getIssuesFromView(viewId, 'production');
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
    // Manual refresh requested from popup
    checkDashboard().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // async response
  }
  
  if (message.type === 'acknowledge-alert') {
    // Acknowledge an alert
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
