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
  sentryViews: [],
  supportTickets: [],
  extraBoardsData: [],
  sprintAnalytics: null,
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
  
  // Check if cache is fresh enough (< 2 minutes old) to skip fetch
  const cacheResult = await chrome.storage.local.get(['cache']);
  const lastFetch = cacheResult.cache?.lastFetch?.jira || cacheResult.cache?.lastFetch?.sentry;
  const cacheAge = lastFetch ? Date.now() - lastFetch : Infinity;
  const CACHE_GRACE_MS = 2 * 60 * 1000; // 2 minutes
  
  if (cacheAge < CACHE_GRACE_MS) {
    console.log(`[popup] Cache is fresh (${Math.round(cacheAge / 1000)}s old), skipping fetch`);
    renderCurrentScreen();
  } else {
    console.log('[popup] Cache stale or empty — fetching fresh data...');
    refreshDashboard();
  }
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
    const cacheResult = await chrome.storage.local.get([
      'settings', 'sprintHistory', 'currentSprint', 'sentryIssues',
      'sentryViews', 'supportTickets', 'alerts', 'extraBoardsData'
    ]);
    
    // Always refresh settings so squad.extraBoards reflects latest save
    if (cacheResult.settings) state.settings = cacheResult.settings;
    
    state.sprintHistory    = cacheResult.sprintHistory    || [];
    state.currentSprint    = cacheResult.currentSprint    || null;
    state.sentryIssues     = cacheResult.sentryIssues     || [];
    state.sentryViews      = cacheResult.sentryViews      || [];
    state.supportTickets   = cacheResult.supportTickets   || [];
    state.alerts           = cacheResult.alerts           || [];
    state.extraBoardsData  = cacheResult.extraBoardsData  || [];
    
    // Load sprint analytics from separate cache key
    if (state.currentSprint?.name) {
      const cacheKey = 'sprintAnalyticsCache';
      const analyticsResult = await chrome.storage.local.get([cacheKey]);
      const analyticsCache = analyticsResult[cacheKey] || {};
      state.sprintAnalytics = analyticsCache[state.currentSprint.name] || null;
    } else {
      state.sprintAnalytics = null;
    }
    
    console.log('[popup] Data loaded:', {
      extraBoardsConfigured: state.settings?.squad?.extraBoards?.length || 0,
      extraBoardsFetched: state.extraBoardsData.length,
      hasAnalytics: !!state.sprintAnalytics
    });
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
  
  // ── Show loading indicators across ALL sections ────────────────────
  // Sprint header
  const collapsedSummary = document.getElementById('sprint-glance-collapsed-summary');
  if (collapsedSummary) collapsedSummary.textContent = 'Loading…';
  const sprintCountEl = document.getElementById('sprint-glance-ticket-counts');
  if (sprintCountEl) sprintCountEl.innerHTML = '';
  
  // Sentry sections
  const spikes = document.getElementById('sentry-spikes');
  const sentryEmpty = document.getElementById('sentry-empty');
  const sentryTotal = document.getElementById('sentry-total');
  if (spikes) spikes.innerHTML = `<div style="padding:12px;text-align:center;font-size:12px;color:var(--text-muted);">Loading…</div>`;
  if (sentryEmpty) sentryEmpty.classList.add('hidden');
  if (sentryTotal) sentryTotal.textContent = '…';
  
  // Extra boards — keep visible but show refreshing state  
  const extraContainer = document.getElementById('extra-boards-container');
  if (extraContainer) {
    extraContainer.querySelectorAll('.section-label').forEach(el => {
      const count = el.querySelector('span:last-child');
      if (count) count.textContent = '…';
    });
  }
  
  // Refresh button disable
  const refreshBtn = document.getElementById('context-refresh');
  if (refreshBtn) { refreshBtn.style.opacity = '0.4'; refreshBtn.style.pointerEvents = 'none'; }
  
  try {
    await chrome.runtime.sendMessage({ type: 'refresh-dashboard' });
    console.log('[popup] Refresh started — data arrives via partial-update messages');
  } catch (error) {
    console.error('[popup] Failed to start refresh:', error);
    showErrorBanner(`Could not reach background: ${error.message}`);
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
  const countdown = document.getElementById('refresh-countdown');
  if (countdown) countdown.style.display = 'none';
  
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
  
  // Refresh button + countdown (always visible on dashboard screens)
  refresh.style.display = 'inline-block';
  if (countdown) {
    countdown.style.display = 'inline';
    // Re-run tick immediately so label is current after screen switch
    updateRefreshTimer();
  }
}

