/**
 * popup.js
 * Main app controller for Zealer Dashboard side panel
 * ES module with imports from src/
 */

import * as metrics from './src/metrics.js';
import { getTrendSamples } from './src/sentry-trend.js';
import { colorForIndex } from './src/trend-colors.js';
import { assignProjectColors, currentQuarters } from './src/worklog-aggregator.js';
import { buildGanttSVG } from './src/gantt.js';
import { generateMockState, MOCK_CURRENT_USER } from './src/mock-data.js';
import { milestoneCounts } from './src/milestones.js';
import { visibleAlerts } from './src/alerts.js';
import { PRIORITY_DOT_COLOR, statusColor, statusCategoryIcon } from './src/domain-constants.js';
import { buildBurndownSVG } from './src/render/burndown-svg.js';

/**
 * Stable identity key for a timesheet member: accountId when available,
 * otherwise a "name:"-prefixed display name (legacy / unresolved entries).
 */
function memberKey(m) {
  return (m && m.accountId) ? m.accountId : ('name:' + ((m && m.name) || ''));
}

/**
 * Is this member included by the current selection?
 * `monitored` is a list of keys (accountIds and/or "name:"-prefixed names).
 * null/empty = no filter (show all). Matches by accountId first, then falls
 * back to display name so selections saved before the accountId switch still work.
 */
function isMonitored(m, monitored) {
  if (!monitored || monitored.length === 0) return true;
  return (m.accountId && monitored.includes(m.accountId)) ||
         (m.name && monitored.includes(m.name)) ||
         (m.name && monitored.includes('name:' + m.name));
}

/** Normalize a discoveredMembers entry (legacy string OR {accountId,name}) to an object. */
function normalizeMember(d) {
  return (typeof d === 'string') ? { accountId: null, name: d } : { accountId: d.accountId || null, name: d.name || '' };
}

// Current state
let state = {
  currentScreen: null,
  settings: null,
  alerts: [],
  alertSnoozes: {},
  sprintHistory: [],
  currentSprint: null,
  sentryIssues: [],
  sentryViews: [],
  supportTickets: [],
  extraBoardsData: [],
  milestonesData: [],
  sprintAnalytics: null,
  isLoading: false,
  mockMode: false,           // true when demo/mock mode is active (session-only)
  timesheetMode: 'sprint',   // 'sprint' | 'Q1' | 'Q2' | 'Q3' | 'Q4'
  quarterWorklogCache: {},   // { Q1: {members, issueTypeSplit, fetchedAt, startDate, endDate} }
};

/**
 * Boot sequence
 */
/**
 * Phase 6 splash. Shows once per browser session.
 * Timeline: 0.55s navy → cap in → ripples (~1.2s) → title in → hold → fade out (~2.9s total).
 */
/**
 * Demo / Mock Mode — inject mock state and render without any API calls.
 * Activated by a session-scoped toggle in Settings. Resets on browser restart.
 */
async function injectMockState() {
  const mock = generateMockState(state.settings);
  Object.assign(state, mock);

  // Clear real-settings member filter so mock members aren't filtered out,
  // and populate discoveredMembers with the mock team for the filter UI.
  state.settings = {
    ...state.settings,
    analytics: {
      ...(state.settings?.analytics || {}),
      monitoredMembers:  null,   // don't filter — show all mock members
      discoveredMembers: MOCK_CURRENT_USER
        ? [
            { accountId:'mock-acc-ahmed', name:'Ahmed Reda'    },
            { accountId:'mock-acc-sara',  name:'Sara Hassan'   },
            { accountId:'mock-acc-omar',  name:'Omar Farouk'   },
            { accountId:'mock-acc-nour',  name:'Nour Khalil'   },
            { accountId:'mock-acc-layla', name:'Layla Mostafa' },
          ]
        : [],
    },
  };
  // Scope default is role-aware: engineers open on "Me", EMs on "Squad"
  // (squad keeps the team timesheet visible in EM demos).
  if (!state.viewScope) {
    state.viewScope = state.settings?.role === 'engineer' ? 'me' : 'squad';
  }

  // Compute alerts on the mock sprint so the alert inbox is populated
  try {
    const { checkAlerts } = await import('./src/alerts.js');
    state.alerts = checkAlerts(state).filter(Boolean);
  } catch { state.alerts = []; }
  // Show the demo banner
  const banner = document.getElementById('mock-mode-banner');
  if (banner) banner.style.display = 'flex';
  showScreen('today');
  renderTodayScreen();
}

async function maybeRunSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;

  let alreadyShown = false;
  try {
    const r = await chrome.storage.session.get('splashShown');
    alreadyShown = !!r.splashShown;
  } catch { /* session storage unavailable — treat as not shown */ }

  if (alreadyShown) {
    splash.remove();
    return;
  }

  try { await chrome.storage.session.set({ splashShown: true }); } catch { /* noop */ }

  // Let the animation play, then fade out and remove
  setTimeout(() => {
    splash.classList.add('splash-hide');
    setTimeout(() => splash.remove(), 500);
  }, 2400);
}

