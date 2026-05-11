/**
 * popup.js
 * Main app controller for EM Dashboard side panel
 * ES module with imports from src/
 */

import * as privacyMode from './src/privacy-mode.js';
import * as metrics from './src/metrics.js';

// Current state
let state = {
  currentScreen: null,
  settings: null,
  alerts: [],
  sprintHistory: [],
  currentSprint: null,
  sentryIssues: [],
  supportTickets: []
};

/**
 * Boot sequence
 */
async function boot() {
  console.log('[popup] Booting EM Dashboard...');
  
  // Load and apply theme
  await loadAndApplyTheme();
  
  // Set version in app bar
  const manifest = chrome.runtime.getManifest();
  document.getElementById('app-version').textContent = `v${manifest.version}`;
  
  // Apply privacy mode state
  await privacyMode.applyPrivacyMode();
  updatePrivacyToggle();
  
  // Wire up event handlers
  setupEventHandlers();
  
  // Load settings
  const result = await chrome.storage.local.get(['settings', 'alerts']);
  state.settings = result.settings || {};
  state.alerts = result.alerts || [];
  
  // Check if credentials are configured
  if (!state.settings.jira?.token || !state.settings.sentry?.token) {
    showScreen('auth');
    return;
  }
  
  // Load cached data
  await loadData();
  
  // Show home screen
  showScreen('today');
  
  console.log('[popup] Boot complete');
}

/**
 * Load and apply theme
 */
