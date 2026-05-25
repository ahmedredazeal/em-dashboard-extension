/**
 * popup.js
 * Main app controller for EM Dashboard side panel
 * ES module with imports from src/
 */

import * as privacyMode from './src/privacy-mode.js';
import * as metrics from './src/metrics.js';
import { getTrendSamples } from './src/sentry-trend.js';
import { assignProjectColors, currentQuarters } from './src/worklog-aggregator.js';

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
  isLoading: false,
  timesheetMode: 'sprint',   // 'sprint' | 'Q1' | 'Q2' | 'Q3' | 'Q4'
  quarterWorklogCache: {},   // { Q1: {members, issueTypeSplit, fetchedAt, startDate, endDate} }
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
/** Helper: show/hide section loading pills */
function setSectionLoading(source, loading) {
  const pills = {
    jira:   ['sprint-loading-pill', 'insights-loading-pill'],
    sentry: ['sentry-loading-pill'],
    all:    ['sprint-loading-pill', 'insights-loading-pill', 'sentry-loading-pill']
  };
  const ids = pills[source] || [];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('visible', loading);
  });
}

async function refreshDashboard() {
  console.log('[popup] Requesting dashboard refresh...');
  state.isLoading = true;
  
  // ── Show loading on ALL sections simultaneously ────────────────────
  setSectionLoading('all', true);
  
  const collapsedSummary = document.getElementById('sprint-glance-collapsed-summary');
  if (collapsedSummary) collapsedSummary.textContent = 'Refreshing…';
  
  const sprintCountEl = document.getElementById('sprint-glance-ticket-counts');
  if (sprintCountEl) sprintCountEl.innerHTML = '';
  
  const spikes = document.getElementById('sentry-spikes');
  const sentryEmpty = document.getElementById('sentry-empty');
  const sentryTotal = document.getElementById('sentry-total');
  if (spikes) spikes.innerHTML = `<div style="padding:12px;text-align:center;font-size:12px;color:var(--text-muted);">Loading…</div>`;
  if (sentryEmpty) sentryEmpty.classList.add('hidden');
  if (sentryTotal) sentryTotal.textContent = '…';
  
  // Extra boards — show loading on each board's total count
  const extraContainer = document.getElementById('extra-boards-container');
  if (extraContainer) {
    extraContainer.querySelectorAll('.section-loading-pill').forEach(el => el.classList.add('visible'));
  }
  
  const refreshBtn = document.getElementById('context-refresh');
  if (refreshBtn) { refreshBtn.style.opacity = '0.4'; refreshBtn.style.pointerEvents = 'none'; }
  
  try {
    await chrome.runtime.sendMessage({ type: 'refresh-dashboard' });
    console.log('[popup] Refresh started — data arrives via partial-update messages');
  } catch (error) {
    setSectionLoading('all', false);
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
    const stories   = board.stories || [];  // for support boards these are already API-filtered to exclude closed
    const isKanban  = board.boardType === 'kanban';
    // Support boards: API already excluded closed tickets — no client-side filter needed
    const displayStories = stories;
    const progress  = board.totalPoints > 0
      ? `${board.completedPoints}/${board.totalPoints}pt`
      : `${board.totalStories} issues`;
    const subLabel  = isKanban
      ? `Kanban · ${progress}`
      : `${board.sprintName || 'No active sprint'} · ${progress}`;

    return `
      <div class="section">
        <div id="${sectionId}-section-label" class="section-label" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;">
          <span>${escapeHtml(board.boardLabel)}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="section-loading-pill" id="board-loading-${idx}">Refreshing</span>
            <span style="font-size:11px;font-weight:600;color:var(--text-muted);">${isSupport ? displayStories.length + ' OPEN' : board.totalStories + ' TOTAL'}</span>
            <span id="${sectionId}-section-chevron" style="color:var(--text-muted);font-size:12px;">&#9654;</span>
          </div>
        </div>
        <div id="${sectionId}-section-body" style="display:none;margin-top:8px;">
          <div style="padding:10px;background:var(--surface-raised);border-radius:8px;margin-bottom:6px;">
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(subLabel)}</div>
            <div style="margin-top:3px;">${collapsedBoardSummary(displayStories, isSupport)}</div>
          </div>
          <div id="${sectionId}-body">
            ${displayStories.map(s => renderTicketRow(s, jiraBase)).join('') || '<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center;">No open issues</div>'}
          </div>
        </div>
      </div>`;
  }).join('');

  boards.forEach((board, idx) => {
    if (board.error) return;
    const sectionId  = `extra-board-${idx}`;
    const label      = document.getElementById(`${sectionId}-section-label`);
    const sectionBody = document.getElementById(`${sectionId}-section-body`);
    const chevron    = document.getElementById(`${sectionId}-section-chevron`);
    const ticketBody = document.getElementById(`${sectionId}-body`);
    
    if (label && sectionBody) {
      label.addEventListener('click', () => {
        const open = sectionBody.style.display !== 'none';
        sectionBody.style.display  = open ? 'none' : '';
        chevron.textContent        = open ? '▶' : '▼';
      });
    }
    if (ticketBody) wireTicketClicks(ticketBody);
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
// ── Insights section rendering ────────────────────────────────────────
function renderInsights() {
  const content = document.getElementById('insights-content');
  if (!content) return;

  const analytics = state.sprintAnalytics;
  if (!analytics) {
    content.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No sprint analytics data yet.</div>';
    return;
  }

  
  // ── Sprint progress bar (top of analytics) ──────────────────────────
  const currentStories = state.currentSprint?.stories || [];
  const progressHtml = currentStories.length > 0 ? buildSprintProgressBar(currentStories) : '';
  
  // ── Burndown ──────────────────────────────────────────────────────
  const bd = analytics.burndown;
  let burndownHtml = (bd && bd.ideal?.length > 0)
    ? buildBurndownSVG(bd)
    : '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No point data yet.</div>';
  
  // ── Timesheet with inline member filter + quarter dropdown ───────────────
  const ts = analytics.timesheet || [];
  // Detect legacy format ({name, week1, week2} — pre-v1.5.4) and prompt refresh
  const isLegacyFormat = ts.length > 0 && ts[0].week1 !== undefined && !ts[0].byProject;
  const monitored = state.settings?.analytics?.monitoredMembers;
  const filteredTs = monitored?.length > 0 ? ts.filter(m => monitored.includes(m.name)) : ts;
  const discoveredMembers = state.settings?.analytics?.discoveredMembers || ts.map(m => m.name);
  
  // Quarter dropdown (Sprint + available quarters in current year)
  const now = new Date();
  const quarters = currentQuarters(now.getFullYear(), now.getMonth() + 1);
  const currentMode = state.timesheetMode || 'sprint'; // 'sprint' | 'Q1' | 'Q2' etc
  
  const quarterOptions = [
    `<option value="sprint" ${currentMode === 'sprint' ? 'selected' : ''}>Sprint</option>`,
    ...quarters.map(q =>
      `<option value="${q.label}" ${currentMode === q.label ? 'selected' : ''}>${q.label} (${q.start.slice(5,7)}–${q.end.slice(5,7)})</option>`
    )
  ].join('');
  
  const modeDropdown = `<select id="timesheet-mode-select" style="font-size:10px;padding:2px 4px;background:var(--surface-raised);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;">${quarterOptions}</select>`;
  
  // ── Member filter — ONE popover, two trigger buttons ─────────────────
  // Rendering memberFilterHtml in two cards creates duplicate IDs (same string).
  // Fix: full popover in TIME LOGGED, a trigger-only button in ESTIMATE.
  const filteredCount = filteredTs.length;
  const totalCount    = discoveredMembers.length;

  const memberFilterHtml = discoveredMembers.length > 0 ? `
    <div style="position:relative;display:inline-block;">
      <button id="member-filter-btn" title="Filter team members"
        style="background:none;border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:4px;padding:2px 6px;color:var(--text-muted);font-size:11px;cursor:pointer;line-height:1.4;">
        👥 ${filteredCount}/${totalCount}
      </button>
      <div id="member-filter-popover"
        style="display:none;position:absolute;right:0;top:calc(100% + 4px);z-index:99;
               background:var(--surface);border:1px solid var(--border);border-radius:8px;
               padding:10px;min-width:180px;box-shadow:0 8px 24px rgba(0,0,0,0.4);">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px;
                    display:flex;justify-content:space-between;align-items:center;">
          <span>Team members</span>
          <span id="member-filter-select-all" style="color:var(--primary,#6366f1);cursor:pointer;">All</span>
        </div>
        <div id="member-filter-list" style="display:flex;flex-direction:column;gap:5px;max-height:180px;overflow-y:auto;">
          ${discoveredMembers.map(name => {
            const checked = !monitored || monitored.length === 0 || monitored.includes(name);
            return `<label style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text);cursor:pointer;">
              <input type="checkbox" class="member-filter-cb" data-name="${escapeHtml(name)}"
                ${checked ? 'checked' : ''}
                style="accent-color:var(--primary,#6366f1);width:13px;height:13px;"/>
              ${escapeHtml(name)}
            </label>`;
          }).join('')}
        </div>
        <button id="member-filter-apply"
          style="margin-top:10px;width:100%;padding:5px;background:var(--primary,#6366f1);
                 border:none;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">Apply</button>
      </div>
    </div>` : '';

  // (Estimate vs Actual uses the same filter btn in the shared control bar above)
  
  // Determine which member list to render for the timesheet
  const timesheetMembers = (currentMode === 'sprint')
    ? filteredTs
    : state.quarterWorklogCache?.[currentMode]?.members || null;
  
  let timesheetHtml = '';
  if (isLegacyFormat) {
    timesheetHtml = `<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">
      Data format updated — click ↻ to refresh and load cross-squad time data.</div>`;
  } else if (currentMode !== 'sprint' && timesheetMembers === null) {
    timesheetHtml = `<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">
      Loading ${currentMode} data… <span id="timesheet-loading-indicator">⏳</span></div>`;
  } else if ((timesheetMembers || []).length > 0) {
    timesheetHtml = buildTimesheetSVG(timesheetMembers);
  } else {
    timesheetHtml = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No worklog data yet — open the panel daily to populate.</div>';
  }
  
  // Quarter cache timestamp for ↺ link
  const qCache = currentMode !== 'sprint' ? state.quarterWorklogCache?.[currentMode] : null;
  const qRefreshNote = qCache
    ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">
         Last fetched ${formatTimestamp(qCache.fetchedAt)} · 
         <span id="quarter-refresh-link" style="color:var(--primary);cursor:pointer;">↺ Refresh</span>
       </div>`
    : '';
  
  // ── Dates ─────────────────────────────────────────────────────────────
  const rawStart = state.currentSprint?.startDate || state.sprintAnalytics?.startDate || '';
  const rawEnd   = state.currentSprint?.endDate   || state.sprintAnalytics?.endDate   || '';
  const sprintStart = rawStart.slice(0, 10);
  const sprintEnd   = rawEnd.slice(0, 10);
  
  const fmtDate = d => {
    if (!d) return '';
    const ymd = d.slice(0, 10);
    const [,m, day] = ymd.split('-');
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1];
    return `${+day} ${mon}`;
  };
  
  // Date range changes with mode: sprint uses sprint dates, quarters use quarter dates
  let modeStart = sprintStart, modeEnd = sprintEnd;
  if (currentMode !== 'sprint') {
    const qDef = quarters.find(q => q.label === currentMode);
    if (qDef) { modeStart = qDef.start; modeEnd = qDef.end; }
    else if (state.quarterWorklogCache?.[currentMode]) {
      const qc = state.quarterWorklogCache[currentMode];
      modeStart = (qc.startDate || '').slice(0, 10);
      modeEnd   = (qc.endDate   || '').slice(0, 10);
    }
  }
  const modeRange  = modeStart && modeEnd ? `${fmtDate(modeStart)} – ${fmtDate(modeEnd)}` : '';
  const sprintOnlyRange = sprintStart && sprintEnd ? `${fmtDate(sprintStart)} – ${fmtDate(sprintEnd)}` : '';
  // Helper: subtitle div for a given range string
  const dateSubtitle = (range) => range
    ? `<div style="font-size:10px;color:var(--text-muted);margin-top:1px;">${range}</div>` : '';
  
  // Shared control bar — sits above row 2, controls BOTH Time Logged and Estimate vs Actual
  const sharedControlBar = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                margin:8px 0 4px;padding:0 2px;position:relative;">
      <span style="font-size:10px;color:var(--text-muted);">${modeRange}</span>
      <div style="display:flex;align-items:center;gap:6px;">
        ${modeDropdown}
        ${memberFilterHtml}
      </div>
    </div>`;

  // ── Estimate vs Actual — synced with Time Logged mode ────────────────
  // When quarter is selected but not yet fetched, show loading (not stale sprint data)
  const quarterPending = currentMode !== 'sprint' && timesheetMembers === null;
  const teamForEstimate = quarterPending ? [] : (timesheetMembers || filteredTs);
  let estimateVsActualHtml = '';
  if (quarterPending) {
    estimateVsActualHtml = `
      <div style="padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;display:flex;flex-direction:column;width:100%;">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;margin-bottom:2px;">ESTIMATE VS ACTUAL</div>
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">${modeRange}</div>
        <div style="font-size:12px;color:var(--text-muted);padding:8px 0;">Loading ${currentMode} data… ⏳</div>
      </div>`;
  } else if (teamForEstimate.length > 0 && teamForEstimate.some(m => m.estimated > 0)) {
    estimateVsActualHtml = buildEstimateVsActualCard(teamForEstimate, modeRange);
  }
  
  const contentEl = document.getElementById('insights-content');
  if (!contentEl) return;
  const panelWidth = contentEl.offsetWidth || window.innerWidth || 380;
  const sideBySide = panelWidth >= 520;
  contentEl.dataset.layout = sideBySide ? 'row' : 'col'; // persist state for resize check
  
  const outerStyle = sideBySide ? 'display:flex;gap:8px;align-items:stretch;' : '';
  const chartWrapStyle = sideBySide ? 'flex:1;min-width:0;display:flex;' : 'margin-bottom:8px;';
  // Card style: darker than collapsible's --surface-raised so charts stand out
  // height:100% + flex:1 makes cards equal height when in row layout
  const cardStyle = 'padding:10px 12px;background:var(--surface,#11131c);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;display:flex;flex-direction:column;width:100%;';
  
  // ── Support Board Breakdown ───────────────────────────────────────
  const supportBoardHtml = buildSupportBoardChart(state.extraBoardsData || []);
  
  // ── Side-by-side row 2: Time Logged | Estimate vs Actual ─────────────
  const outerStyle2  = sideBySide ? 'display:flex;gap:8px;align-items:stretch;' : '';
  const chartWrap2   = sideBySide ? 'flex:1;min-width:0;display:flex;' : 'margin-bottom:8px;';
  
  content.innerHTML = `
    ${progressHtml}
    <div style="${outerStyle}">
      <div style="${chartWrapStyle}">
        <div style="${cardStyle}">
          <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">BURNDOWN</div>
          ${dateSubtitle(sprintOnlyRange)}
          <div style="margin-top:6px;">${burndownHtml}</div>
        </div>
      </div>
      <div style="${chartWrapStyle}">${supportBoardHtml}</div>
    </div>
    ${sharedControlBar}
    <div style="${outerStyle2}">
      <div style="${chartWrap2}">
        <div style="${cardStyle}">
          <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">TIME LOGGED</div>
          ${dateSubtitle(modeRange)}
          <div style="margin-top:6px;">${timesheetHtml}</div>
          ${qRefreshNote}
        </div>
      </div>
      <div style="${chartWrap2}">${estimateVsActualHtml}</div>
    </div>`;
  
  // Wire quarter dropdown
  const modeSelect = document.getElementById('timesheet-mode-select');
  if (modeSelect) {
    modeSelect.addEventListener('change', (e) => {
      const newMode = e.target.value;
      state.timesheetMode = newMode;
      
      if (newMode !== 'sprint' && !state.quarterWorklogCache?.[newMode]) {
        // Lazy fetch from background
        const qDef = currentQuarters(now.getFullYear(), now.getMonth() + 1).find(q => q.label === newMode);
        if (qDef) {
          const accountIds = [...new Set((analytics.timesheet || []).map(m => m.accountId).filter(Boolean))];
          const cacheKey = `worklogCache:${qDef.year}:${newMode}`;
          chrome.runtime.sendMessage({
            type: 'fetch-quarter-worklogs',
            year: qDef.year, q: qDef.q, accountIds,
            startDate: qDef.start, endDate: qDef.end, cacheKey
          });
        }
      }
      renderInsights();
    });
  }
  
  // Wire ↺ quarter refresh
  document.getElementById('quarter-refresh-link')?.addEventListener('click', () => {
    const qMode = state.timesheetMode;
    if (qMode === 'sprint') return;
    const qDef = currentQuarters(now.getFullYear(), now.getMonth() + 1).find(q => q.label === qMode);
    if (!qDef) return;
    const accountIds = [...new Set((analytics.timesheet || []).map(m => m.accountId).filter(Boolean))];
    const cacheKey = `worklogCache:${qDef.year}:${qMode}`;
    if (!state.quarterWorklogCache) state.quarterWorklogCache = {};
    delete state.quarterWorklogCache[qMode]; // clear so loader shows
    chrome.runtime.sendMessage({
      type: 'fetch-quarter-worklogs',
      year: qDef.year, q: qDef.q, accountIds,
      startDate: qDef.start, endDate: qDef.end, cacheKey
    });
    renderInsights();
  });
  
  // ── Wire member filter popover ────────────────────────────────────────
  const filterBtn  = document.getElementById('member-filter-btn');
  const popover    = document.getElementById('member-filter-popover');
  
  if (popover) {
    // Close popover when clicking OUTSIDE (not on Apply, not on the buttons)
    const closeOnOutsideClick = (e) => {
      if (!popover.contains(e.target) && e.target !== filterBtn) {
        popover.style.display = 'none';
        document.removeEventListener('click', closeOnOutsideClick);
      }
    };
    
    const openPopover = (e) => {
      e.stopPropagation();
      const isOpen = popover.style.display !== 'none';
      if (isOpen) {
        popover.style.display = 'none';
        document.removeEventListener('click', closeOnOutsideClick);
      } else {
        popover.style.display = '';
        setTimeout(() => document.addEventListener('click', closeOnOutsideClick), 0);
      }
    };
    
    if (filterBtn) filterBtn.addEventListener('click', openPopover);
    
    document.getElementById('member-filter-select-all')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.member-filter-cb').forEach(cb => cb.checked = true);
    });
    
    document.getElementById('member-filter-apply')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const selected = Array.from(document.querySelectorAll('.member-filter-cb:checked'))
        .map(cb => cb.dataset.name);
      const r = await chrome.storage.local.get(['settings']);
      const s = r.settings || {};
      // null = show all (empty array would trigger "show all" fallback and look like a reset)
      s.analytics = { ...s.analytics, monitoredMembers: selected.length > 0 ? selected : null };
      await chrome.storage.local.set({ settings: s });
      state.settings = s;
      popover.style.display = 'none';
      document.removeEventListener('click', closeOnOutsideClick);
      renderInsights();
    });
  }
  
  // Re-render on resize — rAF prevents "ResizeObserver loop completed" warnings
  if (!contentEl._resizeObserver) {
    contentEl._resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById('insights-content');
        if (!el) return;
        const newWidth = el.offsetWidth || 380;
        const shouldBeSideBySide = newWidth >= 520;
        const currentLayout = el.dataset.layout === 'row';
        if (shouldBeSideBySide !== currentLayout) {
          el.dataset.layout = shouldBeSideBySide ? 'row' : 'col';
          renderInsights();
        }
      });
    });
    contentEl._resizeObserver.observe(contentEl);
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
  const sprintBody = document.getElementById('sprint-glance-body');
  const sprintChevron = document.getElementById('sprint-chevron');
  
  // Single-subsection: always show sprint-glance-body; hide the inner chevron
  if (sprintBody) sprintBody.style.display = '';
  if (sprintChevron) sprintChevron.style.display = 'none';
  
  if (state.currentSprint) {
    const sp = state.currentSprint;
    
    // Section title + total count
    if (sprintTitleEl) sprintTitleEl.textContent = `Current Sprint (${sp.name})`;
    if (sprintTotalEl) sprintTotalEl.textContent = `${sp.totalStories} TICKETS`;
    const prediction = metrics.sprintBurndownPrediction(sp);
    const onTrack = prediction.onTrack;
    
    // Headline shows just sprint name + points + day; risk goes into the mini bar pills
    let topLine = `${sp.name} · ${sp.completedPoints}/${sp.totalPoints}pt · Day ${sp.daysElapsed}/${sp.totalDays}`;
    
    let riskText = '';
    if (prediction.risk === 'early') {
      // skip — too early to flag
    } else if (prediction.risk === 'no-data') {
      // skip
    } else if (!onTrack) {
      riskText = `At risk · need ${Number(prediction.expectedDailyVelocity).toFixed(1)}pt/d`;
    }
    
    if (collapsedSummary) collapsedSummary.textContent = topLine;
    if (glanceSubtitle) glanceSubtitle.textContent = '';
    
    // Mini progress bar in collapsed header (always visible)
    const countEl = document.getElementById('sprint-glance-ticket-counts');
    const stories = sp.stories || [];
    const isSupport = (sp.boardLabel||sp.boardName||state.settings?.squad?.key||'').toLowerCase().includes('support');
    if (countEl && stories.length > 0) {
      countEl.innerHTML = buildMiniProgressBar(stories, {
        showUnassigned: false,    // not relevant for sprint
        riskText,
      });
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
  
  // ── Wire top-level section toggles (once per session) ─────────────
  const insightsHeader = document.getElementById('insights-header');
  if (insightsHeader && !insightsHeader.dataset.wired) {
    insightsHeader.dataset.wired = '1';
    insightsHeader.addEventListener('click', () => {
      const body    = document.getElementById('insights-body');
      const chevron = document.getElementById('insights-chevron');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display  = open ? 'none' : '';
      chevron.textContent = open ? '▶' : '▼';
    });
  }
  const sprintSecHeader = document.getElementById('sprint-section-header');
  if (sprintSecHeader && !sprintSecHeader.dataset.wired) {
    sprintSecHeader.dataset.wired = '1';
    sprintSecHeader.addEventListener('click', () => {
      const body    = document.getElementById('sprint-section-body');
      const chevron = document.getElementById('sprint-section-chevron');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display  = open ? 'none' : '';
      chevron.textContent = open ? '▶' : '▼';
    });
  }
  const sentrySecHeader = document.getElementById('sentry-section-header');
  if (sentrySecHeader && !sentrySecHeader.dataset.wired) {
    sentrySecHeader.dataset.wired = '1';
    sentrySecHeader.addEventListener('click', () => {
      const body    = document.getElementById('sentry-section-body');
      const chevron = document.getElementById('sentry-section-chevron');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display  = open ? 'none' : '';
      chevron.textContent = open ? '▶' : '▼';
    });
  }
  
  // Insights (open by default) — render charts
  renderInsights();
  
  // Sentry issues — one collapsible section per view
  const spikes = document.getElementById('sentry-spikes');
  const sentryEmpty = document.getElementById('sentry-empty');
  const totalBadge = document.getElementById('sentry-total');
  
  // Trend chart — always rendered (async, non-blocking)
  renderSentryTrend().catch(e => console.warn('[popup] Trend render failed:', e.message));
  
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
function formatDueDate(dateStr, statusCategory) {
  if (!dateStr) return '';
  const due  = new Date(dateStr);
  const days = Math.ceil((due - new Date()) / (1000 * 60 * 60 * 24));
  const label = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  // Suppress overdue warnings for completed tickets — they're done, no alert needed
  if (statusCategory === 'done') return `<span style="color:var(--text-muted);">📅 ${label}</span>`;
  if (days < 0)  return `<span style="color:#ef4444;">⚠ due ${label}</span>`;
  if (days <= 2) return `<span style="color:#f59e0b;">📅 ${label}</span>`;
  return `📅 ${label}`;
}

// ── Support Board Breakdown chart ─────────────────────────────────────────
// Shows ticket count per status (excluding closed — already filtered at API level).
// Tickets with 'blocked-external' label are shown with a ⚠ count alongside bar.
function buildSupportBoardChart(boards) {
  // Find first support board
  const sb = boards.find(b => b.boardLabel?.toLowerCase().includes('support'));
  if (!sb || !sb.stories?.length) return '';
  
  const stories = sb.stories;
  const cardStyle = 'padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;display:flex;flex-direction:column;width:100%;';
  
  // Count by status name, and track blocked-external per status
  const byStatus = {};
  const blockedByStatus = {};
  for (const s of stories) {
    const st = s.status || 'Unknown';
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (s.labels?.includes('blocked-external')) {
      blockedByStatus[st] = (blockedByStatus[st] || 0) + 1;
    }
  }
  
  // Sort: in-progress statuses first, open last
  const STATUS_ORDER = ['In Progress', 'QA Testing', 'QA Rejected', 'Code Review', 'Open'];
  const entries = Object.entries(byStatus).sort(([a], [b]) => {
    const ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  
  const maxCount = Math.max(...entries.map(([,c]) => c), 1);
  const STATUS_COLORS = {
    'Open': '#94a3b8',
    'In Progress': '#3b82f6',
    'QA Testing': '#a855f7',
    'QA Rejected': '#ef4444',
    'QA Accepted': '#22c55e',
    'Code Review': '#f97316',
  };
  
  const totalBlocked = Object.values(blockedByStatus).reduce((s,n) => s+n, 0);
  const rows = entries.map(([status, count]) => {
    const color = STATUS_COLORS[status] || '#6366f1';
    const pct = Math.round(count / maxCount * 100);
    const blocked = blockedByStatus[status] || 0;
    const blockedBadge = blocked > 0
      ? `<span style="font-size:10px;color:#f59e0b;margin-left:6px;">⚠ ${blocked} blocked</span>`
      : '';
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
      <div style="width:90px;font-size:10px;color:var(--text-muted);text-align:right;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${status}</div>
      <div style="flex:1;height:8px;background:var(--border);border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
      <span style="font-size:10px;color:var(--text);width:16px;text-align:right;flex-shrink:0;">${count}</span>
      ${blockedBadge}
    </div>`;
  }).join('');
  
  const blockedSummary = totalBlocked > 0
    ? `<div style="margin-top:8px;padding:5px 8px;background:rgba(245,158,11,0.08);border-radius:4px;border:1px solid rgba(245,158,11,0.2);font-size:11px;color:#f59e0b;">⚠ ${totalBlocked} ticket${totalBlocked>1?'s':''} blocked-external across ${Object.keys(blockedByStatus).length} status${Object.keys(blockedByStatus).length>1?'es':''}</div>`
    : '';
  
  return `<div style="${cardStyle}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-shrink:0;">
      <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">SUPPORT BOARD BREAKDOWN</span>
      <span style="font-size:10px;color:var(--text-muted);">${stories.length} open</span>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;">
      ${rows}
      ${blockedSummary}
    </div>
  </div>`;
}

// ── Estimate vs Actual card ────────────────────────────────────────────────
function buildEstimateVsActualCard(members, dateRange) {
  const cardStyle = 'padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;display:flex;flex-direction:column;width:100%;';
  const maxVal = Math.max(...members.map(m => Math.max(m.total, m.estimated || 0)), 0.1);
  const W = 280, NAME_W = 100, PW = W - NAME_W - 8;
  const bw = h => Math.max(1, (h / maxVal) * PW);
  
  let rows = '';
  members.filter(m => m.total > 0).forEach((m, i) => {
    const y1 = 8 + i * 22;
    const name = (m.name || '').length > 14 ? m.name.slice(0,13) + '…' : (m.name || '');
    const wActual   = bw(m.total);
    const wEstimate = m.estimated > 0 ? bw(m.estimated) : 0;
    const ratio = m.estimateRatio;
    const ratioColor = !ratio ? 'var(--text-muted)' : ratio > 1.3 ? '#f97316' : ratio < 0.7 ? '#22c55e' : 'var(--text-muted)';
    const ratioTxt = ratio ? `×${ratio.toFixed(1)}` : '';
    rows += `
      <text x="${NAME_W-5}" y="${y1+5}" text-anchor="end" dominant-baseline="central" fill="var(--text)" font-size="9.5" font-family="system-ui">${name}</text>
      <rect x="${NAME_W}" y="${y1}" width="${wActual.toFixed(1)}" height="6" fill="#6366f1" rx="2" opacity="0.85"/>
      ${wEstimate > 0 ? `<rect x="${NAME_W}" y="${y1+7}" width="${wEstimate.toFixed(1)}" height="3" fill="var(--text-muted)" rx="1" opacity="0.4"/>` : ''}
      <text x="${NAME_W+wActual+3}" y="${y1+3}" dominant-baseline="central" fill="${ratioColor}" font-size="9" font-family="system-ui">${ratioTxt}</text>`;
  });
  
  const H = 8 + members.length * 22 + 20;
  const legend = `<text x="${NAME_W}" y="${H-6}" fill="var(--text-muted)" font-size="9" font-family="system-ui">■ Logged</text><text x="${NAME_W+50}" y="${H-6}" fill="var(--text-muted)" font-size="9" font-family="system-ui">— Estimated</text><text x="${NAME_W+130}" y="${H-6}" fill="#f97316" font-size="9" font-family="system-ui">×1.3+ over</text><text x="${NAME_W+190}" y="${H-6}" fill="#22c55e" font-size="9" font-family="system-ui">×0.7− under</text>`;
  
  return `<div style="${cardStyle}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
      <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">ESTIMATE VS ACTUAL</span>
    </div>
    ${dateRange ? `<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">${dateRange}</div>` : ''}
    <svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">${rows}${legend}</svg>
  </div>`;
}

// ── Focus split card (issue type breakdown) ────────────────────────────────
function buildFocusSplitCard(issueTypeSplit) {
  const cardStyle = 'padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;margin-top:8px;';
  const totalHrs = issueTypeSplit.reduce((s, x) => s + x.hours, 0);
  if (totalHrs === 0) return '';
  
  const TYPE_COLORS = { Bug: '#ef4444', Story: '#6366f1', Task: '#22c55e', 'Sub-task': '#a855f7', Other: '#94a3b8' };
  
  const bars = issueTypeSplit.map(x => {
    const pct = Math.round(x.hours / totalHrs * 100);
    const color = TYPE_COLORS[x.type] || TYPE_COLORS.Other;
    return { ...x, pct, color };
  });
  
  const barHtml = bars.map(b =>
    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
       <div style="width:80px;font-size:10px;color:var(--text-muted);text-align:right;flex-shrink:0;">${b.type}</div>
       <div style="flex:1;height:7px;background:var(--border);border-radius:3px;overflow:hidden;">
         <div style="width:${b.pct}%;height:100%;background:${b.color};border-radius:3px;"></div>
       </div>
       <div style="width:40px;font-size:10px;color:var(--text-muted);">${b.pct}% · ${b.hours}h</div>
     </div>`
  ).join('');
  
  return `<div style="${cardStyle}">
    <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;margin-bottom:8px;">TEAM FOCUS</div>
    ${barHtml}
  </div>`;
}

// ── Sprint Progress Bar ────────────────────────────────────────────────────
// Counts by STORY POINTS (matches the burndown chart + sprint header pt totals).
// Falls back to ticket count if no points exist at all.
function buildSprintProgressBar(stories) {
  if (!stories || stories.length === 0) return '';
  
  const totalPoints = stories.reduce((s, t) => s + (t.points || 0), 0);
  const usePoints   = totalPoints > 0;
  
  let donePts, inProgPts, openPts, total;
  if (usePoints) {
    donePts   = stories.filter(s => s.statusCategory === 'done').reduce((sum,s) => sum + (s.points||0), 0);
    inProgPts = stories.filter(s => s.statusCategory === 'indeterminate').reduce((sum,s) => sum + (s.points||0), 0);
    openPts   = totalPoints - donePts - inProgPts;
    total     = totalPoints;
  } else {
    donePts   = stories.filter(s => s.statusCategory === 'done').length;
    inProgPts = stories.filter(s => s.statusCategory === 'indeterminate').length;
    openPts   = stories.length - donePts - inProgPts;
    total     = stories.length;
  }
  
  const donePct  = total > 0 ? Math.round(donePts  / total * 100) : 0;
  const ipPct    = total > 0 ? Math.round(inProgPts / total * 100) : 0;
  const openPct  = Math.max(0, 100 - donePct - ipPct);
  const unit = usePoints ? 'pt' : 'tickets';
  
  const doneBar = donePct > 0 ? `<div style="width:${donePct}%;background:#22c55e;border-radius:3px;min-width:2px;"></div>` : '';
  const ipBar   = ipPct   > 0 ? `<div style="width:${ipPct}%;background:#3b82f6;border-radius:3px;min-width:2px;"></div>` : '';
  const openBar = openPct > 0 ? `<div style="flex:1;background:rgba(148,163,184,0.15);border-radius:3px;min-width:2px;"></div>` : '';
  
  return `
    <div style="padding:10px 12px;background:var(--surface,#11131c);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;">
        <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;text-transform:uppercase;">Sprint progress <span style="font-size:9px;color:var(--text-muted);font-weight:normal;text-transform:none;letter-spacing:normal;">(by ${unit})</span></span>
        <span style="font-size:12px;font-weight:700;color:#22c55e;">${donePct}% done</span>
      </div>
      <div style="display:flex;height:7px;border-radius:4px;overflow:hidden;gap:2px;background:rgba(148,163,184,0.1);">
        ${doneBar}${ipBar}${openBar}
      </div>
      <div style="display:flex;gap:14px;margin-top:7px;">
        <span style="font-size:11px;"><span style="font-weight:700;color:#22c55e;">${donePct}%</span> <span style="color:var(--text-muted);">Done</span></span>
        <span style="font-size:11px;"><span style="font-weight:700;color:#3b82f6;">${ipPct}%</span> <span style="color:var(--text-muted);">In progress</span></span>
        <span style="font-size:11px;"><span style="font-weight:700;color:var(--text-muted);">${openPct}%</span> <span style="color:var(--text-muted);">Not started</span></span>
      </div>
    </div>`;
}

// ── Sentry Trend Chart ────────────────────────────────────────────────────
async function renderSentryTrend() {
  const card = document.getElementById('sentry-trend-card');
  if (!card) return;
  
  const trackedViewId = state.settings?.sentry?.trackedViewId;
  if (!trackedViewId) {
    // Show a setup prompt instead of hiding silently
    card.style.display = '';
    card.innerHTML = `
      <div style="padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;text-transform:uppercase;margin-bottom:6px;">SENTRY TREND</div>
        <div style="font-size:12px;color:var(--text-muted);">
          Track a Sentry view to see its daily issue count trend here.<br/>
          <span style="color:var(--primary,#6366f1);">Settings → Sentry views → click Track on one view → Save.</span>
        </div>
      </div>`;
    return;
  }
  
  // Find label for the tracked view
  const views = state.settings?.sentry?.views || [];
  const trackedView = views.find(v => {
    try {
      const p = v.url ? (new URL(v.url)).pathname.match(/\/issues\/views\/(\d+)/)?.[1] : null;
      return p === trackedViewId;
    } catch { return false; }
  });
  const viewLabel = trackedView?.label || `View ${trackedViewId}`;
  
  let samples;
  try {
    samples = await getTrendSamples(trackedViewId);
  } catch (e) {
    console.warn('[popup] Failed to load trend samples:', e.message);
    samples = [];
  }
  
  card.style.display = '';
  card.innerHTML = buildTrendCardHTML(viewLabel, samples);
}

function buildTrendCardHTML(label, samples) {
  // Only show last 30 days for compactness
  const last30 = samples.slice(-30);
  
  if (last30.length < 1) {
    return `
      <div style="padding:10px 12px;background:var(--surface);
                  border:1px solid var(--border,rgba(255,255,255,0.05));
                  border-radius:8px;font-size:11px;color:var(--text-muted);">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;
                    text-transform:uppercase;margin-bottom:6px;">${escapeHtml(label)} Trend</div>
        Open the panel daily to build trend history.
      </div>`;
  }
  
  // Single data point on day 1
  if (last30.length === 1) {
    const pt = last30[0];
    return `
      <div style="padding:10px 12px;background:var(--surface);
                  border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;
                       text-transform:uppercase;">${escapeHtml(label)} · last 30 days</span>
          <span style="font-size:13px;font-weight:700;color:var(--text);">${pt.count} today</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding:6px 0;">
          <div style="width:8px;height:8px;background:#6366f1;border-radius:50%;flex-shrink:0;"></div>
          <span style="font-size:11px;color:var(--text-muted);">First reading · ${pt.day} · ${pt.count} unresolved</span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);">Open the panel daily to build the trend line.</div>
      </div>`;
  }
  
  const counts  = last30.map(s => s.count);
  const days    = last30.map(s => s.day);
  const minVal  = Math.min(...counts);
  const maxVal  = Math.max(...counts);
  const today   = last30[last30.length - 1];
  const prev    = last30[last30.length - 2];
  const delta   = today.count - prev.count;
  const deltaStr = delta > 0 ? `↑${delta}` : delta < 0 ? `↓${Math.abs(delta)}` : '=';
  const deltaColor = delta > 0 ? '#f97316' : delta < 0 ? '#22c55e' : 'var(--text-muted)';
  
  const W = 280, H = 52, PAD_L = 4, PAD_R = 4, PAD_T = 6, PAD_B = 16;
  const PW = W - PAD_L - PAD_R;
  const PH = H - PAD_T - PAD_B;
  const range = maxVal - minVal || 1;
  
  const px = (i) => PAD_L + (i / (last30.length - 1)) * PW;
  const py = (v) => PAD_T + PH - ((v - minVal) / range) * PH;
  
  // Build polyline points
  const pts = last30.map((s, i) => `${px(i).toFixed(1)},${py(s.count).toFixed(1)}`).join(' ');
  
  // Build filled area path
  const firstX = PAD_L.toFixed(1), lastX = (PAD_L + PW).toFixed(1);
  const baseY  = (PAD_T + PH).toFixed(1);
  const areaPath = `M${firstX},${baseY} L${pts.split(' ').map(p => p).join(' L')} L${lastX},${baseY} Z`;
  
  // X-axis labels: first, middle, last
  const xLabels = [];
  const labelIdxs = [0, Math.floor((last30.length - 1) / 2), last30.length - 1];
  const labelNames = ['', '', 'today'];
  labelIdxs.forEach((idx, li) => {
    const d = days[idx];
    const label_text = li === 2 ? 'today' : `${parseInt(d.slice(8))} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(d.slice(5,7))-1]}`;
    xLabels.push(`<text x="${px(idx).toFixed(1)}" y="${H - 2}" text-anchor="${li === 0 ? 'start' : li === 2 ? 'end' : 'middle'}" fill="var(--text-muted)" font-size="8.5" font-family="system-ui">${label_text}</text>`);
  });
  
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;">
    <defs>
      <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6366f1" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="#6366f1" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#tg)"/>
    <polyline points="${pts}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${px(last30.length - 1).toFixed(1)}" cy="${py(today.count).toFixed(1)}" r="2.5" fill="#6366f1"/>
    ${xLabels.join('')}
  </svg>`;
  
  return `
    <div style="padding:10px 12px;background:var(--surface,#11131c);
                border:1px solid var(--border,rgba(255,255,255,0.05));
                border-radius:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;
                     text-transform:uppercase;">${escapeHtml(label)} · last 30 days</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;font-weight:700;color:${deltaColor};">${deltaStr} vs yesterday</span>
          <span style="font-size:13px;font-weight:700;color:var(--text);">${today.count}</span>
        </div>
      </div>
      ${svg}
      <div style="display:flex;justify-content:space-between;margin-top:2px;font-size:9px;color:var(--text-muted);">
        <span>min ${minVal}</span>
        <span>max ${maxVal}</span>
      </div>
    </div>`;
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

function buildTimesheetSVG(members, _w1Lbl, _w2Lbl) {
  if (!members || members.length === 0) return '';
  
  // Collect all project keys across all members
  const allProjects = [...new Set(members.flatMap(m => Object.keys(m.byProject || {})))].sort();
  const colorMap = assignProjectColors(allProjects);
  
  const W       = 300;
  const NAME_W  = 100;
  const PW      = W - NAME_W - 8;
  const BAR_H   = 9;
  const ROW_H   = 20;
  const PAD_TOP = 8;
  const PAD_BOT = 28;  // room for legend
  const H = PAD_TOP + members.length * ROW_H + PAD_BOT;
  
  const maxTotal = Math.max(...members.map(m => m.total || 0), 0.1);
  const bw = h => Math.max(1, (h / maxTotal) * PW);
  const baseX = NAME_W;
  
  let rows = '';
  members.forEach((m, i) => {
    const y1 = PAD_TOP + i * ROW_H;
    const displayName = (m.name || '').length > 14 ? m.name.slice(0, 13) + '…' : (m.name || '');
    
    // Stacked segments left to right
    let segX = baseX;
    const segments = Object.entries(m.byProject || {})
      .sort((a, b) => b[1] - a[1]); // biggest project first
    
    const segSvg = segments.map(([pk, hrs]) => {
      const w = bw(hrs);
      const color = colorMap[pk] || '#94a3b8';
      const seg = `<rect x="${segX.toFixed(1)}" y="${y1}" width="${w.toFixed(1)}" height="${BAR_H}" fill="${color}" rx="2" title="${pk}: ${hrs}h"/>`;
      segX += w;
      return seg;
    }).join('');
    
    // Small gap between segments
    rows += `
      <text x="${NAME_W - 5}" y="${y1 + BAR_H/2 + 1}" text-anchor="end" dominant-baseline="central" fill="var(--text)" font-size="9.5" font-family="system-ui">${displayName}</text>
      ${segSvg}
      <text x="${segX + 3}" y="${y1 + BAR_H/2 + 1}" dominant-baseline="central" fill="var(--text)" font-size="9" font-family="system-ui">${m.total}h</text>`;
  });
  
  // X-axis grid
  let grid = '';
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const x = (baseX + (i / steps) * PW).toFixed(1);
    grid += `<line x1="${x}" y1="${PAD_TOP}" x2="${x}" y2="${H - PAD_BOT}" stroke="var(--border)" stroke-width="1"/>`;
    const label = Math.round((i / steps) * maxTotal);
    grid += `<text x="${x}" y="${H - PAD_BOT + 10}" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">${label}h</text>`;
  }
  const ax = `<line x1="${baseX}" y1="${PAD_TOP}" x2="${baseX}" y2="${H - PAD_BOT}" stroke="var(--border)" stroke-width="1"/>`;
  
  // Legend (up to 4 projects shown inline, rest omitted)
  const ly = H - 10;
  let legendX = baseX;
  const legendItems = allProjects.slice(0, 4);
  const legendSvg = legendItems.map(pk => {
    const color = colorMap[pk];
    const label = pk.length > 8 ? pk.slice(0, 7) + '…' : pk;
    const item = `<rect x="${legendX}" y="${ly - 5}" width="8" height="7" fill="${color}" rx="1"/><text x="${legendX + 11}" y="${ly}" dominant-baseline="central" fill="var(--text-muted)" font-size="8.5" font-family="system-ui">${label}</text>`;
    legendX += 48;
    return item;
  }).join('');
  
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
    ${grid}${ax}${rows}${legendSvg}</svg>`;
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
  const duePart = story.dueDate ? formatDueDate(story.dueDate, story.statusCategory) : '';
  return `
    <div class="ticket-row" ${url ? `data-url="${escapeHtml(url)}"` : ''} style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,rgba(255,255,255,0.05));${url?'cursor:pointer;':''}">
      ${priorityDot(story.priority)}
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
// ── Mini progress bar for collapsed headers ──────────────────────────────
// Compact horizontal stacked bar + headline metrics on a single line.
// Used in sprint header and extra-board headers.
function buildMiniProgressBar(stories, opts = {}) {
  if (!stories || stories.length === 0) {
    return `<span style="font-size:11px;color:var(--text-muted);">No tickets</span>`;
  }
  
  const totalPoints = stories.reduce((s, t) => s + (t.points || 0), 0);
  const usePoints   = totalPoints > 0;
  
  let donePts, inProgPts, openPts, total;
  if (usePoints) {
    donePts   = stories.filter(s => s.statusCategory === 'done').reduce((sum,s) => sum + (s.points||0), 0);
    inProgPts = stories.filter(s => s.statusCategory === 'indeterminate').reduce((sum,s) => sum + (s.points||0), 0);
    openPts   = totalPoints - donePts - inProgPts;
    total     = totalPoints;
  } else {
    donePts   = stories.filter(s => s.statusCategory === 'done').length;
    inProgPts = stories.filter(s => s.statusCategory === 'indeterminate').length;
    openPts   = stories.length - donePts - inProgPts;
    total     = stories.length;
  }
  
  const donePct = total > 0 ? Math.round(donePts  / total * 100) : 0;
  const ipPct   = total > 0 ? Math.round(inProgPts / total * 100) : 0;
  const openPct = Math.max(0, 100 - donePct - ipPct);
  
  // In-flight count (tickets, not points — easier to action)
  const inFlightTickets = stories.filter(s => s.statusCategory === 'indeterminate').length;
  
  // Unassigned count
  const unassigned = stories.filter(s => !s.assignee && s.statusCategory !== 'done').length;
  
  const doneBar = donePct > 0 ? `<div style="width:${donePct}%;background:#22c55e;border-radius:2px;min-width:1px;"></div>` : '';
  const ipBar   = ipPct   > 0 ? `<div style="width:${ipPct}%;background:#3b82f6;border-radius:2px;min-width:1px;"></div>` : '';
  const openBar = openPct > 0 ? `<div style="flex:1;background:rgba(148,163,184,0.2);border-radius:2px;min-width:1px;"></div>` : '';
  
  // Build the metric pills (right of the bar)
  const pills = [];
  pills.push(`<span style="color:var(--text);font-weight:600;">${donePct}%</span> <span style="color:var(--text-muted);">done</span>`);
  if (inFlightTickets > 0) {
    pills.push(`<span style="color:#3b82f6;font-weight:600;">${inFlightTickets}</span> <span style="color:var(--text-muted);">in flight</span>`);
  }
  if (opts.showUnassigned && unassigned > 0) {
    pills.push(`<span style="color:#f59e0b;font-weight:600;">${unassigned}</span> <span style="color:var(--text-muted);">unassigned</span>`);
  }
  if (opts.riskText) {
    pills.push(`<span style="color:#f97316;font-weight:600;">⚠ ${opts.riskText}</span>`);
  }
  if (opts.blockedCount && opts.blockedCount > 0) {
    pills.push(`<span style="color:#f59e0b;font-weight:600;">⚠ ${opts.blockedCount} blocked-external</span>`);
  }
  if (opts.breachedCount && opts.breachedCount > 0) {
    pills.push(`<span style="color:#ef4444;font-weight:700;">🔴 ${opts.breachedCount} SLA</span>`);
  }
  
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-top:4px;font-size:11px;">
      <div style="display:flex;height:5px;border-radius:3px;overflow:hidden;gap:1px;background:rgba(148,163,184,0.1);width:60px;flex-shrink:0;">
        ${doneBar}${ipBar}${openBar}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        ${pills.join('<span style="color:var(--text-muted);">·</span>')}
      </div>
    </div>`;
}

function collapsedBoardSummary(stories, isSupport) {
  const { breached, blocked } = ticketCounts(stories);
  return buildMiniProgressBar(stories, {
    showUnassigned: isSupport,
    blockedCount:   isSupport ? blocked  : 0,
    breachedCount:  isSupport ? breached : 0,
  });
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
  if (message.type === 'quarter-worklogs-ready') {
    const key = message.cacheKey;
    chrome.storage.local.get([key]).then(r => {
      if (r[key]) {
        if (!state.quarterWorklogCache) state.quarterWorklogCache = {};
        state.quarterWorklogCache[state.timesheetMode] = r[key];
        renderInsights();
      }
    });
    return;
  }
  if (message.type === 'quarter-worklogs-error') {
    showErrorBanner(`Quarter data fetch failed: ${message.error}`);
    return;
  }
  if (message.type === 'partial-update') {
    console.log(`[popup] Partial update received: ${message.source}`);
    loadData().then(() => {
      renderCurrentScreen();
      setSectionLoading(message.source, false);
      if (message.source === 'jira') startRefreshTimer(Date.now());
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
