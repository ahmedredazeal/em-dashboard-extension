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
  sentryViews: [],   // per-view: [{label, viewId, issues, count}]
  supportTickets: [],
  isLoading: false
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
  
  // Load cached data first for instant render
  await loadData();
  
  // Show home screen
  showScreen('today');
  
  console.log('[popup] Boot complete, triggering fresh data fetch...');
  
  // Trigger fresh fetch from APIs in background
  // This wakes up the service worker and fetches latest data
  refreshDashboard();
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
      'sprintHistory', 'currentSprint', 'sentryIssues',
      'sentryViews', 'supportTickets', 'alerts'
    ]);
    
    state.sprintHistory = cacheResult.sprintHistory || [];
    state.currentSprint = cacheResult.currentSprint || null;
    state.sentryIssues = cacheResult.sentryIssues || [];
    state.sentryViews = cacheResult.sentryViews || [];
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
  state.isLoading = true;
  
  // Show loading indicator on sprint glance
  const glanceName = document.getElementById('sprint-glance-name');
  const glanceSub = document.getElementById('sprint-glance-subtitle');
  if (glanceName) glanceName.textContent = 'Loading…';
  if (glanceSub) glanceSub.textContent = '';
  
  // Show loading in Sentry section
  const spikes = document.getElementById('sentry-spikes');
  const sentryTotal = document.getElementById('sentry-total');
  if (spikes) spikes.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px;text-align:center;">Loading issues…</div>';
  if (sentryTotal) sentryTotal.textContent = '…';
  
  const refreshBtn = document.getElementById('context-refresh');
  if (refreshBtn) { refreshBtn.style.opacity = '0.4'; refreshBtn.style.pointerEvents = 'none'; }
  
  try {
    const response = await chrome.runtime.sendMessage({ type: 'refresh-dashboard' });
    
    if (response && response.success) {
      // Reload data and re-render
      await loadData();
      renderCurrentScreen();
      console.log('[popup] Dashboard refreshed');
      
      // Clear any previous error banner
      const errBanner = document.getElementById('error-banner');
      if (errBanner) errBanner.remove();
    } else {
      const errMsg = response?.error || 'Unknown error - check service worker console';
      console.error('[popup] Refresh failed:', errMsg);
      showErrorBanner(errMsg);
    }
  } catch (error) {
    console.error('[popup] Refresh request failed:', error);
    showErrorBanner(`Connection failed: ${error.message}`);
  } finally {
    state.isLoading = false;
    if (refreshBtn) { refreshBtn.style.opacity = '1'; refreshBtn.style.pointerEvents = 'auto'; }
  }
}

/**
 * Show error banner at top of dashboard
 */