/**
 * Render extra boards as collapsible sections below the main sprint
 */
function renderExtraBoards() {
  const container = document.getElementById('extra-boards-container');
  if (!container) return;

  const boards = state.extraBoardsData || [];
  const configuredBoards = state.settings?.squad?.extraBoards || [];
  const jiraBase = state.settings?.jira?.baseUrl || '';

  if (configuredBoards.length === 0 || boards.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = boards.map((board, idx) => {
    const sectionId = `extra-board-${idx}`;

    if (board.error) {
      let hint = '';
      if (board.error.includes('does not support') || board.error.includes('404')) hint = 'No active sprint — is this a Kanban board?';
      else if (board.error.includes('403') || board.error.includes('401')) hint = 'Permission denied — check your Jira token.';
      else if (board.error.includes('400')) hint = 'Invalid board ID — check the board URL.';
      return `
        <div class="section">
          <div class="section-label">${escapeHtml(board.boardLabel)}</div>
          <div style="padding:10px;border-radius:6px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.3);margin-top:6px;">
            <div style="font-size:12px;color:#ef4444;">⚠ ${escapeHtml(board.error)}</div>
            ${hint ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${hint}</div>` : ''}
          </div>
        </div>`;
    }

    const isSupport = board.boardLabel.toLowerCase().includes('support');
    // For support boards, hide closed tickets — focus on actionable open tickets
    const displayStories = isSupport
      ? stories.filter(s => s.statusCategory !== 'done')
      : stories;
    const closedCount = stories.length - displayStories.length;
    const isKanban  = board.boardType === 'kanban';
    const stories   = board.stories || [];
    const progress  = board.totalPoints > 0
      ? `${board.completedPoints}/${board.totalPoints}pt`
      : `${board.totalStories} issues`;
    const subLabel  = isKanban
      ? `Kanban · ${progress}`
      : `${board.sprintName || 'No active sprint'} · ${progress}`;

    return `
      <div class="section">
        <div class="section-label" style="display:flex;align-items:center;justify-content:space-between;">
          <span>${escapeHtml(board.boardLabel)}</span>
          <span style="font-size:11px;font-weight:600;color:var(--text-muted);">${isSupport ? displayStories.length + ' OPEN' : board.totalStories + ' TOTAL'}</span>
        </div>
        <div id="${sectionId}-header" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;padding:10px;background:var(--surface-raised,#1f2937);border-radius:8px;margin-top:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(subLabel)}</div>
            <div style="margin-top:3px;">${collapsedBoardSummary(displayStories, isSupport)}${closedCount > 0 ? ` <span style="font-size:10px;color:var(--text-muted);">· ${closedCount} closed hidden</span>` : ''}</div>
          </div>
          <span id="${sectionId}-chevron" style="color:var(--text-muted);font-size:12px;margin-left:8px;flex-shrink:0;">▶</span>
        </div>
        <div id="${sectionId}-body" style="display:none;margin-top:6px;">
          ${displayStories.map(s => renderTicketRow(s, jiraBase)).join('') || '<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center;">No open issues</div>'}
        </div>
      </div>`;
  }).join('');

  boards.forEach((board, idx) => {
    if (board.error) return;
    const sectionId = `extra-board-${idx}`;
    const header  = document.getElementById(`${sectionId}-header`);
    const body    = document.getElementById(`${sectionId}-body`);
    const chevron = document.getElementById(`${sectionId}-chevron`);
    if (header) {
      header.addEventListener('click', () => {
        const collapsed = body.style.display === 'none';
        body.style.display = collapsed ? '' : 'none';
        chevron.textContent = collapsed ? '▼' : '▶';
      });
    }
    if (body) wireTicketClicks(body);
  });
}

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
 * Render sprint analytics section (burndown + timesheet charts).
 * Called from renderTodayScreen after the sprint section renders.
 */
function renderSprintAnalytics() {
  const wrap    = document.getElementById('sprint-analytics-wrap');
  const content = document.getElementById('sprint-analytics-content');
  const header  = document.getElementById('sprint-analytics-header');
  const body    = document.getElementById('sprint-analytics-body');
  const chevron = document.getElementById('analytics-chevron');
  
  if (!wrap || !content) return;
  
  // Wire collapse toggle once
  if (header && !header.dataset.wired) {
    header.dataset.wired = '1';
    header.addEventListener('click', () => {
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      chevron.textContent = collapsed ? '▼' : '▶';
    });
  }
  
  const analytics = state.sprintAnalytics;
  if (!analytics) {
    wrap.style.display = 'none';
    return;
  }
  
  wrap.style.display = '';
  
  // ── Burndown ──────────────────────────────────────────────────────
  const bd = analytics.burndown;
  let burndownHtml = '';
  if (bd && bd.ideal && bd.ideal.length > 0) {
    burndownHtml = buildBurndownSVG(bd);
  } else {
    burndownHtml = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No point data available yet.</div>';
  }
  
  // ── Timesheet ─────────────────────────────────────────────────────
  const ts = analytics.timesheet || [];
  const monitored = state.settings?.analytics?.monitoredMembers;
  const filteredTs = monitored && monitored.length > 0
    ? ts.filter(m => monitored.includes(m.name))
    : ts;
  let timesheetHtml = '';
  if (filteredTs.length > 0) {
    timesheetHtml = buildTimesheetSVG(filteredTs, analytics.week1Label || 'Week 1', analytics.week2Label || 'Week 2');
  } else {
    timesheetHtml = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No worklog data for this sprint yet.</div>';
  }
  
  const contentEl = document.getElementById('sprint-analytics-content');
  if (!contentEl) return;
  
  // Measure available width — side by side if >= 520px, else stacked
  const panelWidth = contentEl.offsetWidth || window.innerWidth || 380;
  const sideBySide = panelWidth >= 520;
  
  const outerStyle = sideBySide
    ? 'display:flex;gap:12px;align-items:flex-start;'
    : '';
  const chartWrapStyle = sideBySide
    ? 'flex:1;min-width:0;'
    : 'margin-bottom:12px;';
  
  content.innerHTML = `
    <div style="${outerStyle}">
      <div style="${chartWrapStyle}">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;letter-spacing:0.3px;">BURNDOWN</div>
        ${burndownHtml}
      </div>
      <div style="${chartWrapStyle}">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;letter-spacing:0.3px;">TIME LOGGED</div>
        ${timesheetHtml}
      </div>
    </div>`;
  
  // Re-render if panel is resized past the breakpoint
  if (!wrap._resizeObserver) {
    wrap._resizeObserver = new ResizeObserver(() => {
      const newWidth = contentEl.offsetWidth || 380;
      const wasSideBySide = sideBySide;
      const isSideBySide = newWidth >= 520;
      if (wasSideBySide !== isSideBySide) renderSprintAnalytics();
    });
    wrap._resizeObserver.observe(wrap);
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
  
  // Update section title: "Current Sprint (HRM Sprint 64)" + total count
  const sprintTitleEl = document.getElementById('current-sprint-title');
  const sprintTotalEl = document.getElementById('current-sprint-total');
  
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
    
    // Section title + total count
    if (sprintTitleEl) sprintTitleEl.textContent = `Current Sprint (${sp.name})`;
    if (sprintTotalEl) sprintTotalEl.textContent = `${sp.totalStories} TICKETS`;
    const prediction = metrics.sprintBurndownPrediction(sp);
    const onTrack = prediction.onTrack;
    
    let statusText;
    if (prediction.risk === 'early') {
      statusText = `📊 Too early — expected ${prediction.expectedDailyVelocity}pt/day`;
    } else if (prediction.risk === 'no-data') {
      statusText = '— No point data';
    } else {
      statusText = onTrack ? '✓ On track' : `⚠ At risk (${prediction.dailyVelocity}pt/day, need ${prediction.expectedDailyVelocity}pt/day)`;
    }
    
    if (collapsedSummary) collapsedSummary.textContent = `${sp.name} · ${sp.completedPoints}/${sp.totalPoints}pt · Day ${sp.daysElapsed}/${sp.totalDays} · ${statusText}`;
    if (glanceSubtitle) glanceSubtitle.textContent = '';
    
    // Ticket counts in collapsed header (always visible)
    const countEl = document.getElementById('sprint-glance-ticket-counts');
    const stories = sp.stories || [];
    const isSupport = (sp.boardLabel||sp.boardName||state.settings?.squad?.key||'').toLowerCase().includes('support');
    if (countEl && stories.length > 0) {
      countEl.innerHTML = collapsedBoardSummary(stories, isSupport);
    }
    
    // Story list in body (no summary line — it's in the header now)
    if (stories.length > 0 && glanceBody) {
      const existingList = document.getElementById('sprint-story-list');
      if (existingList) existingList.remove();
      const jiraBase = state.settings?.jira?.baseUrl || '';
      const listEl = document.createElement('div');
      listEl.id = 'sprint-story-list';
      listEl.innerHTML = stories.map(s => renderTicketRow(s, jiraBase)).join('');
      glanceBody.appendChild(listEl);
      wireTicketClicks(listEl);
    }
  } else {
    if (sprintTitleEl) sprintTitleEl.textContent = 'Current Sprint';
    if (sprintTotalEl) sprintTotalEl.textContent = '';
    if (collapsedSummary) collapsedSummary.textContent = 'No active sprint';
    if (glanceSubtitle) glanceSubtitle.textContent = '';
  }

  // Extra boards — collapsible sections
  renderExtraBoards();
  
  // Sprint analytics charts (burndown + timesheet)
  renderSprintAnalytics();
  
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
      <div class="sentry-view-section" style="margin-bottom:8px;">
        <div class="sentry-view-header" data-section="${sectionId}"
          style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;
          background:var(--surface-raised,#1f2937);border-radius:6px;cursor:pointer;user-select:none;">
          <span style="font-size:12px;font-weight:600;color:var(--text);">${escapeHtml(view.label)}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;font-weight:700;color:var(--primary,#60a5fa);">${view.count}</span>
            <span class="sentry-chevron" style="font-size:10px;color:var(--text-muted);">▶</span>
          </div>
        </div>
        <div id="${sectionId}" style="margin-top:6px; display:none;">${issueCards}</div>
      </div>`;
  }).join('');
  
  // Wire up collapsible headers (all collapsed by default)
  spikes.querySelectorAll('.sentry-view-header').forEach(header => {
    header.addEventListener('click', () => {
      const id = header.getAttribute('data-section');
      const body = document.getElementById(id);
      const chevron = header.querySelector('.sentry-chevron');
      if (!body) return;
      const isCollapsed = body.style.display === 'none';
      body.style.display = isCollapsed ? '' : 'none';
      if (chevron) chevron.textContent = isCollapsed ? '▼' : '▶';
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
 * Utility: format due date — returns HTML string with colour coding
 * Red = overdue, Amber = due within 2 days, normal = upcoming
 */
function formatDueDate(dateStr) {
  if (!dateStr) return '';
  const due  = new Date(dateStr);
  const days = Math.ceil((due - new Date()) / (1000 * 60 * 60 * 24));
  const label = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (days < 0)  return `<span style="color:#ef4444;">⚠ due ${label}</span>`;
  if (days <= 2) return `<span style="color:#f59e0b;">📅 ${label}</span>`;
  return `📅 ${label}`;
}

// ── Inline SVG chart builders ────────────────────────────────────────────
// (Ported from src/chart-svg.js — popup.js cannot import src/ at runtime in MV3)

const _C = { ideal:'#94a3b8', estimate:'#60a5fa', actual:'#34d399', week1:'#6366f1', week2:'#a78bfa', grid:'rgba(148,163,184,0.2)', text:'var(--color-text-secondary,#94a3b8)' };

function _niceStep(max, steps=4) {
  if (!max) return 1;
  const raw = max / steps;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return ([1,2,5,10].find(m => m*mag >= raw) || 10) * mag;
}

function buildBurndownSVG(bd) {
  const W=320, H=150, PAD={top:10,right:16,bottom:38,left:36};
  const PW=W-PAD.left-PAD.right, PH=H-PAD.top-PAD.bottom;
  const { ideal, estimate, actual, labels, totalPoints, totalDays, hasActualData } = bd;
  const step = _niceStep(totalPoints, 4);
  const yMax = Math.ceil(totalPoints / step) * step || 1;
  const px = d => PAD.left + (d/totalDays)*PW;
  const py = v => PAD.top + PH - (Math.max(0,v)/yMax)*PH;
  const poly = (arr,col,dash='') => {
    const pts = arr.map((v,i)=>`${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
  };
  let grid='', ylbl='';
  for (let v=0; v<=yMax; v+=step) {
    const y=py(v).toFixed(1);
    grid+=`<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="${_C.grid}" stroke-width="1"/>`;
    ylbl+=`<text x="${PAD.left-4}" y="${y}" text-anchor="end" dominant-baseline="central" fill="${_C.text}" font-size="10" font-family="system-ui">${v}</text>`;
  }
  const xStep = totalDays<=7?1:2;
  let xlbl='';
  for (let d=0; d<=totalDays; d+=xStep) {
    const lbl = (labels&&labels[d]) ? labels[d].replace(/\s\d{4}$/,'') : `D${d}`;
    xlbl+=`<text x="${px(d).toFixed(1)}" y="${H-PAD.bottom+14}" text-anchor="middle" fill="${_C.text}" font-size="10" font-family="system-ui">${lbl}</text>`;
  }
  const ly=H-8;
  const legend=`
    <line x1="${PAD.left}" y1="${ly}" x2="${PAD.left+14}" y2="${ly}" stroke="${_C.ideal}" stroke-width="2" stroke-dasharray="4 2"/>
    <text x="${PAD.left+18}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="10" font-family="system-ui">Ideal</text>
    <line x1="${PAD.left+52}" y1="${ly}" x2="${PAD.left+66}" y2="${ly}" stroke="${_C.estimate}" stroke-width="2"/>
    <text x="${PAD.left+70}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="10" font-family="system-ui">By due date</text>
    ${hasActualData ? `<line x1="${PAD.left+140}" y1="${ly}" x2="${PAD.left+154}" y2="${ly}" stroke="${_C.actual}" stroke-width="2"/><text x="${PAD.left+158}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="10" font-family="system-ui">Actual</text>` : `<text x="${PAD.left+140}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="9" opacity="0.5">Actual: no data yet</text>`}`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
    ${grid}<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${H-PAD.bottom}" stroke="${_C.grid}" stroke-width="1"/>
    <line x1="${PAD.left}" y1="${H-PAD.bottom}" x2="${W-PAD.right}" y2="${H-PAD.bottom}" stroke="${_C.grid}" stroke-width="1"/>
    ${ylbl}${xlbl}${poly(ideal,_C.ideal,'5 3')}${poly(estimate,_C.estimate)}
    ${hasActualData?poly(actual,_C.actual):''}${legend}</svg>`;
}

function buildTimesheetSVG(members, w1Lbl='Week 1', w2Lbl='Week 2') {
  if (!members.length) return '';
  
  const W = 300;
  const NAME_W = 100;  // wider for full names
  const PW = W - NAME_W - 8;
  const BAR_H = 7;     // slimmer bars
  const ROW_H = 20;    // tighter rows
  const PAD_TOP = 8;
  const PAD_BOT = 28;
  const H = PAD_TOP + members.length * ROW_H + PAD_BOT;
  
  const maxHours = Math.max(...members.map(m => Math.max(m.week1, m.week2, 0.1)));
  const bw = h => Math.max(1, (h / maxHours) * PW);
  const baseX = NAME_W;
  
  let rows = '';
  members.forEach((m, i) => {
    const y1 = PAD_TOP + i * ROW_H;
    const y2 = y1 + BAR_H + 2;
    const w1 = bw(m.week1), w2 = bw(m.week2);
    // Full display name, truncated only if very long
    const displayName = m.name.length > 14 ? m.name.substring(0, 13) + '…' : m.name;
    rows += `
      <text x="${NAME_W - 5}" y="${y1 + BAR_H/2 + 1}" text-anchor="end" dominant-baseline="central" fill="${_C.text}" font-size="9.5" font-family="system-ui">${displayName}</text>
      <rect x="${baseX}" y="${y1}" width="${w1.toFixed(1)}" height="${BAR_H}" fill="${_C.week1}" rx="2"/>
      ${m.week1 > 0 ? `<text x="${baseX + w1 + 3}" y="${y1 + BAR_H/2 + 1}" dominant-baseline="central" fill="${_C.text}" font-size="9" font-family="system-ui">${m.week1}h</text>` : ''}
      <rect x="${baseX}" y="${y2}" width="${w2.toFixed(1)}" height="${BAR_H}" fill="${_C.week2}" rx="2"/>
      ${m.week2 > 0 ? `<text x="${baseX + w2 + 3}" y="${y2 + BAR_H/2 + 1}" dominant-baseline="central" fill="${_C.text}" font-size="9" font-family="system-ui">${m.week2}h</text>` : ''}`;
  });
  
  let grid = '';
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const x = (baseX + (i / steps) * PW).toFixed(1);
    grid += `<line x1="${x}" y1="${PAD_TOP}" x2="${x}" y2="${H - PAD_BOT}" stroke="${_C.grid}" stroke-width="1"/>`;
    const label = Math.round((i / steps) * maxHours);
    grid += `<text x="${x}" y="${H - PAD_BOT + 10}" text-anchor="middle" fill="${_C.text}" font-size="9" font-family="system-ui">${label}h</text>`;
  }
  
  const ax = `<line x1="${baseX}" y1="${PAD_TOP}" x2="${baseX}" y2="${H - PAD_BOT}" stroke="${_C.grid}" stroke-width="1"/>`;
  
  const ly = H - 8;
  const legend = `
    <rect x="${baseX}" y="${ly - 5}" width="9" height="7" fill="${_C.week1}" rx="1"/>
    <text x="${baseX + 13}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="9" font-family="system-ui">${w1Lbl}</text>
    <rect x="${baseX + 60}" y="${ly - 5}" width="9" height="7" fill="${_C.week2}" rx="1"/>
    <text x="${baseX + 73}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="9" font-family="system-ui">${w2Lbl}</text>`;
  
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
    ${grid}${ax}${rows}${legend}</svg>`;
}

/**
 * Sprint-change banner — ask user to keep or delete old sprint analytics
 */
function showSprintChangedBanner(oldSprintName) {
  const existing = document.getElementById('sprint-changed-banner');
  if (existing) existing.remove();
  
  const banner = document.createElement('div');
  banner.id = 'sprint-changed-banner';
  banner.style.cssText = 'padding:10px 12px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.3);border-radius:8px;margin-bottom:8px;font-size:12px;color:var(--text);';
  banner.innerHTML = `
    <div style="margin-bottom:6px;">Sprint <strong>"${escapeHtml(oldSprintName)}"</strong> is no longer active. Keep its analytics for history?</div>
    <div style="display:flex;gap:8px;">
      <button id="keep-sprint-analytics" style="padding:4px 10px;background:var(--surface-raised,#1f2937);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;cursor:pointer;">Keep</button>
      <button id="delete-sprint-analytics" style="padding:4px 10px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:4px;color:#ef4444;font-size:12px;cursor:pointer;">Delete</button>
    </div>`;
  
  const screenContainer = document.getElementById('screen-container');
  if (screenContainer) screenContainer.prepend(banner);
  
  document.getElementById('keep-sprint-analytics')?.addEventListener('click', () => banner.remove());
  document.getElementById('delete-sprint-analytics')?.addEventListener('click', async () => {
    const { deleteCachedSprintData } = await import('./src/sprint-cache.js').catch(() => ({}));
    if (deleteCachedSprintData) await deleteCachedSprintData(oldSprintName);
    else {
      // Fallback: direct storage access
      const r = await chrome.storage.local.get(['sprintAnalyticsCache']);
      const c = r.sprintAnalyticsCache || {};
      delete c[oldSprintName];
      await chrome.storage.local.set({ sprintAnalyticsCache: c });
    }
    banner.remove();
  });
}

const PRIORITY_DOT = {
  highest: '<span title="Highest" style="color:#ef4444;font-size:9px;flex-shrink:0;">●</span>',
  critical:'<span title="Critical" style="color:#ef4444;font-size:9px;flex-shrink:0;">●</span>',
  high:    '<span title="High"    style="color:#f97316;font-size:9px;flex-shrink:0;">●</span>',
  medium:  '<span title="Medium"  style="color:#f59e0b;font-size:9px;flex-shrink:0;">●</span>',
  low:     '<span title="Low"     style="color:#60a5fa;font-size:9px;flex-shrink:0;">●</span>',
  lowest:  '<span title="Lowest"  style="color:#94a3b8;font-size:9px;flex-shrink:0;">●</span>'
};
const TICKET_STATUS_COLORS = {
  'done':'#22c55e','in progress':'#3b82f6','in review':'#8b5cf6',
  'blocked':'#ef4444','todo':'var(--text-muted)','to do':'var(--text-muted)',
  'qa rejected':'#f59e0b','open':'var(--text-muted)'
};
function ticketStatusColor(s){ return TICKET_STATUS_COLORS[(s||'').toLowerCase()]||'var(--text-muted)'; }
function ticketStatusIcon(cat){ return ({done:'✓',indeterminate:'●',new:'○'})[cat]||'○'; }
function priorityDot(p){ return PRIORITY_DOT[(p||'medium').toLowerCase()]||PRIORITY_DOT.medium; }

/** Render one Jira ticket row — clickable, with priority dot */
function renderTicketRow(story, jiraBaseUrl) {
  const url = jiraBaseUrl ? `${jiraBaseUrl.replace(/\/$/,'')}/browse/${story.key}` : null;
  const duePart = story.dueDate ? formatDueDate(story.dueDate) : '';
  return `
    <div class="ticket-row" ${url ? `data-url="${escapeHtml(url)}"` : ''} style="display:flex;align-items:flex-start;gap:6px;padding:6px 0;border-bottom:1px solid var(--border,rgba(255,255,255,0.05));${url?'cursor:pointer;':''}">
      ${priorityDot(story.priority)}
      <span style="font-size:12px;color:${ticketStatusColor(story.status)};flex-shrink:0;padding-top:1px;" title="${escapeHtml(story.status)}">${ticketStatusIcon(story.statusCategory)}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(story.summary)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">
          ${escapeHtml(story.key)}${story.assignee?` · ${escapeHtml(story.assignee)}`:''}${story.points>0?` · ${story.points}pt`:''}${duePart?` · ${duePart}`:''}
        </div>
      </div>
      <span style="font-size:10px;color:${ticketStatusColor(story.status)};white-space:nowrap;flex-shrink:0;">${escapeHtml(story.status)}</span>
    </div>`;
}

/**
 * Ticket counts — grouped by actual status names (not just category buckets).
 * Shows the real distribution from Jira, whatever the workflow is.
 */
function ticketCounts(stories) {
  // Group by status name, case-insensitive
  const byStatus = {};
  for (const s of stories) {
    const name = s.status || 'Unknown';
    byStatus[name] = (byStatus[name] || 0) + 1;
  }
  
  // Labels for support analytics
  const breached = stories.filter(s => s.labels?.includes('BreachedSLA')).length;
  const blocked  = stories.filter(s => s.labels?.includes('blocked-external')).length;
  
  return { byStatus, breached, blocked, total: stories.length };
}

/** Collapsed header summary — shows real status distribution */
function collapsedBoardSummary(stories, isSupport) {
  const { byStatus, breached, blocked } = ticketCounts(stories);
  
  // Sort statuses: done-category last, show all non-zero
  const statusParts = Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1]) // highest count first
    .map(([name, count]) => `${count} ${name}`)
    .join(' · ');
  
  let html = `<span style="font-size:11px;color:var(--text-muted);">${statusParts || 'No tickets'}</span>`;
  
  if (isSupport) {
    if (breached > 0) html += ` <span style="color:#ef4444;font-size:11px;font-weight:600;">· ${breached} BreachedSLA 🔴</span>`;
    if (blocked  > 0) html += ` <span style="color:#f59e0b;font-size:11px;font-weight:600;">· ${blocked} blocked-external ⚠</span>`;
  }
  return html;
}

/** ticketSummaryHTML kept for backward compat — delegates to collapsedBoardSummary */
function ticketSummaryHTML(stories, isSupport) {
  return collapsedBoardSummary(stories, isSupport);
}

/** Wire click events on ticket rows inside a container element */
function wireTicketClicks(container) {
  container.querySelectorAll('.ticket-row[data-url]').forEach(row => {
    row.addEventListener('click', () => window.open(row.dataset.url, '_blank'));
  });
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
  if (message.type === 'partial-update') {
    console.log(`[popup] Partial update received: ${message.source}`);
    loadData().then(() => {
      renderCurrentScreen();
      // Start/reset timer when Jira data arrives (that's when the fetch "started")
      if (message.source === 'jira') startRefreshTimer(Date.now());
      // Remove any error banners on success
      const errBanner = document.getElementById('error-banner');
      if (errBanner) errBanner.remove();
    }).catch(e => console.error('[popup] partial-update render failed:', e));
    return;
  }
  if (message.type === 'sprint-changed') {
    showSprintChangedBanner(message.oldSprintName);
    return;
  }
  if (message.type === 'settings-updated') {
    console.log('[popup] Settings updated — forcing fresh fetch...');
    chrome.storage.local.set({ cache: { lastFetch: { jira: 0, sentry: 0 } } })
      .then(() => location.reload());
  }
});

// Boot on load
boot();

/**
 * Refresh timer beside the ↻ button
 * 3 states:
 *   elapsed < 5 min  → "just now" / "Xm ago"
 *   elapsed >= 5 min → countdown mm:ss to the 30-min mark
 *   countdown hits 0 → auto-refresh fires
 */
const REFRESH_CYCLE_MS  = 30 * 60 * 1000; // 30 minutes
const ELAPSED_MODE_MS   =  5 * 60 * 1000; // switch to countdown after 5 min

let _timerInterval  = null;
let _lastFetchTime  = null; // set after every successful fetch

function setLastFetchTime(ts) {
  _lastFetchTime = ts;
  updateRefreshTimer();
}

function updateRefreshTimer() {
  const el = document.getElementById('refresh-countdown');
  if (!el) return;
  if (!_lastFetchTime) { el.textContent = ''; return; }

  const elapsed   = Date.now() - _lastFetchTime;
  const remaining = Math.max(0, REFRESH_CYCLE_MS - elapsed);

  if (elapsed < ELAPSED_MODE_MS) {
    // "just now" / "Xm ago"
    const mins = Math.floor(elapsed / 60000);
    el.textContent = mins < 1 ? 'just now' : `${mins}m ago`;
    el.style.color = 'var(--text-muted)';
  } else {
    // Countdown to 30-min mark
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    el.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    // Go amber as it gets close (under 5 min remaining)
    el.style.color = remaining < 5 * 60 * 1000 ? '#f59e0b' : 'var(--text-muted)';

    // Countdown finished — auto-refresh
    if (remaining === 0) {
      console.log('[popup] Auto-refresh triggered by timer');
      refreshDashboard();
    }
  }
}

function startRefreshTimer(lastFetchTimestamp) {
  if (_timerInterval) clearInterval(_timerInterval);
  _lastFetchTime = lastFetchTimestamp;
  updateRefreshTimer();
  _timerInterval = setInterval(updateRefreshTimer, 1000);
}

// Initialise timer from cache on panel open
(async function initRefreshTimer() {
  const result = await chrome.storage.local.get(['cache']);
  const lastFetch = result.cache?.lastFetch?.jira || result.cache?.lastFetch?.sentry;
  if (lastFetch) startRefreshTimer(lastFetch);
  else {
    // No cache yet — timer will start once first fetch completes
    const el = document.getElementById('refresh-countdown');
    if (el) el.textContent = '';
  }
})();