async function loadAndApplyTheme() {
  try {
    const result = await chrome.storage.local.get(['settings']);
    const theme = result.settings?.ui?.theme || 'browser';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (error) {
    console.error('[popup] Failed to load theme:', error);
  }
}

/**
 * Setup event handlers
 */
function setupEventHandlers() {
  // Privacy toggle
  document.getElementById('privacy-toggle').addEventListener('click', async () => {
    const newState = await privacyMode.togglePrivacyMode();
    updatePrivacyToggle();
    console.log('[popup] Privacy mode:', newState ? 'ON' : 'OFF');
  });
  
  // Settings button
  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Docs button
  document.getElementById('docs-btn').addEventListener('click', () => {
    window.open('docs.html', '_blank');
  });
  
  // Context bar back button
  document.getElementById('context-back').addEventListener('click', () => {
    showScreen('today');
  });
  
  // Context bar refresh
  document.getElementById('context-refresh').addEventListener('click', async () => {
    await refreshDashboard();
  });
  
  // Auth screen button
  document.getElementById('auth-goto-settings')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Navigation clicks (programmatic — screens set these up dynamically)
}

/**
 * Update privacy toggle visual state
 */
function updatePrivacyToggle() {
  const toggle = document.getElementById('privacy-toggle');
  const isOn = document.body.classList.contains('privacy-on');
  toggle.setAttribute('data-active', isOn ? 'true' : 'false');
}

/**
 * Load data from cache or fetch fresh
 */
async function loadData() {
  try {
    // Load from local cache first for instant render
    const cacheResult = await chrome.storage.local.get([
      'sprintHistory',
      'currentSprint',
      'sentryIssues',
      'supportTickets',
      'alerts'
    ]);
    
    state.sprintHistory = cacheResult.sprintHistory || [];
    state.currentSprint = cacheResult.currentSprint || null;
    state.sentryIssues = cacheResult.sentryIssues || [];
    state.supportTickets = cacheResult.supportTickets || [];
    state.alerts = cacheResult.alerts || [];
    
    console.log('[popup] Data loaded from cache');
  } catch (error) {
    console.error('[popup] Failed to load data:', error);
  }
}

/**
 * Refresh dashboard (trigger background fetch)
 */
async function refreshDashboard() {
  console.log('[popup] Requesting dashboard refresh...');
  
  try {
    const response = await chrome.runtime.sendMessage({ type: 'refresh-dashboard' });
    
    if (response.success) {
      // Reload data and re-render
      await loadData();
      renderCurrentScreen();
      console.log('[popup] Dashboard refreshed');
    } else {
      console.error('[popup] Refresh failed:', response.error);
    }
  } catch (error) {
    console.error('[popup] Refresh request failed:', error);
  }
}

/**
 * Show a screen
 */
function showScreen(screenId) {
  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  
  // Show requested screen
  const screen = document.getElementById(`screen-${screenId}`);
  if (screen) {
    screen.classList.remove('hidden');
    state.currentScreen = screenId;
    
    // Render screen content
    renderScreen(screenId);
    
    // Update context bar
    updateContextBar(screenId);
  }
}

/**
 * Update context bar for current screen
 */
function updateContextBar(screenId) {
  const bar = document.getElementById('context-bar');
  const back = document.getElementById('context-back');
  const key = document.getElementById('context-key');
  const project = document.getElementById('context-project');
  const sprint = document.getElementById('context-sprint');
  const sep1 = document.getElementById('context-sep-1');
  const refresh = document.getElementById('context-refresh');
  const exportBtn = document.getElementById('context-export');
  
  // Reset
  bar.classList.add('empty');
  back.style.display = 'none';
  key.style.display = 'none';
  project.textContent = '';
  sprint.textContent = '';
  sep1.style.display = 'none';
  refresh.style.display = 'none';
  exportBtn.style.display = 'none';
  
  if (screenId === 'auth') {
    // No context bar for auth
    return;
  }
  
  // Show context bar for other screens
  bar.classList.remove('empty');
  
  // Squad info
  if (state.settings.squad) {
    key.style.display = 'inline-flex';
    key.textContent = state.settings.squad.key;
    project.textContent = state.settings.squad.name;
  }
  
  // Sprint info
  if (state.currentSprint) {
    sep1.style.display = 'inline';
    sprint.textContent = state.currentSprint.name;
  }
  
  // Back button for non-home screens
  if (screenId !== 'today') {
    back.style.display = 'inline-block';
  }
  
  // Refresh button
  refresh.style.display = 'inline-block';
}

/**
 * Render a screen's content
 */
function renderScreen(screenId) {
  switch (screenId) {
    case 'auth':
      // Static content, no render needed
      break;
    case 'today':
      renderTodayScreen();
      break;
    case 'sprint-health':
      renderSprintHealthScreen();
      break;
    case 'reliability':
      renderReliabilityScreen();
      break;
  }
}

/**
 * Re-render current screen
 */
function renderCurrentScreen() {
  if (state.currentScreen) {
    renderScreen(state.currentScreen);
  }
}

/**
 * Render TODAY screen
 */
function renderTodayScreen() {
  // Alert inbox
  const inbox = document.getElementById('alert-inbox');
  const alertEmpty = document.getElementById('alert-empty');
  
  const unacknowledged = state.alerts.filter(a => !a.acknowledged);
  
  if (unacknowledged.length === 0) {
    inbox.innerHTML = '';
    alertEmpty.classList.remove('hidden');
  } else {
    alertEmpty.classList.add('hidden');
    inbox.innerHTML = unacknowledged.map(alert => `
      <div class="alert-item severity-${alert.severity}" data-alert-id="${alert.id}">
        <div class="alert-header">
          <span class="badge badge-${alert.severity}">${alert.severity.toUpperCase()}</span>
          <span class="alert-time">${formatTimestamp(alert.createdAt)}</span>
        </div>
        <div class="alert-message">${escapeHtml(alert.message)}</div>
      </div>
    `).join('');
    
    // Wire up click handlers
    inbox.querySelectorAll('.alert-item').forEach(item => {
      item.addEventListener('click', () => {
        const alertId = item.dataset.alertId;
        acknowledgeAlert(alertId);
      });
    });
  }
  
  // Sprint at a glance
  const glanceName = document.getElementById('sprint-glance-name');
  const glanceSubtitle = document.getElementById('sprint-glance-subtitle');
  
  if (state.currentSprint) {
    const prediction = metrics.sprintBurndownPrediction(state.currentSprint);
    glanceName.textContent = state.currentSprint.name;
    glanceSubtitle.textContent = `${state.currentSprint.completedPoints}/${state.currentSprint.totalPoints} pts · Day ${state.currentSprint.daysElapsed}/${state.currentSprint.totalDays} · ${prediction.onTrack ? '✓ On track' : '⚠ At risk'}`;
  } else {
    glanceName.textContent = 'No active sprint';
    glanceSubtitle.textContent = '';
  }
  
  // Fresh Sentry spikes
  const spikes = document.getElementById('sentry-spikes');
  const sentryEmpty = document.getElementById('sentry-empty');
  
  const recentSpikes = state.sentryIssues.filter(issue => {
    const age = (Date.now() - new Date(issue.firstSeen).getTime()) / (60 * 60 * 1000);
    return age < 24;
  }).slice(0, 5);
  
  if (recentSpikes.length === 0) {
    spikes.innerHTML = '';
    sentryEmpty.classList.remove('hidden');
  } else {
    sentryEmpty.classList.add('hidden');
    spikes.innerHTML = recentSpikes.map(issue => `
      <div class="card">
        <div class="card-title">${escapeHtml(issue.title || issue.culprit || 'Untitled')}</div>
        <div class="card-subtitle">${Math.round((Date.now() - new Date(issue.firstSeen).getTime()) / (60 * 60 * 1000))}h old · ${issue.count || 0} events</div>
      </div>
    `).join('');
  }
}

/**
 * Render SPRINT HEALTH screen
 */
function renderSprintHealthScreen() {
  // Velocity
  const velocity = metrics.calculateVelocity(state.sprintHistory);
  document.getElementById('velocity-value').textContent = `${velocity} pts`;
  
  const dropped = metrics.velocityDropped(state.sprintHistory);
  document.getElementById('velocity-trend').textContent = dropped ? '⚠ Dropped >15% for 2 sprints' : 'Stable';
  
  // Goal hit rate
  const goalRate = metrics.goalAchievementRate(state.sprintHistory);
  document.getElementById('goal-hit-rate').textContent = `${goalRate}%`;
  
  // Carry-over
  const carryOver = metrics.carryOverRate(state.sprintHistory);
  document.getElementById('carry-over-rate').textContent = `${carryOver} stories`;
  
  // Stale tickets
  const staleContainer = document.getElementById('stale-tickets');
  const staleEmpty = document.getElementById('stale-empty');
  
  const staleTickets = state.supportTickets.filter(ticket => metrics.ticketStale(ticket));
  
  if (staleTickets.length === 0) {
    staleContainer.innerHTML = '';
    staleEmpty.classList.remove('hidden');
  } else {
    staleEmpty.classList.add('hidden');
    staleContainer.innerHTML = staleTickets.map(ticket => `
      <div class="card">
        <div class="card-title">${escapeHtml(ticket.fields?.summary || 'Untitled')}</div>
        <div class="card-subtitle">Last update: ${formatDate(ticket.fields?.updated)}</div>
      </div>
    `).join('');
  }
}

/**
 * Render RELIABILITY screen
 */
function renderReliabilityScreen() {
  // Sentry 7-day trend
  const sentryCount = metrics.sentryErrorTrend(state.sentryIssues);
  document.getElementById('sentry-count').textContent = `${sentryCount} unresolved`;
  document.getElementById('sentry-trend').textContent = sentryCount > 10 ? '⚠ High' : '✓ Normal';
  
  // Untriaged spikes
  const untriagedContainer = document.getElementById('untriaged-spikes');
  const untriagedEmpty = document.getElementById('untriaged-empty');
  
  const untriaged = state.sentryIssues.filter(issue => metrics.sentryUntriaged(issue));
  
  if (untriaged.length === 0) {
    untriagedContainer.innerHTML = '';
    untriagedEmpty.classList.remove('hidden');
  } else {
    untriagedEmpty.classList.add('hidden');
    untriagedContainer.innerHTML = untriaged.map(issue => `
      <div class="card">
        <div class="card-title">${escapeHtml(issue.title || issue.culprit || 'Untitled')}</div>
        <div class="card-subtitle">${Math.round((Date.now() - new Date(issue.firstSeen).getTime()) / (60 * 60 * 1000))}h old</div>
      </div>
    `).join('');
  }
  
  // Support SLA
  const sla = metrics.supportSLAAdherence(state.supportTickets);
  document.getElementById('sla-adherence').textContent = `${sla}%`;
  document.getElementById('sla-subtitle').textContent = sla >= 90 ? '✓ Target met' : '⚠ Below target';
  
  // Security tickets (placeholder — Phase 1 has no data yet)
  document.getElementById('security-tickets').innerHTML = '';
  document.getElementById('security-empty').classList.remove('hidden');
}

/**
 * Acknowledge an alert
 */
async function acknowledgeAlert(alertId) {
  try {
    await chrome.runtime.sendMessage({ type: 'acknowledge-alert', alertId });
    
    // Update local state
    const alert = state.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
    
    // Re-render
    renderCurrentScreen();
  } catch (error) {
    console.error('[popup] Failed to acknowledge alert:', error);
  }
}

/**
 * Utility: format timestamp
 */
function formatTimestamp(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

/**
 * Utility: format date
 */
function formatDate(dateString) {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  return date.toLocaleDateString();
}

/**
 * Utility: escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Boot on load
boot();