async function boot() {
  console.log('[popup] Booting Zealer Dashboard...');

  // Phase 6: launch splash — show once per browser session, then fade out
  maybeRunSplash();

  // Load and apply theme
  await loadAndApplyTheme();
  
  // Set version in app bar
  const manifest = chrome.runtime.getManifest();
  document.getElementById('app-version').textContent = `v${manifest.version}`;
  
  
  // Wire up event handlers
  setupEventHandlers();
  
  // Load settings
  const result = await chrome.storage.local.get(['settings', 'alerts', 'sentryEmptyDismissed', 'alertSnoozes']);
  state.settings = result.settings || {};
  state.alerts = result.alerts || [];
  state.alertSnoozes = result.alertSnoozes || {};
  state.sentryCardDismissed = !!result.sentryEmptyDismissed;

  // Demo/mock mode — session-scoped (resets on browser restart)
  try {
    const sess = await chrome.storage.session.get('mockModeEnabled');
    state.mockMode = !!sess.mockModeEnabled;
  } catch { state.mockMode = false; }

  if (state.mockMode && state.settings.role) {
    await injectMockState();
    return; // skip normal data load — all charts rendered from mock state
  }
  
  // First launch: show role-selection screen if no role has been chosen yet.
  // Jira credentials are the minimum requirement — Sentry is optional.
  if (!state.settings.role || !state.settings.jira?.token) {
    showScreen('role-select');
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
  // Gantt: click any [data-jira-key] row to open the ticket in Jira
  document.getElementById('insights-content')?.addEventListener('click', e => {
    const el = e.target.closest('[data-jira-key]');
    if (!el) return;
    const key  = el.dataset.jiraKey;
    const base = (state.settings?.jira?.baseUrl || '').replace(/\/$/, '');
    if (base && key) window.open(`${base}/browse/${key}`, '_blank');
  });

  // Demo mode banner × button — turns off mock mode and reboots
  document.getElementById('mock-banner-close')?.addEventListener('click', async () => {
    try { await chrome.storage.session.set({ mockModeEnabled: false }); } catch { /* noop */ }
    state.mockMode = false;
    document.getElementById('mock-mode-banner').style.display = 'none';
    boot(); // re-run boot with real credentials
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
/**
 * Load data from cache or fetch fresh
 */
async function loadData() {
  try {
    const cacheResult = await chrome.storage.local.get([
      'settings', 'sprintHistory', 'currentSprint', 'sentryIssues',
      'sentryViews', 'supportTickets', 'alerts', 'extraBoardsData', 'milestonesData', 'currentUser'
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
    state.milestonesData   = cacheResult.milestonesData   || [];
    state.currentUser      = cacheResult.currentUser      || null;

    // viewScope: engineers respect their last chosen scope (default 'me');
    // EM is always 'squad' (DDL filter sits on top of that).
    state.viewScope = state.settings?.role === 'engineer'
      ? (state.settings?.viewScope || 'me')
      : 'squad';
    
    // Load sprint analytics from separate cache key
    if (state.currentSprint?.name) {
      const cacheKey = 'sprintAnalyticsCache';
      const analyticsResult = await chrome.storage.local.get([cacheKey]);
      const analyticsCache = analyticsResult[cacheKey] || {};
      state.sprintAnalytics = analyticsCache[state.currentSprint.name] || null;
    } else {
      state.sprintAnalytics = null;
    }

    // Recompute alerts from the freshly-loaded state so they always carry the
    // current rule output (detail/bullets/tickets for the expandable UI), even
    // if the cached `alerts` array predates a rule change. Falls back to the
    // cached array if recomputation throws. Snoozes still filter at render time.
    try {
      const { checkAlerts } = await import('./src/alerts.js');
      const fresh = checkAlerts(state).filter(Boolean);
      if (fresh.length > 0 || state.alerts.length === 0) state.alerts = fresh;
    } catch (e) {
      console.warn('[popup] Alert recompute skipped:', e.message);
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
  
  if (screenId === 'auth' || screenId === 'role-select') {
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
    const allStories = board.stories || [];
    const isKanban   = board.boardType === 'kanban';
    // Apply me/squad scope filter in engineer me-mode
    const isEngineerMe = state.settings?.role === 'engineer'
                      && state.viewScope === 'me'
                      && !!state.currentUser?.accountId;
    const displayStories = isEngineerMe
      ? allStories.filter(s => s.assigneeAccountId === state.currentUser.accountId)
      : allStories;
    const stories = displayStories; // keep legacy name for template below
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
            <span style="font-size:11px;font-weight:600;color:var(--text-muted);">${isSupport ? displayStories.length + (isEngineerMe ? ' MINE' : ' OPEN') : board.totalStories + ' TOTAL'}</span>
            <span id="${sectionId}-section-chevron" style="color:var(--text-muted);font-size:12px;">&#9654;</span>
          </div>
        </div>
        <div id="${sectionId}-section-body" style="display:none;margin-top:8px;">
          ${state.settings?.role === 'engineer' ? `
          <div class="scope-filter-row board-filter-row" id="${sectionId}-filter-row">
            <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;text-transform:uppercase;">
              ${escapeHtml(board.boardLabel)}${board.sprintName ? ' · ' + escapeHtml(board.sprintName) : ''}
            </span>
            ${buildScopeToggleHtml()}
          </div>` : ''}
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
    // Wire Me/Squad scope pills inside this board's filter row
    const filterRow = document.getElementById(`${sectionId}-filter-row`);
    if (filterRow) wireScopePills(filterRow);
  });
}

/**
 * Milestones (OKRs / Dev Plans) — collapsible card per configured label.
 * Progress is by TICKET COUNT across the whole milestone, regardless of
 * which sprint (if any) each ticket is in. Me/Squad scope applies.
 */
function renderMilestones() {
  const container = document.getElementById('milestones-container');
  if (!container) return;

  const milestones = state.milestonesData || [];
  if (milestones.length === 0) { container.innerHTML = ''; return; }

  const jiraBase = state.settings?.jira?.baseUrl || '';
  const isEngineerMe = state.settings?.role === 'engineer'
                    && state.viewScope === 'me'
                    && !!state.currentUser?.accountId;
  // Keys of tickets currently in the active sprint → "in sprint" badge
  const sprintKeys = new Set((state.currentSprint?.stories || []).map(s => s.key));

  container.innerHTML = milestones.map((ms, idx) => {
    const sectionId = `milestone-${idx}`;

    if (ms.error) {
      return `
        <div class="section">
          <div class="section-label">🎯 ${escapeHtml(ms.name || ms.label)}</div>
          <div style="padding:10px;border-radius:6px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.3);margin-top:6px;">
            <div style="font-size:12px;color:#ef4444;">⚠ ${escapeHtml(ms.error)}</div>
          </div>
        </div>`;
    }

    const allTickets = ms.tickets || [];
    const tickets = isEngineerMe
      ? allTickets.filter(t => t.assigneeAccountId === state.currentUser.accountId)
      : allTickets;
    const { total, done, inProg, pct } = milestoneCounts(tickets);
    const inSprintCount = tickets.filter(t => sprintKeys.has(t.key)).length;

    const leapsomeHtml = ms.leapsomeUrl
      ? `<a href="${escapeHtml(ms.leapsomeUrl)}" target="_blank" rel="noopener"
           style="font-size:11px;color:var(--primary,#6366f1);text-decoration:none;">Open in Leapsome ↗</a>`
      : `<span style="font-size:10px;color:var(--text-muted);font-style:italic;">Remember to update Leapsome manually</span>`;

    const rows = tickets.map(t => {
      const badge = sprintKeys.has(t.key)
        ? ` · <span style="font-size:9px;padding:1px 5px;border-radius:8px;background:rgba(99,102,241,0.15);color:var(--primary,#818cf8);font-weight:600;">IN SPRINT</span>`
        : '';
      return renderTicketRow(t, jiraBase, badge);
    }).join('');

    return `
      <div class="section">
        <div id="${sectionId}-section-label" class="section-label" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;">
          <span>🎯 ${escapeHtml(ms.name || ms.label)}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;font-weight:600;color:${pct === 100 ? '#34d399' : 'var(--text-muted)'};">${done}/${total} · ${pct}%</span>
            <span id="${sectionId}-section-chevron" style="color:var(--text-muted);font-size:12px;">&#9654;</span>
          </div>
        </div>
        <div id="${sectionId}-section-body" style="display:none;margin-top:8px;">
          ${state.settings?.role === 'engineer' ? `
          <div class="scope-filter-row" id="${sectionId}-filter-row">
            <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;text-transform:uppercase;">
              ${escapeHtml(ms.name || ms.label)}
            </span>
            ${buildScopeToggleHtml()}
          </div>` : ''}
          <div style="padding:10px;background:var(--surface-raised);border-radius:8px;margin-bottom:6px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <div style="font-size:12px;color:var(--text-muted);">
                ${done}/${total} done (${pct}%)${inSprintCount > 0 ? ` · ${inSprintCount} in current sprint` : ''}${inProg > 0 ? ` · ${inProg} in progress` : ''}
              </div>
              ${leapsomeHtml}
            </div>
            <div style="margin-top:5px;">${collapsedBoardSummary(tickets, false)}</div>
          </div>
          <div id="${sectionId}-body">
            ${rows || `<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center;">${isEngineerMe ? 'No tickets assigned to you in this milestone' : `No tickets carry the "${escapeHtml(ms.label)}" label yet`}</div>`}
          </div>
        </div>
      </div>`;
  }).join('');

  milestones.forEach((ms, idx) => {
    if (ms.error) return;
    const sectionId   = `milestone-${idx}`;
    const label       = document.getElementById(`${sectionId}-section-label`);
    const sectionBody = document.getElementById(`${sectionId}-section-body`);
    const chevron     = document.getElementById(`${sectionId}-section-chevron`);
    const ticketBody  = document.getElementById(`${sectionId}-body`);

    if (label && sectionBody) {
      label.addEventListener('click', () => {
        const open = sectionBody.style.display !== 'none';
        sectionBody.style.display = open ? 'none' : '';
        chevron.textContent       = open ? '▶' : '▼';
      });
    }
    if (ticketBody) wireTicketClicks(ticketBody);
    const filterRow = document.getElementById(`${sectionId}-filter-row`);
    if (filterRow) wireScopePills(filterRow);
  });
}

function renderScreen(screenId) {
  switch (screenId) {
    case 'auth':
      // Static content, no render needed
      break;
    case 'role-select':
      renderRoleSelectScreen();
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
 * Unified welcome screen — handles both:
 *   a) First launch (no role set): shows role cards so the user can pick.
 *   b) Credentials missing (role already set): shows greeting + Go to Settings only.
 */
function renderRoleSelectScreen() {
  const body = document.getElementById('role-select-body');
  if (!body) return;

  const hasRole   = !!state.settings?.role;
  const sel       = state.pendingRole || (hasRole ? state.settings.role : '');
  const hasCreds  = !!(state.settings?.jira?.token && state.settings?.sentry?.token);

  const roleCards = [
    {
      role: 'em',
      svg: `<svg width="36" height="36" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/>
      </svg>`,
      title: 'Engineering Manager'
    },
    {
      role: 'engineer',
      svg: `<svg width="36" height="36" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd"/>
      </svg>`,
      title: 'Engineer'
    }
  ];

  const showRoleCards = !hasRole;  // only show cards when role not yet chosen
  const btnEnabled    = hasRole || !!sel;
  const btnLabel      = hasCreds ? 'Continue →' : 'Go to Settings →';

  body.innerHTML = `
    <div style="text-align:center;padding:28px 0 22px;">
      <span class="theme-logo welcome-logo-wrap">
        <img class="logo-light" src="icons/cap-color.png" alt="Zealer Dashboard">
        <img class="logo-dark"  src="icons/cap-white.png" alt="">
      </span>
      <h2 style="font-size:19px;font-weight:700;margin:0 0 8px;">Hello, Zealer! 👋</h2>
      <p style="font-size:12px;color:var(--text-muted);margin:0;">
        ${showRoleCards
          ? 'Set your default view — change it anytime in Settings.'
          : 'Connect your Jira and Sentry to get started.'}
      </p>
    </div>

    ${showRoleCards ? `
    <p style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;text-align:center;margin-bottom:10px;">
      What's your role?
    </p>
    <div class="role-cards">
      ${roleCards.map(c => `
        <button class="role-card ${sel === c.role ? 'selected' : ''}" data-role="${c.role}">
          <span class="role-card-icon">${c.svg}</span>
          <span class="role-card-title">${c.title}</span>
        </button>
      `).join('')}
    </div>` : ''}

    <button id="role-continue-btn" class="btn-primary"
      style="width:100%;margin-top:18px;opacity:${btnEnabled ? '1' : '0.4'};pointer-events:${btnEnabled ? 'auto' : 'none'};">
      ${btnLabel}
    </button>
  `;

  // Role card selection (only when cards are visible)
  if (showRoleCards) {
    body.querySelectorAll('.role-card').forEach(card => {
      card.addEventListener('click', () => {
        state.pendingRole = card.dataset.role;
        renderRoleSelectScreen();
      });
    });
  }

  // Continue / Go to Settings button
  document.getElementById('role-continue-btn')?.addEventListener('click', async () => {
    const chosenRole = sel || state.settings?.role;
    if (!chosenRole && showRoleCards) return;  // must pick a role first

    state.settings             = state.settings || {};
    if (chosenRole) state.settings.role = chosenRole;
    state.settings.viewScope   = chosenRole === 'engineer' ? 'me' : 'squad';
    state.viewScope            = state.settings.viewScope;
    await chrome.storage.local.set({ settings: state.settings });

    if (hasCreds) {
      await loadData();
      showScreen('today');
      refreshDashboard();
    } else {
      chrome.runtime.openOptionsPage();
    }
  });
}


/** Render the Me / Squad scope toggle (engineer mode only). */
function buildScopeToggleHtml() {
  const me    = state.viewScope === 'me';
  const squad = !me;
  return `<span class="view-scope-row" style="display:inline-flex;gap:4px;vertical-align:middle;">
    <button class="scope-pill${me    ? ' active' : ''}" data-scope="me">Me</button>
    <button class="scope-pill${squad ? ' active' : ''}" data-scope="squad">Squad</button>
  </span>`;
}

/** Wire Me/Squad scope pill clicks. Each click persists the scope and re-renders. */
function wireScopePills(container) {
  if (!container) return;
  container.querySelectorAll('.scope-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.viewScope          = btn.dataset.scope;
      state.settings           = state.settings || {};
      state.settings.viewScope = state.viewScope;
      await chrome.storage.local.set({ settings: state.settings });
      renderCurrentScreen();  // re-renders story list
      renderInsights();       // re-renders time logged + estimate charts
    });
  });
}

/**
 * Build a vertical bar chart SVG for one engineer's personal time data.
 * Works for both sprint (daily) and quarterly (monthly) modes.
 *
 * @param {Array<{label, actual, estimate}>} periods  — one entry per X tick
 * @param {object} opts
 *   opts.showEstimate {boolean}   — render estimate bar alongside actual
 *   opts.unit         {string}    — "h" for hours
 *   opts.primaryColor {string}
 *   opts.estimateColor{string}
 */
function buildPersonalBarsSVG(periods, opts = {}) {
  if (!periods || periods.length === 0) return '';
  const {
    showEstimate  = false,
    unit          = 'h',
    primaryColor  = 'var(--primary,#6366f1)',
    estimateColor = 'rgba(100,116,139,0.55)',
  } = opts;

  const W = 290, H = 95;
  const ML = 26, MR = 4, MT = 6, MB = 20;
  const CW = W - ML - MR, CH = H - MT - MB;

  const maxVal = Math.max(
    ...periods.map(p => Math.max(p.actual || 0, showEstimate ? (p.estimate || 0) : 0)),
    0.5
  );
  const round1 = v => Math.round(v * 10) / 10;
  const n = periods.length;
  const groupW = CW / n;
  const barsPerGroup = showEstimate ? 2 : 1;
  const barW  = Math.max(2, Math.min(14, (groupW / barsPerGroup) - 2));
  const barGap = showEstimate ? 1 : 0;

  // ── Y axis labels (0, mid, max) ──────────────────────────────────────
  const yLevels = [0, maxVal / 2, maxVal];
  const yLines = yLevels.map(v => {
    const y = MT + CH - (v / maxVal) * CH;
    const lbl = v === 0 ? '0' : `${round1(v)}${unit}`;
    return `<line x1="${ML}" y1="${y.toFixed(1)}" x2="${W - MR}" y2="${y.toFixed(1)}"
        stroke="var(--border,rgba(255,255,255,0.06))" stroke-width="0.5"/>
      <text x="${ML - 3}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle"
        style="font-size:8px;fill:var(--text-muted);">${lbl}</text>`;
  }).join('');

  // ── Bars ─────────────────────────────────────────────────────────────
  const bars = periods.map((p, i) => {
    const cx = ML + i * groupW + groupW / 2;
    let rects = '';

    if (showEstimate) {
      const eh = ((p.estimate || 0) / maxVal) * CH;
      const ex = cx - barW - barGap / 2;
      const ey = MT + CH - eh;
      rects += `<rect x="${ex.toFixed(1)}" y="${ey.toFixed(1)}" width="${barW}" height="${Math.max(0.5, eh).toFixed(1)}"
        rx="1" fill="${estimateColor}"/>`;
    }

    const ah = ((p.actual || 0) / maxVal) * CH;
    const ax = showEstimate ? cx + barGap / 2 : cx - barW / 2;
    const ay = MT + CH - ah;
    rects += `<rect x="${ax.toFixed(1)}" y="${ay.toFixed(1)}" width="${barW}" height="${Math.max(0.5, ah).toFixed(1)}"
      rx="1" fill="${primaryColor}" opacity="0.9"/>`;

    return rects;
  }).join('');

  // ── X axis labels (skip if too dense) ────────────────────────────────
  const every = Math.max(1, Math.ceil(n / 10));
  const xLabels = periods
    .filter((_, i) => i % every === 0 || i === n - 1)
    .map(p => {
      const i = periods.indexOf(p);
      const x = ML + i * groupW + groupW / 2;
      return `<text x="${x.toFixed(1)}" y="${H - 5}" text-anchor="middle"
        style="font-size:8px;fill:var(--text-muted);">${p.label}</text>`;
    }).join('');

  // ── Legend for estimate vs actual ────────────────────────────────────
  const legend = showEstimate ? `
    <rect x="${ML}" y="0" width="7" height="5" fill="${estimateColor}" rx="1"/>
    <text x="${ML + 9}" y="4" style="font-size:7px;fill:var(--text-muted);">Est</text>
    <rect x="${ML + 30}" y="0" width="7" height="5" fill="${primaryColor}" rx="1" opacity="0.9"/>
    <text x="${ML + 40}" y="4" style="font-size:7px;fill:var(--text-muted);">Actual</text>` : '';

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;overflow:visible;"
      preserveAspectRatio="xMidYMid meet">
    ${legend}
    <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + CH}"
      stroke="var(--border,rgba(255,255,255,0.1))" stroke-width="0.5"/>
    ${yLines}
    ${bars}
    ${xLabels}
  </svg>`;
}

/**
 * Produce the periods array for buildPersonalBarsSVG in sprint (daily) mode.
 * Days from sprintStart to today (capped at sprintEnd).
 */
function personalSprintPeriods(byDate, sprintStart, sprintEnd, dailyEstimate) {
  const today   = new Date().toISOString().slice(0, 10);
  const effEnd  = sprintEnd < today ? sprintEnd : today;
  const periods = [];
  const d = new Date(sprintStart + 'T12:00:00');
  const end = new Date(effEnd + 'T12:00:00');
  while (d <= end) {
    const key = d.toISOString().slice(0, 10);
    const dayNum = d.getDate();
    const dow = ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()];
    periods.push({
      label:    `${dow} ${dayNum}`,
      actual:   byDate[key] || 0,
      estimate: dailyEstimate,
    });
    d.setDate(d.getDate() + 1);
  }
  return periods;
}

/**
 * Produce the periods array for buildPersonalBarsSVG in quarterly mode.
 * One period per month in the quarter.
 */
function personalQuarterPeriods(byDate, qStart, qEnd, totalEstimate) {
  const months   = [];
  const d        = new Date(qStart + 'T12:00:00');
  const end      = new Date(qEnd + 'T12:00:00');
  while (d <= end) {
    const ym = d.toISOString().slice(0, 7);  // 'YYYY-MM'
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    if (!months.find(m => m.ym === ym)) months.push({ ym, label: mon });
    d.setMonth(d.getMonth() + 1);
  }
  const monthlyEst = months.length > 0 ? totalEstimate / months.length : 0;
  const byMonth = {};
  for (const [date, h] of Object.entries(byDate || {})) {
    const ym = date.slice(0, 7);
    byMonth[ym] = (byMonth[ym] || 0) + h;
  }
  return months.map(m => ({
    label:    m.label,
    actual:   Math.round((byMonth[m.ym] || 0) * 10) / 10,
    estimate: Math.round(monthlyEst * 10) / 10,
  }));
}

/** Render the card wrapper for a personal chart (reuses the existing card style). */
function buildPersonalChartCard(title, subtitle, svgHtml) {
  return `<div style="padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;display:flex;flex-direction:column;width:100%;box-sizing:border-box;">
    <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">${title}</div>
    ${subtitle ? `<div style="font-size:10px;color:var(--text-muted);margin-top:1px;">${subtitle}</div>` : ''}
    <div style="margin-top:6px;">${svgHtml}</div>
  </div>`;
}

/**
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
  // filteredTs: engineers see their own data in 'me' mode; EM uses the DDL filter.
  const filteredTs = (() => {
    if (state.settings?.role === 'engineer') {
      if (state.viewScope === 'me') {
        // Guard: if currentUser hasn't loaded yet, show all rather than an empty timesheet
        if (!state.currentUser?.accountId && !state.currentUser?.displayName) return ts;
        // Match by accountId first (reliable), fall back to displayName
        return ts.filter(m =>
          (state.currentUser.accountId && m.accountId === state.currentUser.accountId) ||
          (state.currentUser.displayName && m.name === state.currentUser.displayName)
        );
      }
      return ts; // squad = full team, no DDL filter in engineer mode
    }
    return monitored?.length > 0 ? ts.filter(m => isMonitored(m, monitored)) : ts;
  })();
  const discoveredMembers = (state.settings?.analytics?.discoveredMembers
      || ts.map(m => ({ accountId: m.accountId, name: m.name })))
    .map(normalizeMember)
    .filter(d => d.name || d.accountId);
  
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
  
  // In engineer mode use the Me/Squad scope toggle; in EM mode keep the DDL filter.
  const isEngineer = state.settings?.role === 'engineer';
  const totalCount    = discoveredMembers.length;
  const filteredCount = (monitored?.length > 0) ? monitored.length : totalCount;
  const filterActive  = monitored?.length > 0;
  const memberFilterHtml = discoveredMembers.length > 0 ? `
    <div style="position:relative;display:inline-block;">
      <button id="member-filter-btn" title="Filter team members"
        style="background:none;border:1px solid ${filterActive ? 'var(--primary,#6366f1)' : 'var(--border,rgba(255,255,255,0.1))'};border-radius:4px;padding:2px 6px;color:${filterActive ? 'var(--primary,#6366f1)' : 'var(--text-muted)'};font-size:11px;cursor:pointer;line-height:1.4;">
        👥 ${filteredCount}/${totalCount}${filterActive ? ' ●' : ''}
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
          ${discoveredMembers.map(mem => {
            const key = memberKey(mem);
            const checked = !monitored || monitored.length === 0 || isMonitored(mem, monitored);
            return `<label style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text);cursor:pointer;">
              <input type="checkbox" class="member-filter-cb" data-key="${escapeHtml(key)}"
                ${checked ? 'checked' : ''}
                style="accent-color:var(--primary,#6366f1);width:13px;height:13px;"/>
              ${escapeHtml(mem.name)}
            </label>`;
          }).join('')}
        </div>
        <button id="member-filter-apply"
          style="margin-top:10px;width:100%;padding:5px;background:var(--primary,#6366f1);
                 border:none;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">Apply</button>
      </div>
    </div>` : '';
  // Engineer mode: scope toggle replaces the DDL filter. EM mode: DDL filter.
  const filterControl = isEngineer ? buildScopeToggleHtml() : memberFilterHtml;

  // (Estimate vs Actual uses the same filter btn in the shared control bar above)
  
  // Determine member list for the current mode, then apply monitored filter
  const rawTimesheetMembers = (currentMode === 'sprint')
    ? ts
    : state.quarterWorklogCache?.[currentMode]?.members || null;
  
  // Apply the same monitored filter regardless of mode (sprint or quarter)
  const timesheetMembers = rawTimesheetMembers === null
    ? null   // still loading
    : (monitored?.length > 0
        ? rawTimesheetMembers.filter(m => isMonitored(m, monitored))
        : rawTimesheetMembers);
  
  // ── Dates — must be declared before isEngineerMe uses modeStart/modeEnd ──
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

  let timesheetHtml = '';
  // ── Engineer me-mode: personal time-series chart ─────────────────────
  // accountId-based; only requires currentUser to be loaded.
  const isEngineerMe = state.settings?.role === 'engineer'
                    && state.viewScope === 'me'
                    && !!state.currentUser
                    && !!(state.currentUser.accountId || state.currentUser.displayName);
  const myMember = isEngineerMe ? (filteredTs[0] || null) : null;

  if (isEngineerMe) {
    // In me-mode we NEVER show the squad chart. Three sub-cases:
    if (currentMode !== 'sprint' && timesheetMembers === null) {
      timesheetHtml = `<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">
        Loading ${currentMode} data… <span id="timesheet-loading-indicator">⏳</span></div>`;
    } else if (myMember?.byDate) {
      const periods = (currentMode === 'sprint')
        ? personalSprintPeriods(myMember.byDate, modeStart, modeEnd,
            myMember.estimated > 0 ? +(myMember.estimated / Math.max(1,
              personalSprintPeriods(myMember.byDate, modeStart, modeEnd, 0).length
            )).toFixed(1) : 0)
        : personalQuarterPeriods(myMember.byDate, modeStart, modeEnd, myMember.estimated);
      timesheetHtml = buildPersonalBarsSVG(periods, { showEstimate: false });
    } else if (myMember) {
      // Stale cache aggregated before byDate existed — show total + refresh hint
      timesheetHtml = `<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">
        You logged <strong style="color:var(--text);">${myMember.total}h</strong> this period.
        <br><span style="font-size:11px;">Click ↻ to load the daily breakdown.</span></div>`;
    } else {
      timesheetHtml = `<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">
        No time logged by you in this period.</div>`;
    }
  } else if (isLegacyFormat) {
    timesheetHtml = `<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">
      Data format updated — click ↻ to refresh and load cross-squad time data.</div>`;
  } else if (currentMode !== 'sprint' && timesheetMembers === null) {
    timesheetHtml = `<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">
      Loading ${currentMode} data… <span id="timesheet-loading-indicator">⏳</span></div>`;
  } else if ((timesheetMembers || []).length > 0) {
    // Capacity reference (sprint mode only): expected hours per person so far =
    // elapsed working days × 8h. Drives the "who's over capacity?" marker.
    let capacityHours = 0;
    if (currentMode === 'sprint' && state.currentSprint?.startDate) {
      const wds = state.settings?.ui?.workingDays || [0,1,2,3,4];
      const start = new Date(state.currentSprint.startDate.slice(0,10));
      const today = new Date(); today.setHours(0,0,0,0);
      let elapsed = 0;
      for (let d = new Date(start); d <= today; d.setDate(d.getDate()+1)) {
        if (wds.includes(d.getDay())) elapsed++;
      }
      capacityHours = elapsed * 7;
    }
    timesheetHtml = buildTimesheetSVG(timesheetMembers, capacityHours);
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
  
  // ── Dates (declared above, before isEngineerMe) ───────────────────────
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
        ${filterControl}
      </div>
    </div>`;

  // ── Estimate vs Actual ────────────────────────────────────────────────
  const quarterPending = currentMode !== 'sprint' && timesheetMembers === null;
  const teamForEstimate = quarterPending ? [] : (timesheetMembers || filteredTs);
  let estimateVsActualHtml = '';

  if (isEngineerMe) {
    // Me-mode: personal grouped bars only; never squad data.
    if (currentMode !== 'sprint' && timesheetMembers === null) {
      estimateVsActualHtml = `
        <div style="padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;display:flex;flex-direction:column;width:100%;">
          <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;margin-bottom:2px;">ESTIMATE VS ACTUAL</div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">${modeRange}</div>
          <div style="font-size:12px;color:var(--text-muted);padding:8px 0;">Loading ${currentMode} data… ⏳</div>
        </div>`;
    } else if (myMember?.byDate) {
      const hasEst  = (myMember.estimated || 0) > 0;
      const periods = (currentMode === 'sprint')
        ? personalSprintPeriods(myMember.byDate, modeStart, modeEnd,
            hasEst ? +(myMember.estimated / Math.max(1,
              personalSprintPeriods(myMember.byDate, modeStart, modeEnd, 0).length
            )).toFixed(1) : 0)
        : personalQuarterPeriods(myMember.byDate, modeStart, modeEnd, myMember.estimated);
      const svg = buildPersonalBarsSVG(periods, { showEstimate: hasEst });
      estimateVsActualHtml = buildPersonalChartCard(
        'ESTIMATE VS ACTUAL',
        modeRange,
        svg + (hasEst
          ? ''
          : '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">No estimates set on your assigned tickets.</div>')
      );
    } else if (myMember) {
      estimateVsActualHtml = buildPersonalChartCard(
        'ESTIMATE VS ACTUAL',
        modeRange,
        `<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">
          You logged <strong style="color:var(--text);">${myMember.total}h</strong> vs
          <strong style="color:var(--text);">${myMember.estimated || 0}h</strong> estimated.
          <br><span style="font-size:11px;">Click ↻ to load the period breakdown.</span></div>`
      );
    }
    // else: no member → leave estimateVsActualHtml empty (card omitted)
  } else if (quarterPending) {
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
  
  // ── Sprint Timeline (Gantt) — below the two time charts, same Me/Squad scope ──
  const workingDays  = state.settings?.ui?.workingDays || [0,1,2,3,4];
  // Stories + subtasks — the Gantt shows both (like the reference extension);
  // subtasks stay out of every other chart (burndown/points would double-count).
  // Parent stories and their child subtasks are passed SEPARATELY — the Gantt
  // nests each subtask into its parent's row (one row per parent, children as
  // per-assignee sub-lanes), matching the Sprint Planner layout.
  const ganttStories  = state.currentSprint?.stories  || [];
  const ganttSubtasks = state.currentSprint?.subtasks || [];
  const ganttSprint  = state.currentSprint
    ? { name: state.currentSprint.name,
        startDate: (state.currentSprint.startDate || '').slice(0,10),
        endDate:   (state.currentSprint.endDate   || '').slice(0,10) }
    : null;
  const ganttAccountId = state.currentUser?.accountId || '';

  let ganttSectionHtml = '';
  if (ganttSprint?.startDate && (ganttStories.length > 0 || ganttSubtasks.length > 0)) {
    const ganttInner   = buildGanttSVG(ganttStories, ganttSprint, workingDays, ganttAccountId,
      { filterMine: isEngineerMe, minWidth: '320px', subtasks: ganttSubtasks });
    const sprintRange  = `${ganttSprint.startDate} → ${ganttSprint.endDate}`;
    const ganttLabel   = isEngineerMe ? 'MY TIMELINE' : 'SPRINT TIMELINE';
    ganttSectionHtml = `
    <div style="margin-top:8px;padding:10px 12px;background:var(--surface,#11131c);
      border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;
        cursor:pointer;user-select:none;" id="gantt-toggle-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="gantt-expand-btn" style="background:none;border:none;color:var(--text-muted);
            cursor:pointer;font-size:12px;padding:2px 4px;line-height:1;" title="Open in full tab / export PDF">⤢</button>
          <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">${ganttLabel}</div>
          <div style="font-size:10px;color:var(--text-muted);">${sprintRange}</div>
        </div>
        <button id="gantt-toggle-btn" style="background:none;border:none;color:var(--text-muted);
          cursor:pointer;font-size:11px;padding:2px 4px;line-height:1;" title="Toggle Gantt">▼</button>
      </div>
      <div id="gantt-container" style="overflow-x:auto;margin-top:8px;">${ganttInner}</div>
    </div>`;
  }

  // ── Milestone summary (compact, above filters) ───────────────────────
  // Shows each milestone with an explicit stacked breakdown — Done / In
  // Progress / Open as labelled count rows (like the support board), not just
  // a thin done-vs-rest bar. The full clickable cards live below.
  const msData = state.milestonesData || [];
  let milestoneSummaryHtml = '';
  if (msData.length > 0) {
    const msRows = msData.map((ms, idx) => {
      if (ms.error) return '';
      const allTickets = ms.tickets || [];
      const tickets = isEngineerMe
        ? allTickets.filter(t => t.assigneeAccountId === state.currentUser?.accountId)
        : allTickets;
      const { total, done, inProg, open, pct } = milestoneCounts(tickets);
      if (total === 0 && !isEngineerMe) return ''; // hide empty milestones in squad mode

      const pctColor = pct === 100 ? '#34d399' : pct >= 50 ? '#fbbf24' : 'var(--text-muted)';

      // Stacked breakdown rows: count · label, colour-coded, under each other.
      const brk = [
        { n: done,   label: 'Done',        color: '#22c55e' },
        { n: inProg, label: 'In Progress', color: '#3b82f6' },
        { n: open,   label: 'Open',        color: 'var(--text-muted)' },
      ].filter(r => r.n > 0).map(r => `
        <div style="display:flex;align-items:center;gap:6px;font-size:11px;line-height:1.7;">
          <span style="width:7px;height:7px;border-radius:2px;background:${r.color};flex-shrink:0;"></span>
          <span style="color:var(--text);font-weight:600;min-width:14px;">${r.n}</span>
          <span style="color:var(--text-muted);">${r.label}</span>
        </div>`).join('');

      return `
        <div data-milestone-idx="${idx}" style="padding:7px 0;cursor:pointer;
          border-bottom:1px solid var(--border,rgba(255,255,255,0.04));"
          title="Click to expand milestone details">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px;">
            <span style="font-size:11px;color:var(--text);flex:1;min-width:0;overflow:hidden;
              text-overflow:ellipsis;white-space:nowrap;">🎯 ${escapeHtml(ms.name || ms.label)}</span>
            <span style="font-size:10px;font-weight:600;color:${pctColor};flex-shrink:0;">${done}/${total} · ${pct}%</span>
          </div>
          ${brk || '<div style="font-size:11px;color:var(--text-muted);">No tickets yet</div>'}
        </div>`;
    }).filter(Boolean).join('');

    if (msRows) {
      milestoneSummaryHtml = `
      <div style="margin-top:8px;padding:8px 12px;background:var(--surface,#11131c);
        border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;">
        <div class="section-label-std" style="margin-bottom:4px;">MILESTONES</div>
        <div id="milestone-summary-rows">${msRows}</div>
      </div>`;
    }
  }

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
    <div id="sentry-trend-card" style="display:none;margin-top:8px;"></div>
    ${milestoneSummaryHtml}
    <div id="engineer-progress-row" style="display:none;margin-top:6px;"></div>
    ${sharedControlBar}
    <div style="${outerStyle2}">
      <div style="${chartWrap2}">
        <div style="${cardStyle}">
          <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">${isEngineerMe ? 'MY TIME' : 'TIME LOGGED'}</div>
          ${dateSubtitle(modeRange)}
          <div style="margin-top:6px;">${timesheetHtml}</div>
          ${qRefreshNote}
        </div>
      </div>
      <div style="${chartWrap2}">${estimateVsActualHtml}</div>
    </div>
    ${ganttSectionHtml}`;

  wireBurndownHover();
  wireTimesheetHover();
  // Engineer me/squad toggle wiring — variable is 'content', not 'contentEl'
  if (state.settings?.role === 'engineer') wireScopePills(content);
  // Re-populate sentry trend card now that it lives inside insights-content
  renderSentryTrend().catch(e => console.warn('[insights] Sentry trend re-render:', e.message));
  // Engineer progress circles: div is now inside insights-content so must be
  // populated AFTER innerHTML is set (not before, as in the old renderTodayScreen call).
  renderEngineerProgressCircles();

  // Milestone summary: click a row to scroll to + expand the full milestone card
  document.getElementById('milestone-summary-rows')?.querySelectorAll('[data-milestone-idx]').forEach(row => {
    row.addEventListener('click', () => {
      const idx = row.dataset.milestoneIdx;
      const label = document.getElementById(`milestone-${idx}-section-label`);
      const body  = document.getElementById(`milestone-${idx}-section-body`);
      const chevron = document.getElementById(`milestone-${idx}-section-chevron`);
      if (label) {
        // Expand if collapsed
        if (body && body.style.display === 'none') {
          body.style.display = '';
          if (chevron) chevron.textContent = '▼';
        }
        label.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Gantt collapse/expand toggle
  const ganttHeader = document.getElementById('gantt-toggle-header');
  const ganttBtn    = document.getElementById('gantt-toggle-btn');
  const ganttCont   = document.getElementById('gantt-container');
  if (ganttHeader && ganttCont) {
    ganttHeader.addEventListener('click', (e) => {
      // Don't toggle when the expand button (inside the header) is clicked
      if (e.target.closest('#gantt-expand-btn')) return;
      const collapsed = ganttCont.style.display === 'none';
      ganttCont.style.display = collapsed ? 'block' : 'none';
      if (ganttBtn) ganttBtn.textContent = collapsed ? '▼' : '▲';
    });
  }
  // Expand to full tab + PDF: stash the gantt payload, open the tab page.
  const ganttExpandBtn = document.getElementById('gantt-expand-btn');
  if (ganttExpandBtn) {
    ganttExpandBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await chrome.storage.local.set({ ganttTabState: {
          sprint: ganttSprint,
          stories: ganttStories,
          subtasks: ganttSubtasks,
          workingDays,
          accountId: ganttAccountId,
          scope: isEngineerMe ? 'me' : 'squad',
          projectName: state.settings?.squad?.projectKey || state.currentSprint?.boardName || '',
          jiraBaseUrl: state.settings?.jira?.baseUrl || '',
        }});
        chrome.tabs.create({ url: chrome.runtime.getURL('gantt-tab.html') });
      } catch (err) {
        console.error('[popup] Failed to open Gantt tab:', err);
      }
    });
  }
  
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
          const accountIds = [...new Set([...(analytics.timesheet || []).map(m => m.accountId), ...discoveredMembers.map(m => m.accountId)].filter(Boolean))];
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
    const accountIds = [...new Set([...(analytics.timesheet || []).map(m => m.accountId), ...discoveredMembers.map(m => m.accountId)].filter(Boolean))];
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
        .map(cb => cb.dataset.key);
      const totalCbs = document.querySelectorAll('.member-filter-cb').length;

      // null = "show all" — store null rather than a full-length array so the
      // filter is correctly considered inactive (fixes badge showing wrong count
      // and subtle "applied something unexpected" behaviour on re-open).
      const newMonitored = (selected.length === 0 || selected.length >= totalCbs)
        ? null : selected;
      state.settings = state.settings || {};
      state.settings.analytics = {
        ...(state.settings.analytics || {}),
        monitoredMembers: newMonitored
      };
      await chrome.storage.local.set({ settings: state.settings });

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
// ── Phase 5: Engineer progress circles ───────────────────────────────

/**
 * Build an SVG donut chart.
 * @param {Array<{value, color}>} segments
 * @param {string} centerMain   - large centre label
 * @param {string} centerSub    - small label below centre
 * @param {number} size         - overall SVG size in px
 * @param {number} strokeW      - ring stroke width in px
 */
function buildDonut({ segments, centerMain, centerSub, size = 80, strokeW = 14 }) {
  const r    = (size - strokeW) / 2;
  const circ = 2 * Math.PI * r;
  const cx   = size / 2;
  const cy   = size / 2;
  const total = segments.reduce((s, g) => s + g.value, 0);
  if (total === 0) return '';

  // Start at 12 o'clock
  const startOff = circ / 4;
  let accumulated = 0;

  const track = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
    stroke="var(--surface-raised,#1f2937)" stroke-width="${strokeW}"/>`;

  const arcs = segments.map(seg => {
    const dash   = (seg.value / total) * circ;
    const gap    = circ - dash;
    const offset = startOff - accumulated;
    accumulated += dash;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${seg.color}" stroke-width="${strokeW}"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      stroke-dashoffset="${offset.toFixed(2)}"
      style="transform-origin:center;transition:stroke-dasharray .3s ease;"/>`;
  });

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    ${track}
    ${arcs.join('')}
    <text x="${cx}" y="${cy - 1}" text-anchor="middle" dominant-baseline="middle"
      style="font-size:12px;font-weight:700;fill:var(--text);">${centerMain}</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle"
      style="font-size:9px;fill:var(--text-muted);">${centerSub}</text>
  </svg>`;
}

/**
 * Render the two personal progress circles for engineer mode.
 * Always uses "me" scope regardless of state.viewScope.
 * Hidden entirely when the engineer has no assignments in a given category.
 */
function renderEngineerProgressCircles() {
  const row = document.getElementById('engineer-progress-row');
  if (!row) return;

  // Engineer-only feature — but demo mode showcases it regardless of the
  // user's real role (mock "me" = mock-acc-ahmed has sprint + support tickets).
  const roleOk = state.settings?.role === 'engineer' || state.mockMode;
  if (!roleOk || !state.currentUser?.accountId) {
    row.style.display = 'none';
    return;
  }

  const accountId = state.currentUser.accountId;

  // Sprint: filter to current user's stories
  const myStories = (state.currentSprint?.stories || [])
    .filter(s => s.assigneeAccountId === accountId);
  const sprintPts = myStories.reduce((s, t) => s + (t.points || 0), 0);

  // Support: all support boards → flatten to current user's tickets
  const mySupport = (state.extraBoardsData || [])
    .filter(b => (b.boardLabel || '').toLowerCase().includes('support'))
    .flatMap(b => (b.stories || []).filter(s => s.assigneeAccountId === accountId));
  const supportTotal = mySupport.length;

  if (sprintPts === 0 && supportTotal === 0) {
    row.style.display = 'none';
    return;
  }

  // Colour palette (matches existing status pills)
  const C_DONE   = '#34d399';   // green
  const C_PROG   = '#60a5fa';   // blue
  const C_OPEN   = 'var(--text-lighter, #475569)';  // slate

  // ── Sprint donut ──────────────────────────────────────────────────
  let sprintDonutHtml = '';
  if (sprintPts > 0) {
    const donePts = myStories
      .filter(s => s.statusCategory === 'done')
      .reduce((s, t) => s + (t.points || 0), 0);
    const progPts = myStories
      .filter(s => s.statusCategory === 'indeterminate')
      .reduce((s, t) => s + (t.points || 0), 0);
    const openPts = myStories
      .filter(s => s.statusCategory === 'new')
      .reduce((s, t) => s + (t.points || 0), 0);

    const segs = [
      { value: donePts, color: C_DONE },
      { value: progPts, color: C_PROG },
      { value: openPts, color: C_OPEN },
    ].filter(s => s.value > 0);

    sprintDonutHtml = buildDonut({
      segments:   segs,
      centerMain: `${donePts}/${sprintPts}`,
      centerSub:  `${myStories.length} ticket${myStories.length !== 1 ? 's' : ''}`,
    });
  }

  // ── Support donut ─────────────────────────────────────────────────
  let supportDonutHtml = '';
  if (supportTotal > 0) {
    const suppDone = mySupport.filter(s => s.statusCategory === 'done').length;
    const suppProg = mySupport.filter(s => s.statusCategory === 'indeterminate').length;
    const suppOpen = mySupport.filter(s => s.statusCategory === 'new').length;

    const segs = [
      { value: suppDone, color: C_DONE },
      { value: suppProg, color: C_PROG },
      { value: suppOpen, color: C_OPEN },
    ].filter(s => s.value > 0);

    supportDonutHtml = buildDonut({
      segments:   segs,
      centerMain: `${suppDone}/${supportTotal}`,
      centerSub:  'support',
    });
  }

  // ── Render ────────────────────────────────────────────────────────
  const makeCard = (donutSvg, label) => `
    <div class="progress-circle-card">
      ${donutSvg}
      <span class="progress-circle-label">${label}</span>
    </div>`;

  row.style.display = '';
  row.innerHTML = `
    <div style="font-size:10px;font-weight:600;color:var(--text-muted);
      letter-spacing:0.3px;margin:2px 0 4px;text-transform:uppercase;">My Tasks</div>
    <div class="progress-circles-row">
      ${sprintPts   > 0 ? makeCard(sprintDonutHtml,  'Sprint') : ''}
      ${supportTotal > 0 ? makeCard(supportDonutHtml, 'Support') : ''}
      <div class="progress-circles-legend">
        <span class="pcl-dot" style="background:${C_DONE}"></span>Done
        <span class="pcl-dot" style="background:${C_PROG}"></span>In Progress
        <span class="pcl-dot" style="background:${C_OPEN}"></span>Open
      </div>
    </div>`;
}

// ── Anti-flicker machinery ──────────────────────────────────────────────
// The background notifies the popup separately per source (jira, sentry, …),
// and each notification used to trigger a full innerHTML rebuild — 3 rebuilds
// in quick succession on open (cache → jira → sentry), collapsing open
// sections and visibly flickering the charts area.

// (1) Fingerprint: skip the rebuild entirely when the data that drives the
//     Today screen hasn't actually changed.
let _lastTodayFingerprint = '';
let _lastTrendFingerprint = '';
function todayFingerprint() {
  try {
    return JSON.stringify({
      cs: state.currentSprint, sa: state.sprintAnalytics,
      sup: state.supportTickets, eb: state.extraBoardsData,
      ms: state.milestonesData, sv: state.sentryViews,
      al: visibleAlerts(state.alerts, state.alertSnoozes).length,
      scope: state.viewScope, mode: state.timesheetMode, mock: state.mockMode,
    });
  } catch { return String(Date.now()); } // never let fingerprinting block a render
}

// (2) Collapse-state preservation: snapshot which sections the user opened
//     before a rebuild and restore them after.
function snapshotOpenSections() {
  const map = {};
  document.querySelectorAll('[id$="-section-body"]').forEach(el => { map[el.id] = el.style.display; });
  const gantt = document.getElementById('gantt-container');
  if (gantt) map['gantt-container'] = gantt.style.display;
  const insights = document.getElementById('insights-body');
  if (insights) map['insights-body'] = insights.style.display;
  return map;
}
function restoreOpenSections(map) {
  for (const [id, disp] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.display = disp;
    // Only sync a chevron for ids that ACTUALLY end in -section-body. For the
    // two special keys (insights-body, gantt-container) the replace is a no-op,
    // so getElementById would return the body element itself and writing
    // textContent to it would wipe the whole section's content. Those two have
    // dedicated chevron/button handling after this loop.
    if (id.endsWith('-section-body')) {
      const chev = document.getElementById(id.replace('-section-body', '-section-chevron'));
      if (chev) chev.textContent = (disp === 'none') ? '▶' : '▼';
    }
  }
  const ganttBtn = document.getElementById('gantt-toggle-btn');
  const gantt = document.getElementById('gantt-container');
  if (ganttBtn && gantt) ganttBtn.textContent = gantt.style.display === 'none' ? '▲' : '▼';
  const insightsChevron = document.getElementById('insights-chevron');
  const insights = document.getElementById('insights-body');
  if (insightsChevron && insights) insightsChevron.textContent = insights.style.display === 'none' ? '▶' : '▼';
}

// (3) Debounce: coalesce back-to-back partial-update notifications into ONE
//     rebuild (trailing edge, 250ms).
let _renderDebounceTimer = null;
function scheduleCurrentScreenRender() {
  clearTimeout(_renderDebounceTimer);
  _renderDebounceTimer = setTimeout(() => renderCurrentScreen(), 250);
}

function renderTodayScreen() {
  // Anti-flicker (1): identical data → skip the rebuild entirely
  const fp = todayFingerprint();
  if (fp === _lastTodayFingerprint && document.getElementById('insights-content')?.innerHTML) {
    return;
  }
  _lastTodayFingerprint = fp;
  // Anti-flicker (2): preserve which sections the user has open.
  // Restoration is scheduled (not called at function end) because this
  // function has early-return paths; setTimeout(0) runs after the entire
  // synchronous rebuild regardless of which exit was taken.
  const openSections = snapshotOpenSections();
  setTimeout(() => restoreOpenSections(openSections), 0);

  // Alert section — only show alerts that aren't acknowledged or snoozed
  const alertSection = document.getElementById('alert-section');
  const inbox = document.getElementById('alert-inbox');
  const unacknowledged = visibleAlerts(state.alerts, state.alertSnoozes);

  if (unacknowledged.length === 0) {
    alertSection.classList.add('hidden');
  } else {
    alertSection.classList.remove('hidden');
    const jiraBase = (state.settings?.jira?.baseUrl || '').replace(/\/$/, '');
    const ticketLink = (key) => jiraBase
      ? `<a href="${jiraBase}/browse/${escapeHtml(key)}" target="_blank" rel="noopener" class="alert-ticket-link" data-alert-link="1">${escapeHtml(key)}</a>`
      : `<span class="alert-ticket-link">${escapeHtml(key)}</span>`;

    inbox.innerHTML = unacknowledged.map(alert => {
      const hasDetail = (alert.detail && alert.detail.length) ||
                        (alert.bullets && alert.bullets.length) ||
                        (alert.tickets && alert.tickets.length);
      const bulletsHtml = (alert.bullets || []).map(b => {
        // Linkify any ticket keys that appear in the bullet text
        let html = escapeHtml(b);
        (alert.tickets || []).forEach(k => {
          html = html.replace(new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
            ticketLink(k));
        });
        return `<li>${html}</li>`;
      }).join('');
      const ticketChips = (alert.tickets || []).length && !(alert.bullets || []).length
        ? `<div class="alert-tickets">${alert.tickets.map(ticketLink).join(' ')}</div>`
        : '';

      return `
      <div class="alert-item severity-${alert.severity}" data-alert-id="${alert.id}" data-rule-id="${alert.ruleId}">
        <div class="alert-row">
          <div class="alert-main" data-alert-toggle="1" ${hasDetail ? 'role="button" tabindex="0" title="Click for details"' : ''}>
            <div class="alert-header">
              <span class="badge badge-${alert.severity}">${alert.severity.toUpperCase()}</span>
              <span class="alert-time">${formatTimestamp(alert.createdAt)}</span>
              ${hasDetail ? '<span class="alert-chevron">▶</span>' : ''}
            </div>
            <div class="alert-message">${escapeHtml(alert.message)}</div>
          </div>
          <button class="alert-close" data-alert-snooze="1" title="Snooze until tomorrow" aria-label="Snooze this alert">×</button>
        </div>
        ${hasDetail ? `
        <div class="alert-detail" style="display:none;">
          ${alert.detail ? `<div class="alert-detail-text">${escapeHtml(alert.detail)}</div>` : ''}
          ${bulletsHtml ? `<ul class="alert-bullets">${bulletsHtml}</ul>` : ''}
          ${ticketChips}
        </div>` : ''}
      </div>`;
    }).join('');

    // Wiring: expand/collapse on the main area, snooze on the × button,
    // and let ticket links open without toggling/snoozing.
    inbox.querySelectorAll('.alert-item').forEach(item => {
      const main   = item.querySelector('[data-alert-toggle]');
      const detail = item.querySelector('.alert-detail');
      const chev   = item.querySelector('.alert-chevron');
      if (main && detail) {
        const toggle = () => {
          const open = detail.style.display !== 'none';
          detail.style.display = open ? 'none' : '';
          if (chev) chev.textContent = open ? '▶' : '▼';
        };
        main.addEventListener('click', toggle);
        main.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      }
      const closeBtn = item.querySelector('[data-alert-snooze]');
      if (closeBtn) {
        closeBtn.addEventListener('click', e => {
          e.stopPropagation();
          snoozeAlert(item.dataset.ruleId);
        });
      }
      // Ticket links shouldn't bubble up into the toggle handler
      item.querySelectorAll('[data-alert-link]').forEach(a =>
        a.addEventListener('click', e => e.stopPropagation()));
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
    const stories = sp.stories || [];

    // In engineer "me" mode show only the current user's stories;
    // EM mode and engineer squad mode show the full list.
    const isEngineer   = state.settings?.role === 'engineer';
    // Guard: only apply me-filter when currentUser.accountId is loaded, else show all
    const isEngineerMe = isEngineer && state.viewScope === 'me' && !!state.currentUser?.accountId;
    const displayStories = isEngineerMe
      ? stories.filter(s => s.assigneeAccountId === state.currentUser.accountId)
      : stories;

    // Section title + count (clean — no inline toggle; filter row goes in section body)
    if (sprintTitleEl) sprintTitleEl.textContent = `Current Sprint (${sp.name})`;
    if (sprintTotalEl) {
      sprintTotalEl.textContent = isEngineerMe
        ? `${displayStories.length}/${stories.length} TICKETS`
        : `${displayStories.length} TICKETS`;
    }
    const prediction = metrics.sprintBurndownPrediction(sp);
    const onTrack = prediction.onTrack;
    
    // Headline shows just sprint name + points + day; risk goes into the mini bar pills
    let topLine = `${sp.name} · ${sp.completedPoints}/${sp.committedPoints || sp.totalPoints}pt · Day ${sp.daysElapsed}/${sp.totalDays}`;
    
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
    const isSupport = (sp.boardLabel||sp.boardName||state.settings?.squad?.key||'').toLowerCase().includes('support');
    if (countEl && displayStories.length > 0) {
      countEl.innerHTML = buildMiniProgressBar(displayStories, {
        showUnassigned: false,
        riskText,
      });
    }

    // Story list in body
    if (displayStories.length > 0 && glanceBody) {
      const existingList = document.getElementById('sprint-story-list');
      if (existingList) existingList.remove();

      const jiraBase = state.settings?.jira?.baseUrl || '';
      const listEl = document.createElement('div');
      listEl.id = 'sprint-story-list';
      listEl.innerHTML = displayStories.map(s => renderTicketRow(s, jiraBase)).join('');
      glanceBody.appendChild(listEl);
      wireTicketClicks(listEl);
    }

    // Full-width filter row above the story list (engineer mode only)
    const sprintBody = document.getElementById('sprint-section-body');
    const existingFilterRow = document.getElementById('sprint-filter-row');
    if (existingFilterRow) existingFilterRow.remove();
    if (isEngineer && sprintBody) {
      const fmtDate = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dateRange = (sp.startDate && sp.endDate)
        ? `${fmtDate(sp.startDate)} – ${fmtDate(sp.endDate)}`
        : sp.name;
      const filterRow = document.createElement('div');
      filterRow.id = 'sprint-filter-row';
      filterRow.className = 'scope-filter-row';
      filterRow.innerHTML = `
        <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;text-transform:uppercase;">
          ${escapeHtml(sp.name)} · ${escapeHtml(dateRange)}
        </span>
        ${buildScopeToggleHtml()}`;
      sprintBody.prepend(filterRow);
      wireScopePills(filterRow);
    }
  } else {
    if (sprintTitleEl) sprintTitleEl.textContent = 'Current Sprint';
    if (sprintTotalEl) sprintTotalEl.textContent = '';
    if (collapsedSummary) collapsedSummary.textContent = 'No active sprint';
    if (glanceSubtitle) glanceSubtitle.textContent = '';
  }

  // Extra boards — collapsible sections
  renderExtraBoards();
  renderMilestones();
  
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
    if (sentryEmpty) {
      // Distinguish "no views configured" (actionable — offer to configure or dismiss)
      // from "views exist but no issues" (fine — just say so).
      const noViewsConfigured = !state.settings?.sentry?.views?.length &&
                                 !!state.settings?.sentry?.token;
      if (noViewsConfigured && state.sentryCardDismissed) {
        sentryEmpty.classList.add('hidden');
      } else if (noViewsConfigured) {
        sentryEmpty.innerHTML = `
          <div style="position:relative;border:1px solid var(--border,rgba(255,255,255,0.1));
               border-radius:8px;padding:14px 16px 14px;text-align:left;">
            <button id="sentry-card-close"
              style="position:absolute;top:6px;right:8px;background:none;border:none;
                     color:var(--text-muted);cursor:pointer;font-size:16px;line-height:1;
                     padding:2px 4px;" title="Dismiss">×</button>
            <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px;">
              No Sentry views configured
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">
              Add Sentry views in Settings to track error trends and spike alerts for your squad.
              Not relevant to your role? You can safely dismiss this.
            </div>
            <a id="sentry-go-settings" href="#"
              style="font-size:11px;color:var(--primary,#6366f1);text-decoration:none;">
              Go to Settings →
            </a>
          </div>`;
        sentryEmpty.classList.remove('hidden');
        // Wire close button
        const closeBtn = document.getElementById('sentry-card-close');
        if (closeBtn) closeBtn.addEventListener('click', () => {
          chrome.storage.local.set({ sentryEmptyDismissed: true });
          state.sentryCardDismissed = true;
          sentryEmpty.classList.add('hidden');
        });
        // Wire settings link
        const goSettings = document.getElementById('sentry-go-settings');
        if (goSettings) goSettings.addEventListener('click', (e) => {
          e.preventDefault();
          chrome.runtime.openOptionsPage();
        });
      } else {
        sentryEmpty.innerHTML =
          '<div style="padding:8px 0;text-align:center;">No recent Sentry issues</div>';
        sentryEmpty.classList.remove('hidden');
      }
    }
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
async function snoozeAlert(ruleId) {
  if (!ruleId) return;
  try {
    await chrome.runtime.sendMessage({ type: 'snooze-alert', ruleId });
    // Mirror locally so the UI updates immediately (snooze until tomorrow)
    const t = new Date(); t.setDate(t.getDate() + 1);
    const key = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    state.alertSnoozes = { ...(state.alertSnoozes || {}), [ruleId]: key };
    renderCurrentScreen();
  } catch (error) {
    console.error('[popup] Failed to snooze alert:', error);
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
    // Fixed-width right area (always reserved) — keeps bar width consistent across all rows
    const blockedCell = blocked > 0
      ? `<span style="font-size:10px;color:#f59e0b;white-space:nowrap;">⚠ ${blocked} blocked</span>`
      : '';
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
      <div style="width:90px;font-size:10px;color:var(--text-muted);text-align:right;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${status}</div>
      <div style="flex:1;height:8px;background:var(--border);border-radius:3px;overflow:hidden;min-width:0;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
      <span style="font-size:10px;color:var(--text);width:18px;text-align:right;flex-shrink:0;">${count}</span>
      <div style="width:88px;flex-shrink:0;text-align:left;">${blockedCell}</div>
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
    // All three variables stay in the same unit (story points)
    donePts   = stories.filter(s => s.statusCategory === 'done')
                       .reduce((sum, s) => sum + (s.points || 0), 0);
    inProgPts = stories.filter(s => s.statusCategory === 'indeterminate')
                       .reduce((sum, s) => sum + (s.points || 0), 0);
    // Use the live totalPoints as the denominator so the % matches Jira
    total     = totalPoints;
    openPts   = total - donePts - inProgPts;
  } else {
    // Fallback: ticket counts when no sprint has story-point estimates
    donePts   = stories.filter(s => s.statusCategory === 'done').length;
    inProgPts = stories.filter(s => s.statusCategory === 'indeterminate').length;
    total     = stories.length;
    openPts   = total - donePts - inProgPts;
  }

  const donePct = total > 0 ? Math.round(donePts  / total * 100) : 0;
  const ipPct   = total > 0 ? Math.round(inProgPts / total * 100) : 0;
  const openPct = Math.max(0, 100 - donePct - ipPct);
  const unit    = usePoints ? 'pt' : 'tickets';

  // "x pts done · y pts to go" — absolute counts the user can verify against Jira
  const toGoPts   = total - donePts;
  const ptSummary = usePoints
    ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">
        <span style="font-weight:600;color:var(--text);">${donePts} pts done</span>
        &nbsp;·&nbsp;
        <span style="font-weight:600;color:var(--text);">${toGoPts} pts to go</span>
      </div>`
    : '';

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
      ${ptSummary}
    </div>`;
}

// ── Sentry Trend Chart ────────────────────────────────────────────────────
// Legend toggle state — viewIds whose line is currently hidden
const _hiddenTrendViews = new Set();

async function renderSentryTrend(force = false) {
  const card = document.getElementById('sentry-trend-card');
  if (!card) return;

  const series = await getTrackedSeries();

  // Anti-flicker: skip the innerHTML rewrite when the trend data is identical
  // to what's already painted. This render runs on a SEPARATE async path
  // (getTrackedSeries hits storage/background), so without this guard it
  // repaints the card every time it resolves — and since the card sits directly
  // above the Gantt, that repaint reflows everything below it (the flicker from
  // the Sentry trend down to the end of the Gantt). `force` bypasses the guard
  // for legend-toggle re-renders that change visibility without changing data.
  let fp;
  try { fp = JSON.stringify(series); } catch { fp = String(Date.now()); }
  if (!force && fp === _lastTrendFingerprint && card.innerHTML) {
    card.style.display = '';
    return;
  }
  _lastTrendFingerprint = fp;

  if (series.length === 0) {
    // No views tracked — setup prompt
    card.style.display = '';
    card.innerHTML = `
      <div style="padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;text-transform:uppercase;margin-bottom:6px;">SENTRY TREND</div>
        <div style="font-size:12px;color:var(--text-muted);">
          Track one or more Sentry views to see their daily issue-count trends here.<br/>
          <span style="color:var(--primary,#6366f1);">Settings → Sentry views → click Track on the views you want.</span>
        </div>
      </div>`;
    return;
  }

  card.style.display = '';
  card.innerHTML = buildMultiTrendCardHTML(series);

  wireTrendExport(card, series);
  wireTrendLegend(card, series);
  wireTrendHover(card);
}

/** Wire hover tooltips on chart points — shows "Label · date · value". */
function wireTrendHover(card) {
  const tip = card.querySelector('.trend-tooltip');
  if (!tip) return;
  card.querySelectorAll('.trend-point').forEach(pt => {
    pt.addEventListener('mouseenter', () => {
      tip.textContent = pt.getAttribute('data-info') || '';
      tip.style.display = 'block';
      const cardRect = card.getBoundingClientRect();
      const ptRect   = pt.getBoundingClientRect();
      const x = ptRect.left + ptRect.width / 2 - cardRect.left;
      const y = ptRect.top - cardRect.top;
      // Clamp horizontally so the (translate(-50%)) tooltip never overflows the
      // card — the rightmost "today" point used to clip at the panel border.
      const half = tip.offsetWidth / 2;
      const clampedX = Math.max(half + 4, Math.min(x, cardRect.width - half - 4));
      tip.style.left = `${clampedX}px`;
      tip.style.top  = `${Math.max(y - 4, 12)}px`;
    });
    pt.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });
}

/** Wire Jira-style hover tooltips on the burndown's remaining-work points. */
function wireBurndownHover() {
  const wrap = document.querySelector('.bd-wrap');
  if (!wrap) return;
  const tip = wrap.querySelector('.bd-tooltip');
  if (!tip) return;
  wrap.querySelectorAll('.bd-point').forEach(pt => {
    pt.addEventListener('mouseenter', () => {
      const date = pt.getAttribute('data-date') || '';
      const change = pt.getAttribute('data-change') || '';
      tip.innerHTML = `<div style="font-weight:600;">${date}</div><div style="color:var(--text-muted);">${change}</div>`;
      tip.style.display = 'block';
      const wrapRect = wrap.getBoundingClientRect();
      const ptRect = pt.getBoundingClientRect();
      const x = ptRect.left + ptRect.width / 2 - wrapRect.left;
      const y = ptRect.top - wrapRect.top;
      tip.style.left = `${x}px`;
      // Flip below the point when it sits near the top so the tooltip never
      // overflows above the card.
      if (y < 46) {
        tip.style.top = `${y + ptRect.height + 4}px`;
        tip.style.transform = 'translate(-50%, 0)';
      } else {
        tip.style.top = `${y - 4}px`;
        tip.style.transform = 'translate(-50%, -100%)';
      }
    });
    pt.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });
}

/** Parse the numeric Sentry view id out of a saved view URL. */
function _viewIdFromUrl(url) {
  try {
    return url ? ((new URL(url)).pathname.match(/\/issues\/views\/(\d+)/)?.[1] || null) : null;
  } catch { return null; }
}

/**
 * Build the list of tracked series: one entry per tracked view, each with its
 * stable color (by position in the views list), label, and last-30-day samples.
 */
async function getTrackedSeries() {
  // Demo mode: serve the mock samples directly (real samples live in
  // chrome.storage.sync and accumulate over days — none exist for demo views).
  if (state.mockMode && state.sentryTrendSamples) {
    return Object.entries(state.sentryTrendSamples).map(([viewId, samples], i) => ({
      viewId,
      label: state.sentryViews?.find(v => v.viewId === viewId)?.label || `View ${viewId}`,
      color: colorForIndex(i),
      samples: (samples || []).slice(-30),
    }));
  }

  const sentry = state.settings?.sentry || {};
  const trackedIds = Array.isArray(sentry.trackedViewIds)
    ? sentry.trackedViewIds
    : (sentry.trackedViewId ? [sentry.trackedViewId] : []);
  const views = sentry.views || [];

  const series = [];
  for (const viewId of trackedIds) {
    const idx   = views.findIndex(v => _viewIdFromUrl(v.url) === viewId);
    const label = (idx >= 0 ? views[idx].label : '') || `View ${viewId}`;
    const color = colorForIndex(idx >= 0 ? idx : series.length);
    let samples = [];
    try { samples = await getTrendSamples(viewId); } catch { samples = []; }
    series.push({ viewId, label, color, samples: samples.slice(-30) });
  }
  return series;
}

/** Wire the export dropdown (⬇ → per-view + All). */
function wireTrendExport(card, series) {
  const btn  = card.querySelector('.sentry-export-btn');
  const menu = card.querySelector('.sentry-export-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.style.display !== 'none';
    if (open) { menu.style.display = 'none'; return; }
    menu.style.display = 'block';
    setTimeout(() => {
      const close = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== btn) {
          menu.style.display = 'none';
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  });

  card.querySelectorAll('.sentry-export-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = 'none';
      const vid = item.dataset.viewId;
      if (vid === '__all__') {
        exportSentryTrend(series, 'all');
      } else {
        const s = series.find(x => x.viewId === vid);
        if (s) exportSentryTrend([s], 'single');
      }
    });
  });
}

/** Wire legend entries — click to toggle a line's visibility. */
function wireTrendLegend(card, series) {
  card.querySelectorAll('.trend-legend-item').forEach(item => {
    item.addEventListener('click', () => {
      const vid = item.dataset.viewId;
      if (_hiddenTrendViews.has(vid)) _hiddenTrendViews.delete(vid);
      else _hiddenTrendViews.add(vid);
      renderSentryTrend(true); // force — legend visibility changed, not data
    });
  });
}

// ── Sentry Trend Export ───────────────────────────────────────────────────
/**
 * Export tracked Sentry trend data.
 *   - mode 'single': seriesArr has one entry → 1 JSON file + that view's PDF
 *   - mode 'all':    seriesArr has all entries → one JSON file per view (batch)
 *                    + one combined multi-line PDF
 * Each JSON file is strictly one-view (same format the importer expects), so
 * any export can be re-imported independently.
 */
async function exportSentryTrend(seriesArr, mode) {
  const now     = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  // ① Download one JSON file per series (staggered so the browser doesn't
  //    drop rapid-fire downloads).
  for (const s of seriesArr) {
    const safeName = (s.label || s.viewId).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    const payload = {
      version:    '1',
      exportedAt: now.toISOString(),
      viewId:     s.viewId,
      viewLabel:  s.label,
      samples:    [...s.samples].sort((a, b) => (a.day < b.day ? -1 : 1)),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `EM-Dashboard-Sentry-${safeName}-${dateStr}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (seriesArr.length > 1) await new Promise(r => setTimeout(r, 350));
  }

  // ② Open the print page. Single view → that view; all → combined multi-line.
  try {
    const printSeries = seriesArr.map(s => ({
      viewId:    s.viewId,
      viewLabel: s.label,
      color:     s.color,
      samples:   [...s.samples].sort((a, b) => (a.day < b.day ? -1 : 1)),
    }));
    const encoded = encodeURIComponent(JSON.stringify({
      version:    '2',
      exportedAt: now.toISOString(),
      mode:       mode === 'all' ? 'multi' : 'single',
      series:     printSeries,
    }));
    chrome.tabs.create({ url: chrome.runtime.getURL('print.html') + '?data=' + encoded });
  } catch (e) {
    console.warn('[popup] exportSentryTrend: could not open print page:', e.message);
  }
}

/**
 * Build the multi-line Sentry trend card.
 * Shared X (union of date ranges) and Y (max across visible series) axes,
 * one colored polyline per visible series, a clickable legend, and the
 * export dropdown.
 */
function buildMultiTrendCardHTML(series) {
  const visible = series.filter(s => !_hiddenTrendViews.has(s.viewId));
  const withData = visible.filter(s => s.samples.length > 0);

  // ── Export dropdown menu (always available) ───────────────────────────
  const exportItems =
    series.map(s =>
      `<div class="sentry-export-item" data-view-id="${escapeHtml(s.viewId)}"
        style="padding:6px 10px;font-size:11px;color:var(--text);cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px;">
        <span style="width:8px;height:8px;border-radius:2px;background:${s.color};flex-shrink:0;"></span>
        ${escapeHtml(s.label)}
      </div>`
    ).join('') +
    (series.length > 1
      ? `<div class="sentry-export-item" data-view-id="__all__"
          style="padding:6px 10px;font-size:11px;color:var(--text);cursor:pointer;white-space:nowrap;border-top:1px solid var(--border,rgba(255,255,255,0.1));font-weight:600;">
          All views (separate files)
        </div>`
      : '');

  const exportControl = `
    <div style="position:relative;flex-shrink:0;">
      <button class="sentry-export-btn" title="Export data & chart" aria-label="Export"
        style="background:none;border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:4px;
               padding:2px 6px;color:var(--text-muted);font-size:10px;cursor:pointer;line-height:1.4;">⬇</button>
      <div class="sentry-export-menu"
        style="display:none;position:absolute;right:0;top:calc(100% + 4px);z-index:99;
               background:var(--surface);border:1px solid var(--border);border-radius:8px;
               box-shadow:0 8px 24px rgba(0,0,0,0.4);min-width:160px;overflow:hidden;">
        <div style="padding:5px 10px;font-size:9px;font-weight:600;color:var(--text-muted);
                    letter-spacing:0.3px;text-transform:uppercase;border-bottom:1px solid var(--border,rgba(255,255,255,0.08));">Export</div>
        ${exportItems}
      </div>
    </div>`;

  // ── Legend (all series; hidden ones greyed + struck through) ──────────
  const legend = series.map(s => {
    const hidden = _hiddenTrendViews.has(s.viewId);
    const last   = s.samples[s.samples.length - 1];
    const prev   = s.samples[s.samples.length - 2];
    const latest = last ? last.count : '–';
    const delta  = (last && prev) ? last.count - prev.count : 0;
    const dStr   = !last ? '' : delta > 0 ? `↑${delta}` : delta < 0 ? `↓${Math.abs(delta)}` : '=';
    const dCol   = delta > 0 ? '#f97316' : delta < 0 ? '#22c55e' : 'var(--text-muted)';
    return `<div class="trend-legend-item" data-view-id="${escapeHtml(s.viewId)}"
        title="Click to ${hidden ? 'show' : 'hide'} this line"
        style="display:flex;align-items:center;gap:5px;cursor:pointer;opacity:${hidden ? '0.4' : '1'};">
        <span style="width:8px;height:8px;border-radius:2px;background:${s.color};flex-shrink:0;"></span>
        <span style="font-size:10px;color:var(--text);${hidden ? 'text-decoration:line-through;' : ''}">${escapeHtml(s.label)}</span>
        <span style="font-size:10px;font-weight:600;color:var(--text);">${latest}</span>
        ${dStr ? `<span style="font-size:9px;font-weight:700;color:${dCol};">${dStr}</span>` : ''}
      </div>`;
  }).join('');

  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;
                   text-transform:uppercase;">Sentry Trend · last 30 days</span>
      ${exportControl}
    </div>`;

  const legendRow = `
    <div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:8px;">${legend}</div>`;

  const cardOpen  = `<div class="sentry-trend-wrap" style="position:relative;padding:10px 12px;background:var(--surface,#11131c);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;"><div class="trend-tooltip" style="display:none;position:absolute;z-index:50;pointer-events:none;transform:translate(-50%,-100%);background:var(--surface-raised,#1f2937);border:1px solid var(--border,rgba(255,255,255,0.15));border-radius:5px;padding:3px 7px;font-size:10px;color:var(--text);white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>`;
  const cardClose = `</div>`;

  // ── No visible data → show header + legend + prompt ───────────────────
  if (withData.length === 0) {
    return `${cardOpen}${header}
      <div style="font-size:12px;color:var(--text-muted);padding:6px 0;">
        Open the panel daily to build trend history${visible.length < series.length ? ' (some lines hidden)' : ''}.
      </div>
      ${legendRow}${cardClose}`;
  }

  // ── Shared axes ───────────────────────────────────────────────────────
  const allDays   = [];
  const allCounts = [];
  withData.forEach(s => s.samples.forEach(p => { allDays.push(p.day); allCounts.push(p.count); }));

  const allMs   = allDays.map(d => new Date(d).getTime());
  const firstMs = Math.min(...allMs);
  const lastMs  = Math.max(...allMs);
  const totalMs = lastMs - firstMs || 1;

  const minVal  = Math.min(...allCounts);
  const maxVal  = Math.max(...allCounts);
  const yPad    = Math.max(Math.ceil(maxVal * 0.15), 3);
  const yMin    = Math.max(0, minVal - yPad);
  const yMax    = maxVal + yPad;
  const yRange  = yMax - yMin || 1;

  const W = 280, H = 70, PAD_L = 4, PAD_R = 4, PAD_T = 8, PAD_B = 20;
  const PW = W - PAD_L - PAD_R, PH = H - PAD_T - PAD_B;
  const pxD = (day) => PAD_L + ((new Date(day).getTime() - firstMs) / totalMs) * PW;
  const py  = (v)   => PAD_T + PH - ((v - yMin) / yRange) * PH;

  const _MS_PER_DAY = 86400000;
  const showGaps = withData.length === 1; // gap shading only when single line (keeps multi-line readable)

  // Date formatter (used for tooltips and x-axis labels): "2 Jun"
  const _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const _fmtDay = d => `${parseInt(d.slice(8))} ${_MONTHS[parseInt(d.slice(5,7))-1]}`;

  let svgParts = '';
  for (const s of withData) {
    const pts = s.samples;

    // Segment by gaps (>1 day) so we never draw a fake line across missing days
    const segs = [];
    let streak = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const diff = Math.round((new Date(pts[i].day) - new Date(pts[i-1].day)) / _MS_PER_DAY);
      if (diff > 1) {
        segs.push({ type: 'data', points: [...streak] });
        segs.push({ type: 'gap', start: pts[i-1].day, end: pts[i].day, days: diff - 1 });
        streak = [pts[i]];
      } else {
        streak.push(pts[i]);
      }
    }
    segs.push({ type: 'data', points: streak });

    if (showGaps) {
      for (const seg of segs) {
        if (seg.type !== 'gap') continue;
        const gx1 = pxD(seg.start), gx2 = pxD(seg.end), gw = Math.max(gx2 - gx1, 2);
        svgParts += `<rect x="${gx1.toFixed(1)}" y="${PAD_T}" width="${gw.toFixed(1)}" height="${PH}" fill="rgba(148,163,184,0.10)" rx="2"/>`;
        if (gw > 32) {
          const mx = ((gx1 + gx2) / 2).toFixed(1), my = (PAD_T + PH / 2).toFixed(1);
          svgParts += `<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="central" fill="var(--text-muted)" font-size="7.5" font-family="system-ui" opacity="0.75">no data · ${seg.days}d</text>`;
        }
      }
    }

    for (const seg of segs) {
      if (seg.type !== 'data' || seg.points.length === 0) continue;
      const segPts = seg.points.map(p => `${pxD(p.day).toFixed(1)},${py(p.count).toFixed(1)}`).join(' ');
      svgParts += `<polyline points="${segPts}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      // Small visible dot on every data point (like the print view), plus a
      // larger transparent "hit" circle that's easy to hover and carries the
      // date/value tooltip text.
      for (const p of seg.points) {
        const cx = pxD(p.day).toFixed(1), cy = py(p.count).toFixed(1);
        svgParts += `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${s.color}"/>`;
        svgParts += `<circle class="trend-point" cx="${cx}" cy="${cy}" r="5" data-info="${escapeHtml(s.label)} · ${_fmtDay(p.day)} · ${p.count}"/>`;
      }
    }

    // Slightly larger dot on the latest reading so "today" stands out
    const last = pts[pts.length - 1];
    svgParts += `<circle cx="${pxD(last.day).toFixed(1)}" cy="${py(last.count).toFixed(1)}" r="2.2" fill="${s.color}"/>`;
  }

  // X-axis labels: first date (left), today (right), and a mid-span date when
  // the range is more than 2 days so the timeline has a reference point.
  const firstDay = new Date(firstMs).toISOString().slice(0, 10);
  let xLabels = `<text x="${PAD_L}" y="${H-4}" text-anchor="start" fill="var(--text-muted)" font-size="8.5" font-family="system-ui">${_fmtDay(firstDay)}</text>`;
  const spanDays = Math.round((lastMs - firstMs) / _MS_PER_DAY);
  if (spanDays > 2) {
    const midDay = new Date((firstMs + lastMs) / 2).toISOString().slice(0, 10);
    xLabels += `<text x="${(PAD_L + PW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" fill="var(--text-muted)" font-size="8.5" font-family="system-ui">${_fmtDay(midDay)}</text>`;
  }
  xLabels    += `<text x="${(PAD_L+PW).toFixed(1)}" y="${H-4}" text-anchor="end" fill="var(--text-muted)" font-size="8.5" font-family="system-ui">today</text>`;

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;">
    ${svgParts}
    ${xLabels}
  </svg>`;

  return `${cardOpen}${header}${svg}${legendRow}${cardClose}`;
}

// ── Inline SVG chart builders ────────────────────────────────────────────
// These build chart markup as strings (pure functions). Tracked for extraction
// into src/render/ as part of the stability work (popup.js CAN import src/ —
// it already imports gantt, metrics, alerts, milestones, etc.).

// buildBurndownSVG + _niceStep + _C extracted to src/render/burndown-svg.js (S-3, v2.9.1)

function buildTimesheetSVG(members, capacityHours = 0) {
  if (!members || members.length === 0) return '';
  
  // Collect all project keys across all members
  const allProjects = [...new Set(members.flatMap(m => Object.keys(m.byProject || {})))].sort();
  const colorMap = assignProjectColors(allProjects);
  
  const W       = 300;
  const NAME_W  = 100;
  const TOTAL_W = 30;            // reserved space on the right for the "Nh" total label
  const PW      = W - NAME_W - 8 - TOTAL_W;
  const BAR_H   = 9;
  const ROW_H   = 20;
  const PAD_TOP = 8;
  const PAD_BOT = 28;  // room for legend
  const H = PAD_TOP + members.length * ROW_H + PAD_BOT;
  
  // Scale so the longest bar OR the capacity line (whichever is larger) fits.
  const maxLogged = Math.max(...members.map(m => m.total || 0), 0.1);
  const maxTotal  = capacityHours > 0 ? Math.max(maxLogged, capacityHours) : maxLogged;
  const bw = h => Math.max(1, (h / maxTotal) * PW);
  const baseX = NAME_W;
  
  let rows = '';
  members.forEach((m, i) => {
    const y1 = PAD_TOP + i * ROW_H;
    const over = capacityHours > 0 && (m.total || 0) > capacityHours;
    const nameRaw = m.name || '';
    const displayName = (over ? '⚠ ' : '') + (nameRaw.length > 12 ? nameRaw.slice(0, 11) + '…' : nameRaw);
    const nameColor = over ? '#f59e0b' : 'var(--text)';
    
    // Stacked segments left to right
    let segX = baseX;
    const segments = Object.entries(m.byProject || {})
      .sort((a, b) => b[1] - a[1]); // biggest project first
    
    const segSvg = segments.map(([pk, hrs]) => {
      const w = bw(hrs);
      const color = colorMap[pk] || '#94a3b8';
      // Data attributes drive an immediate, styled JS tooltip (native SVG
      // <title> is slow and easy to miss). Keep <title> too as a fallback.
      const seg = `<rect class="ts-seg" data-ts-name="${escapeHtml(m.name || '')}" data-ts-proj="${escapeHtml(pk)}" data-ts-hrs="${hrs}" `
                + `x="${segX.toFixed(1)}" y="${y1}" width="${w.toFixed(1)}" height="${BAR_H}" fill="${color}" rx="2" style="cursor:pointer;">`
                + `<title>${escapeHtml(m.name || '')} — ${escapeHtml(pk)}: ${hrs}h</title></rect>`;
      segX += w;
      return seg;
    }).join('');
    
    const totalColor = over ? '#f59e0b' : 'var(--text)';
    rows += `
      <text x="${NAME_W - 5}" y="${y1 + BAR_H/2 + 1}" text-anchor="end" dominant-baseline="central" fill="${nameColor}" font-size="9.5" font-family="system-ui">${displayName}</text>
      ${segSvg}
      <text x="${(segX + 3).toFixed(1)}" y="${y1 + BAR_H/2 + 1}" dominant-baseline="central" fill="${totalColor}" font-size="9" font-family="system-ui" font-weight="${over ? '600' : 'normal'}">${m.total}h</text>`;
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
  
  // Capacity reference line — "who's over capacity?" — dashed amber vertical at
  // expected hours-so-far; bars/names past it are flagged ⚠ above.
  let capLine = '';
  if (capacityHours > 0) {
    const cxNum = baseX + (capacityHours / maxTotal) * PW;
    const cx = cxNum.toFixed(1);
    // Clamp the label's x and anchor so it never clips at the chart edge when
    // the panels are side by side (the line can sit near the right border).
    const nearRight = cxNum > baseX + PW * 0.75;
    const labelAnchor = nearRight ? 'end' : 'middle';
    const labelX = nearRight ? Math.min(cxNum + 2, W - 2) : cxNum;
    capLine = `<line x1="${cx}" y1="${PAD_TOP - 1}" x2="${cx}" y2="${H - PAD_BOT}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="3,2"/>`
            + `<text x="${labelX.toFixed(1)}" y="${PAD_TOP - 4}" text-anchor="${labelAnchor}" fill="#f59e0b" font-size="10" font-weight="600" font-family="system-ui">cap ${capacityHours}h</text>`;
  }
  
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
  
  return `<div class="ts-wrap" style="position:relative;">
    <div class="ts-tooltip" style="display:none;position:absolute;z-index:20;pointer-events:none;
      background:var(--surface-raised,#1f2937);border:1px solid var(--border,rgba(255,255,255,0.12));
      border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text,#e2e8f0);white-space:nowrap;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);transform:translate(-50%,-100%);"></div>
    <svg viewBox="0 -8 ${W} ${H + 12}" width="100%" xmlns="http://www.w3.org/2000/svg">
    ${grid}${ax}${capLine}${rows}${legendSvg}</svg>
  </div>`;
}

/** Wire immediate styled hover tooltips on Time Logged bar segments. */
function wireTimesheetHover() {
  document.querySelectorAll('.ts-wrap').forEach(wrap => {
    const tip = wrap.querySelector('.ts-tooltip');
    if (!tip) return;
    wrap.querySelectorAll('.ts-seg').forEach(seg => {
      seg.addEventListener('mouseenter', () => {
        const name = seg.getAttribute('data-ts-name') || '';
        const proj = seg.getAttribute('data-ts-proj') || '';
        const hrs  = seg.getAttribute('data-ts-hrs') || '';
        tip.innerHTML = `<span style="font-weight:600;">${proj}</span> · ${hrs}h`
          + (name ? `<div style="color:var(--text-muted);font-size:10px;">${name}</div>` : '');
        tip.style.display = 'block';
        const wrapRect = wrap.getBoundingClientRect();
        const segRect  = seg.getBoundingClientRect();
        const x = segRect.left + segRect.width / 2 - wrapRect.left;
        const y = segRect.top - wrapRect.top;
        // Clamp within the card so edge segments don't clip
        const half = tip.offsetWidth / 2;
        const clampedX = Math.max(half + 4, Math.min(x, wrapRect.width - half - 4));
        tip.style.left = `${clampedX}px`;
        tip.style.top  = `${Math.max(y - 4, 14)}px`;
      });
      seg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    });
  });
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
  
  document.getElementById('keep-sprint-analytics')?.addEventListener('click', async () => {
    banner.remove();
    // Re-read storage and re-render so the new sprint name and data are shown
    // immediately. Without this, the stale Sprint 64 name stays until the
    // next partial-update message arrives from the background.
    await loadData();
    renderCurrentScreen();
  });
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

// Priority dot built from the shared colour map (adds "urgent", which the old
// local map was missing). Title-cases the label for the tooltip.
function priorityDot(p) {
  const key = (p || 'medium').toLowerCase();
  const color = PRIORITY_DOT_COLOR[key] || PRIORITY_DOT_COLOR.medium;
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return `<span title="${label}" style="color:${color};font-size:9px;flex-shrink:0;">●</span>`;
}
function ticketStatusColor(s){ return statusColor(s); }
function ticketStatusIcon(cat){ return statusCategoryIcon(cat); }

/** Render one Jira ticket row — clickable, with priority dot */
/**
 * Consistent empty-state markup (stability v2.8.7).
 * @param {string} msg     one-line "nothing to show" message
 * @param {string} [icon]  emoji/glyph
 * @param {string} [action] optional muted action hint
 */
function emptyState(msg, icon = '—', action = '') {
  return `<div class="empty-state">
    <div class="empty-icon">${icon}</div>
    <div class="empty-msg">${escapeHtml(msg)}</div>
    ${action ? `<div class="empty-action">${escapeHtml(action)}</div>` : ''}
  </div>`;
}

function renderTicketRow(story, jiraBaseUrl, extraMeta = '') {
  const url = jiraBaseUrl ? `${jiraBaseUrl.replace(/\/$/,'')}/browse/${story.key}` : null;
  const duePart = story.dueDate ? formatDueDate(story.dueDate, story.statusCategory) : '';
  return `
    <div class="ticket-row" ${url ? `data-url="${escapeHtml(url)}"` : ''} style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,rgba(255,255,255,0.05));${url?'cursor:pointer;':''}">
      ${priorityDot(story.priority)}
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(story.summary)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">
          ${escapeHtml(story.key)}${story.assignee?` · ${escapeHtml(story.assignee)}`:''}${story.points>0?` · ${story.points}pt`:''}${duePart?` · ${duePart}`:''}${extraMeta}
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
  // Demo mode toggled from settings page — apply immediately without reopen
  if (message.type === 'mock-mode-changed') {
    state.mockMode = !!message.enabled;
    if (state.mockMode) {
      injectMockState();
    } else {
      const banner = document.getElementById('mock-mode-banner');
      if (banner) banner.style.display = 'none';
      boot();
    }
    return;
  }
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
      // Coalesced: jira + sentry updates arriving back-to-back now produce
      // ONE rebuild instead of one each (the flicker on panel open).
      scheduleCurrentScreenRender();
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