function showErrorBanner(message) {
  // Remove existing banner
  const existing = document.getElementById('error-banner');
  if (existing) existing.remove();
  
  const banner = document.createElement('div');
  banner.id = 'error-banner';
  banner.style.cssText = `
    background: #fee2e2;
    color: #991b1b;
    padding: 10px 14px;
    border-radius: 6px;
    margin: 12px;
    font-size: 13px;
    border: 1px solid #fca5a5;
  `;
  banner.innerHTML = `<strong>⚠ Error:</strong> ${escapeHtml(message)}<br/><small>Check service worker console for details</small>`;
  
  const todayScreen = document.getElementById('screen-today');
  if (todayScreen) {
    todayScreen.insertBefore(banner, todayScreen.firstChild);
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
  // Alert section — only show if there are unacknowledged alerts
  const alertSection = document.getElementById('alert-section');
  const inbox = document.getElementById('alert-inbox');
  const unacknowledged = state.alerts.filter(a => !a.acknowledged);
  
  if (unacknowledged.length === 0) {
    alertSection.classList.add('hidden');
  } else {
    alertSection.classList.remove('hidden');
    inbox.innerHTML = unacknowledged.map(alert => `
      <div class="alert-item severity-${alert.severity}" data-alert-id="${alert.id}">
        <div class="alert-header">
          <span class="badge badge-${alert.severity}">${alert.severity.toUpperCase()}</span>
          <span class="alert-time">${formatTimestamp(alert.createdAt)}</span>
        </div>
        <div class="alert-message">${escapeHtml(alert.message)}</div>
      </div>
    `).join('');
    inbox.querySelectorAll('.alert-item').forEach(item => {
      item.addEventListener('click', () => acknowledgeAlert(item.dataset.alertId));
    });
  }
  
  // Sprint at a glance — collapsible (collapsed by default)
  const glanceSubtitle = document.getElementById('sprint-glance-subtitle');
  const glanceBody = document.getElementById('sprint-glance');
  const collapsedSummary = document.getElementById('sprint-glance-collapsed-summary');
  const sprintHeader = document.getElementById('sprint-glance-header');
  const sprintBody = document.getElementById('sprint-glance-body');
  const sprintChevron = document.getElementById('sprint-chevron');
  
  // Wire up collapse toggle (only once)
  if (sprintHeader && !sprintHeader.dataset.wired) {
    sprintHeader.dataset.wired = '1';
    sprintHeader.addEventListener('click', () => {
      const isCollapsed = sprintBody.style.display === 'none';
      sprintBody.style.display = isCollapsed ? '' : 'none';
      sprintChevron.textContent = isCollapsed ? '▼' : '▶';
    });
  }
  
  if (state.currentSprint) {
    const sp = state.currentSprint;
    const prediction = metrics.sprintBurndownPrediction(sp);
    const onTrack = prediction.onTrack;
    
    // Header summary (always visible)
    if (collapsedSummary) collapsedSummary.textContent = `${sp.name} · ${sp.completedPoints}/${sp.totalPoints}pts · Day ${sp.daysElapsed}/${sp.totalDays} · ${onTrack ? '✓ On track' : '⚠ At risk'}`;
    if (glanceSubtitle) glanceSubtitle.textContent = `${sp.completedPoints}/${sp.totalPoints} pts · Day ${sp.daysElapsed}/${sp.totalDays}`;
    
    // Story list in body
    const stories = sp.stories || [];
    if (stories.length > 0 && glanceBody) {
      const existingList = document.getElementById('sprint-story-list');
      if (existingList) existingList.remove();
      
      const STATUS_COLORS = {
        'done': '#22c55e', 'in progress': '#3b82f6', 'in review': '#8b5cf6',
        'blocked': '#ef4444', 'todo': 'var(--text-muted)', 'to do': 'var(--text-muted)',
        'qa rejected': '#f59e0b', 'open': 'var(--text-muted)'
      };
      const statusColor = (s) => STATUS_COLORS[(s || '').toLowerCase()] || 'var(--text-muted)';
      const statusIcon = (cat) => ({ done: '✓', inprogress: '●', new: '○' })[cat] || '○';
      
      const listEl = document.createElement('div');
      listEl.id = 'sprint-story-list';
      listEl.innerHTML = stories.map(s => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,rgba(255,255,255,0.05));">
          <span style="font-size:12px;color:${statusColor(s.status)};flex-shrink:0;padding-top:1px;" title="${escapeHtml(s.status)}">${statusIcon(s.statusCategory)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(s.summary)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">
              ${escapeHtml(s.key)}${s.assignee ? ` · ${escapeHtml(s.assignee)}` : ''}${s.points > 0 ? ` · ${s.points}pt` : ''}
            </div>
          </div>
          <span style="font-size:10px;color:${statusColor(s.status)};white-space:nowrap;flex-shrink:0;">${escapeHtml(s.status)}</span>
        </div>
      `).join('');
      glanceBody.appendChild(listEl);
    }
  } else {
    if (collapsedSummary) collapsedSummary.textContent = 'No active sprint';
    if (glanceSubtitle) glanceSubtitle.textContent = '';
  }
  
  // Sentry issues — one collapsible section per view
  const spikes = document.getElementById('sentry-spikes');
  const sentryEmpty = document.getElementById('sentry-empty');
  const totalBadge = document.getElementById('sentry-total');
  
  // Use per-view data if available, fall back to flat list
  const views = state.sentryViews && state.sentryViews.length > 0
    ? state.sentryViews
    : (state.sentryIssues.length > 0 ? [{ label: 'Issues', viewId: null, issues: state.sentryIssues, count: state.sentryIssues.length }] : []);
  
  // Total unique count across all views
  const allIds = new Set();
  views.forEach(v => (v.issues || []).forEach(i => i.id && allIds.add(i.id)));
  if (totalBadge) totalBadge.textContent = allIds.size > 0 ? `${allIds.size} total` : '';
  
  if (views.length === 0 || allIds.size === 0) {
    if (spikes) spikes.innerHTML = '';
    if (sentryEmpty) sentryEmpty.classList.remove('hidden');
    return;
  }
  
  if (sentryEmpty) sentryEmpty.classList.add('hidden');
  
  // Render one section per view
  spikes.innerHTML = views.map((view, idx) => {
    const issues = (view.issues || []);
    const sorted = [...issues].sort((a, b) => new Date(b.lastSeen || b.firstSeen) - new Date(a.lastSeen || a.firstSeen));
    
    const issueCards = sorted.map(issue => {
      const ageMs = Date.now() - new Date(issue.firstSeen).getTime();
      const ageHours = Math.round(ageMs / (60 * 60 * 1000));
      const ageStr = ageHours < 24 ? `${ageHours}h` : `${Math.floor(ageHours / 24)}d`;
      const assignee = issue.assignedTo?.name || issue.assignedTo?.username || null;
      const project = issue.project?.slug || issue.project || '';
      const permalink = issue.permalink || '#';
      
      return `
        <div class="card sentry-issue" style="cursor:pointer; margin-bottom:6px;" data-url="${escapeHtml(permalink)}">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;">
            ${project ? `<span style="font-size:10px;color:var(--text-muted);">${escapeHtml(project)}</span>` : ''}
            ${assignee ? `<span style="font-size:10px;color:var(--text-muted);">· 👤 ${escapeHtml(assignee)}</span>` : ''}
          </div>
          <div class="card-title" style="font-size:13px;">${escapeHtml(issue.title || issue.culprit || 'Untitled')}</div>
          <div class="card-subtitle">${ageStr} old · ${issue.count || 0} events · ${issue.userCount || 0} users</div>
        </div>`;
    }).join('');
    
    const sectionId = `sentry-view-${idx}`;
    return `
      <div class="sentry-view-section" style="margin-bottom:12px;">
        <div class="sentry-view-header" data-section="${sectionId}"
          style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;
          background:var(--surface-raised,#1f2937);border-radius:6px;cursor:pointer;user-select:none;">
          <span style="font-size:12px;font-weight:600;color:var(--text);">${escapeHtml(view.label)}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;font-weight:700;color:var(--primary,#60a5fa);">${view.count}</span>
            <span class="sentry-chevron" style="font-size:10px;color:var(--text-muted);">▼</span>
          </div>
        </div>
        <div id="${sectionId}" style="margin-top:6px;">${issueCards}</div>
      </div>`;
  }).join('');
  
  // Wire up collapsible headers
  spikes.querySelectorAll('.sentry-view-header').forEach(header => {
    header.addEventListener('click', () => {
      const id = header.getAttribute('data-section');
      const body = document.getElementById(id);
      const chevron = header.querySelector('.sentry-chevron');
      if (!body) return;
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      if (chevron) chevron.textContent = collapsed ? '▼' : '▶';
    });
  });
  
  // Wire up issue cards to open Sentry
  spikes.querySelectorAll('.sentry-issue').forEach(card => {
    card.addEventListener('click', () => {
      const url = card.getAttribute('data-url');
      if (url && url !== '#') window.open(url, '_blank');
    });
  });
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

/**
 * Listen for settings updates from settings page
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'settings-updated') {
    console.log('[popup] Settings updated, reloading...');
    location.reload();
  }
});

// Boot on load
boot();
