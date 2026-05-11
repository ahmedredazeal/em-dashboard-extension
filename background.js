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
      sentryIssues: state.sentryIssues
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
  let boardId = settings.squad?.boardId;
  
  if (!squadKey) {
    throw new Error('Squad project key not configured');
  }
  
  console.log(`[background] Jira fetch starting for project ${squadKey}${boardId ? `, board ${boardId}` : ' (auto-discover board)'}`);
  
  // Get current sprint - auto-discover board if not configured
  let currentSprint = null;
  try {
    let activeSprint;
    
    if (boardId) {
      // Use configured board ID
      console.log(`[background] Using configured board ${boardId}`);
      activeSprint = await client.getActiveSprint(boardId);
    } else {
      // Auto-discover board from project key
      console.log(`[background] Auto-discovering board for ${squadKey}...`);
      activeSprint = await client.getActiveSprintByProject(squadKey);
      boardId = activeSprint.boardId;
      console.log(`[background] Auto-discovered board: ${activeSprint.boardName} (id=${boardId})`);
    }
    
    console.log('[background] Active sprint found:', activeSprint.name, 'id=' + activeSprint.id);
    
    const stories = await client.getSprintStories(activeSprint.id, squadKey);
    console.log(`[background] Fetched ${stories.length} stories from sprint`);
    
    // Calculate sprint metrics
    const totalPoints = stories.reduce((sum, s) => sum + (s.fields.customfield_10016 || 0), 0);
    const completedStories = stories.filter(s => s.fields.status?.name === 'Done');
    const completedPoints = completedStories.reduce((sum, s) => sum + (s.fields.customfield_10016 || 0), 0);
    
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
    console.error('[background] Full error:', err);
  }
  
  // Fetch sprint history if we have a board ID
  let sprintHistory = [];
  if (boardId) {
    try {
      sprintHistory = await client.getSprintHistory(boardId, 5);
    } catch (err) {
      console.warn('[background] Failed to fetch sprint history:', err.message);
    }
  }
  
  // Fetch support tickets
  let supportTickets = [];
  try {
    supportTickets = await client.getSupportTickets(squadKey);
  } catch (err) {
    console.warn('[background] Failed to fetch support tickets:', err.message);
  }
  
  return {
    sprintHistory,
    currentSprint,
    supportTickets
  };
}

/**
 * Fetch Sentry data from saved views
 */
async function fetchSentryData(settings) {
  const client = new sentryAPI.SentryClient(
    settings.sentry.baseUrl,
    settings.sentry.org,
    '', // project not needed for view-based queries
    settings.sentry.token
  );
  
  const allIssues = [];
  
  // Fetch issues from each saved view
  if (settings.sentry.views && settings.sentry.views.length > 0) {
    for (const viewId of settings.sentry.views) {
      try {
        const viewIssues = await client.getIssuesFromView(viewId, 'production');
        allIssues.push(...viewIssues.map(issue => ({ ...issue, viewId })));
      } catch (error) {
        console.error(`[background] Failed to fetch Sentry view ${viewId}:`, error);
      }
    }
  } else {
    // Fallback: if no views configured, get unresolved issues
    const issues = await client.getUnresolvedIssues(100);
    allIssues.push(...issues);
  }
  
  return { issues: allIssues };
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
