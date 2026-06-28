/**
 * settings.js
 * Settings page controller
 * Manages Jira + Sentry credentials, squad selection, theme
 */

import { parseSentryUrl } from './src/parsers.js';
import { parseMilestoneLines } from './src/milestones.js';
import { runMigrations } from './src/migrations.js';
import { importTrendSamples } from './src/sentry-trend.js';
import { colorForIndex } from './src/trend-colors.js';
import { getToken, getCachedToken } from './src/gcal-auth.js';

// ── Sentry view row rendering ──────────────────────────────────────────────
// ── Alert rule metadata (UI only — source of truth for labels/defaults) ──
const ALERT_RULES = [
  { id: 'sprint_goal_at_risk', label: 'Sprint goal at risk',  notifyDefault: true,
    desc: 'Working-day burndown projects a shortfall vs the committed baseline.' },
  { id: 'scope_creep',         label: 'Scope creep',          notifyDefault: true,
    desc: 'Points added after sprint start exceed the threshold.',
    thresholds: [{ key: 'thresholdPct', label: 'Threshold', default: 10, min: 5, max: 50, step: 5, unit: '%' }] },
  { id: 'stalled_burndown',    label: 'Stalled burndown',     notifyDefault: false,
    desc: 'No points completed for the given number of consecutive working days.',
    thresholds: [{ key: 'stalledDays', label: 'Days', default: 2, min: 1, max: 7, step: 1, unit: '' }] },
  { id: 'due_date_risk',       label: 'Due date risk',        notifyDefault: true,
    desc: 'Open pointed tickets are due by sprint end.' },
  { id: 'unassigned_work',     label: 'Unassigned work',      notifyDefault: false,
    desc: 'Open pointed tickets have no assignee.' },
  { id: 'reopened_tickets',    label: 'Reopened tickets',     notifyDefault: false,
    desc: 'A ticket that reached Done moved back to open (rework indicator).' },
  { id: 'sentry_trend_spike',  label: 'Sentry trend spike',   notifyDefault: true,
    desc: 'Day-over-day Sentry issue count spikes beyond the delta or % threshold.',
    thresholds: [
      { key: 'spikeDelta', label: 'Min Δ',  default: 10, min: 5, max: 100, step: 5, unit: '' },
      { key: 'spikePct',   label: 'Min %',  default: 25, min: 5, max: 100, step: 5, unit: '%' },
    ] },
  { id: 'velocity_drop',       label: 'Velocity drop',        notifyDefault: false,
    desc: 'Velocity drops >15% for 2 consecutive sprints. Needs ≥3 sprints of history.' },
  { id: 'support_sla_breach',  label: 'Support SLA breach',   notifyDefault: true,
    desc: 'A support ticket exceeds the SLA. Needs a support board configured.' },
];

const DEFAULT_ALERT_RULES = {
  sprint_goal_at_risk: { enabled: true, notifyDesktop: true  },
  scope_creep:         { enabled: true, notifyDesktop: true,  thresholdPct: 10 },
  stalled_burndown:    { enabled: true, notifyDesktop: false, stalledDays:   2  },
  due_date_risk:       { enabled: true, notifyDesktop: true  },
  unassigned_work:     { enabled: true, notifyDesktop: false },
  reopened_tickets:    { enabled: true, notifyDesktop: false },
  sentry_trend_spike:  { enabled: true, notifyDesktop: true,  spikeDelta: 10, spikePct: 25 },
  velocity_drop:       { enabled: true, notifyDesktop: false },
  support_sla_breach:  { enabled: true, notifyDesktop: true  },
};

// Storage shape: settings.sentry.views = [{ label: string, url: string }, ...]
// Each row in the UI has: label input, URL input, ×, and a preview line below
// showing what we parsed from the URL.

// ── Alert settings UI ─────────────────────────────────────────────────────
function renderAlertSettings(settings) {
  const list = document.getElementById('alert-rules-list');
  if (!list) return;

  const current = settings.alerts?.rules || {};

  list.innerHTML = ALERT_RULES.map(rule => {
    const conf    = current[rule.id] || {};
    const enabled = conf.enabled !== false;
    const notify  = conf.notifyDesktop !== false;

    const thresholdHtml = (rule.thresholds || []).map(t => {
      const val = conf[t.key] ?? t.default;
      return `<label class="alert-threshold-label">${t.label}
        <input type="number" class="alert-threshold-input"
          data-rule="${rule.id}" data-key="${t.key}"
          value="${val}" min="${t.min}" max="${t.max}" step="${t.step}"
          ${enabled ? '' : 'disabled'}>
        ${t.unit ? `<span class="alert-unit">${t.unit}</span>` : ''}
      </label>`;
    }).join('');

    return `<div class="alert-rule-row${enabled ? '' : ' rule-disabled'}" data-rule="${rule.id}">
      <label class="alert-toggle" title="${enabled ? 'Disable rule' : 'Enable rule'}">
        <input type="checkbox" class="alert-enabled-cb" data-rule="${rule.id}"${enabled ? ' checked' : ''}>
        <span class="alert-toggle-track"></span>
      </label>
      <div class="alert-rule-info">
        <span class="alert-rule-label">${rule.label}</span>
        <span class="alert-rule-desc">${rule.desc}</span>
      </div>
      <div class="alert-rule-controls">
        ${thresholdHtml}
        <button class="alert-notify-btn${notify ? ' active' : ''}"
          data-rule="${rule.id}" title="${notify ? 'Desktop notification ON — click to turn off' : 'Desktop notification OFF — click to turn on'}"
          ${enabled ? '' : 'disabled'}>🔔</button>
      </div>
    </div>`;
  }).join('');

  // ── Enable/disable toggle ───────────────────────────────────────────
  list.querySelectorAll('.alert-enabled-cb').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.rule;
      settings.alerts = settings.alerts || {};
      settings.alerts.rules = settings.alerts.rules || {};
      settings.alerts.rules[id] = {
        ...(DEFAULT_ALERT_RULES[id] || {}),
        ...(settings.alerts.rules[id] || {}),
        enabled: cb.checked,
      };
      await chrome.storage.local.set({ settings });
      renderAlertSettings(settings);
    });
  });

  // ── 🔔 Desktop notification toggle ─────────────────────────────────
  list.querySelectorAll('.alert-notify-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.rule;
      settings.alerts = settings.alerts || {};
      settings.alerts.rules = settings.alerts.rules || {};
      const cur = settings.alerts.rules[id] || {};
      const wasOn = cur.notifyDesktop !== false;
      settings.alerts.rules[id] = {
        ...(DEFAULT_ALERT_RULES[id] || {}),
        ...cur,
        notifyDesktop: !wasOn,
      };
      await chrome.storage.local.set({ settings });
      renderAlertSettings(settings);
    });
  });

  // ── Threshold inputs (auto-save on blur/enter) ──────────────────────
  list.querySelectorAll('.alert-threshold-input').forEach(inp => {
    const save = async () => {
      const id  = inp.dataset.rule;
      const key = inp.dataset.key;
      const val = parseInt(inp.value, 10);
      if (isNaN(val)) return;
      const meta = ALERT_RULES.find(r => r.id === id);
      const t    = meta?.thresholds?.find(x => x.key === key);
      const clamped = t ? Math.min(t.max, Math.max(t.min, val)) : val;
      inp.value = clamped;
      settings.alerts = settings.alerts || {};
      settings.alerts.rules = settings.alerts.rules || {};
      settings.alerts.rules[id] = {
        ...(DEFAULT_ALERT_RULES[id] || {}),
        ...(settings.alerts.rules[id] || {}),
        [key]: clamped,
      };
      await chrome.storage.local.set({ settings });
    };
    inp.addEventListener('change', save);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  });
}

function renderSentryViewRows(views, trackedViewIds) {
  const list = document.getElementById('sentry-views-list');
  if (!list) return;
  list.innerHTML = '';
  const tracked = Array.isArray(trackedViewIds) ? trackedViewIds : [];
  const rows = views.length > 0 ? views : [{ label: '', url: '' }];
  // colorIndex is the view's position in the saved views list, so the color
  // is stable per view and matches the chart legend.
  rows.forEach((view, idx) => list.appendChild(createSentryViewRow(view, tracked, idx)));
}

function createSentryViewRow(view, trackedViewIds, colorIndex) {
  const row = document.createElement('div');
  row.className = 'sentry-view-row';
  row.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px;background:var(--surface,#1a1b23);border:1px solid var(--border,rgba(255,255,255,0.08));border-radius:6px;';
  
  const parsed = view.url ? parseSentryUrl(view.url) : null;
  const parsedViewId = parsed?.viewId || '';
  const tracked = Array.isArray(trackedViewIds) ? trackedViewIds : [];
  const isTracked = !!(parsedViewId && tracked.includes(parsedViewId));
  const color = colorForIndex(colorIndex);
  
  row.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;">
      <span class="sv-swatch" title="Chart color for this view"
        style="width:10px;height:10px;border-radius:2px;flex-shrink:0;
               background:${color};opacity:${isTracked ? '1' : '0.25'};"></span>
      <input type="text" class="sv-label" placeholder="Label (e.g. HRM Issues)"
        value="${escapeAttr(view.label || '')}"
        style="width:110px;flex-shrink:0;padding:5px 8px;background:var(--surface-raised,#1f2937);
               border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:4px;
               color:var(--text);font-size:12px;"/>
      <input type="url" class="sv-url" placeholder="https://zeal.sentry.io/issues/views/..."
        value="${escapeAttr(view.url || '')}"
        style="flex:1;min-width:0;padding:5px 8px;background:var(--surface-raised,#1f2937);
               border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:4px;
               color:var(--text);font-size:11px;font-family:monospace;"/>
      <button type="button" class="sv-track"
        data-view-id="${escapeAttr(parsedViewId)}"
        data-color="${color}"
        title="Track this view's daily issue-count trend in the dashboard. Multiple views can be tracked — each draws its own line on the chart."
        style="background:none;border:1px solid ${isTracked ? color : 'var(--border,rgba(255,255,255,0.1))'};
               border-radius:4px;padding:3px 8px;
               color:${isTracked ? color : 'var(--text-muted)'};
               font-size:11px;cursor:pointer;white-space:nowrap;flex-shrink:0;
               font-weight:${isTracked ? '600' : '400'};">
        ${isTracked ? '● Tracking' : 'Track'}
      </button>
      <button type="button" class="sv-remove" title="Remove this view"
        style="background:none;border:none;color:var(--text-muted);cursor:pointer;
               font-size:16px;line-height:1;padding:4px 8px;flex-shrink:0;">×</button>
    </div>
    <div class="sv-preview" style="font-size:10px;color:var(--text-muted);padding-left:4px;min-height:14px;"></div>
  `;
  
  const urlInput  = row.querySelector('.sv-url');
  const previewEl = row.querySelector('.sv-preview');
  const trackBtn  = row.querySelector('.sv-track');
  const removeBtn = row.querySelector('.sv-remove');
  const swatch    = row.querySelector('.sv-swatch');
  
  updateRowPreview(urlInput, previewEl, trackBtn);
  urlInput.addEventListener('input', () => updateRowPreview(urlInput, previewEl, trackBtn));
  
  trackBtn.addEventListener('click', async () => {
    const active = trackBtn.textContent.includes('Tracking');
    const viewId = trackBtn.dataset.viewId || null;
    const btnColor = trackBtn.dataset.color || 'var(--primary,#6366f1)';

    // Multi-select: toggle THIS view only; leave others untouched.
    if (active) {
      trackBtn.textContent = 'Track';
      trackBtn.style.color = 'var(--text-muted)';
      trackBtn.style.borderColor = 'var(--border,rgba(255,255,255,0.1))';
      trackBtn.style.fontWeight = '400';
      if (swatch) swatch.style.opacity = '0.25';
    } else {
      trackBtn.textContent = '● Tracking';
      trackBtn.style.color = btnColor;
      trackBtn.style.borderColor = btnColor;
      trackBtn.style.fontWeight = '600';
      if (swatch) swatch.style.opacity = '1';
    }

    // AUTO-SAVE the trackedViewIds array immediately (no Save button needed).
    if (!viewId) return;
    try {
      const r = await chrome.storage.local.get(['settings']);
      const s = r.settings || {};
      s.sentry = s.sentry || {};
      const set = new Set(Array.isArray(s.sentry.trackedViewIds) ? s.sentry.trackedViewIds : []);
      if (active) set.delete(viewId);   // untrack — history is kept in storage
      else        set.add(viewId);      // track
      s.sentry.trackedViewIds = [...set];
      await chrome.storage.local.set({ settings: s });

      if (!active) {
        trackBtn.textContent = '✓ Saved';
        setTimeout(() => {
          if (trackBtn.textContent === '\u2713 Saved') trackBtn.textContent = '\u25cf Tracking';
        }, 1400);
      }
    } catch (e) {
      console.warn('[settings] Failed to auto-save trackedViewIds:', e.message);
    }
  });
  
  removeBtn.addEventListener('click', () => {
    row.remove();
    const list = document.getElementById('sentry-views-list');
    if (list && list.children.length === 0) {
      list.appendChild(createSentryViewRow({ label: '', url: '' }, [], 0));
    }
  });
  
  return row;
}

function updateRowPreview(urlInput, previewEl, trackBtn) {
  const url = urlInput.value.trim();
  if (!url) {
    previewEl.textContent = '';
    urlInput.style.borderColor = 'var(--border,rgba(255,255,255,0.1))';
    // Clear stale viewId so Track can't save a ghost id
    if (trackBtn) trackBtn.dataset.viewId = '';
    return;
  }
  
  const parsed = parseSentryUrl(url);
  if (!parsed) {
    previewEl.innerHTML = `<span style="color:#ef4444;">Couldn't parse this URL — make sure it's a Sentry view URL</span>`;
    urlInput.style.borderColor = '#ef4444';
    if (trackBtn) trackBtn.dataset.viewId = '';
    return;
  }
  
  // Keep data-view-id in sync with whatever URL is currently in the field.
  // Bug: previously data-view-id was set only at row-creation time, so editing
  // the URL left a stale (or empty) viewId and getTrackedViewId() returned null.
  if (trackBtn) trackBtn.dataset.viewId = parsed.viewId;

  urlInput.style.borderColor = 'rgba(34,197,94,0.5)';
  const parts = [
    `View ${parsed.viewId}`,
    parsed.projectIds.length > 0 ? `${parsed.projectIds.length} project${parsed.projectIds.length > 1 ? 's' : ''}` : 'all projects',
    parsed.environment || null,
    parsed.query || null,
  ].filter(Boolean);
  previewEl.innerHTML = `<span style="color:#22c55e;">✓</span> ${parts.join(' · ')}`;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Read all rows from the DOM and produce the persisted {label, url}[] array.
// Skips fully-empty rows. Keeps invalid URLs (so the user doesn't lose work);
// background.js will skip them at fetch time with a warning.
function collectSentryViewsFromRows() {
  const list = document.getElementById('sentry-views-list');
  if (!list) return [];
  
  const rows = Array.from(list.querySelectorAll('.sentry-view-row'));
  return rows
    .map(row => ({
      label: row.querySelector('.sv-label')?.value.trim() || '',
      url:   row.querySelector('.sv-url')?.value.trim() || '',
    }))
    .filter(v => v.label || v.url);
}

// Returns the viewIds of all rows whose Track button is active (● Tracking).
function getTrackedViewIds() {
  return Array.from(document.querySelectorAll('.sv-track'))
    .filter(btn => btn.textContent.includes('Tracking'))
    .map(btn => btn.dataset.viewId)
    .filter(Boolean);
}

(async function() {
  // Run pending migrations first so we read the post-migration shape below
  await runMigrations().catch(err => console.warn('[settings] Migration failed:', err.message));
  
  // Load existing settings
  const result = await chrome.storage.local.get(['settings']);
  const settings = result.settings || {};
  
  // Populate form
  if (settings.jira) {
    document.getElementById('jira-url').value = settings.jira.baseUrl || '';
    document.getElementById('jira-email').value = settings.jira.email || '';
    document.getElementById('jira-token').value = settings.jira.token || '';
  }
  // Monthly report (T-RPT-1)
  const reportAuto = document.getElementById('report-autodownload');
  if (reportAuto) reportAuto.checked = !!(settings.report && settings.report.autoDownload);

  // Calendar (T-CAL-1)
  const calUrl = document.getElementById('calendar-ics-url');
  if (calUrl) calUrl.value = (settings.calendar && settings.calendar.icsUrl) || '';

  // ── Role-specific section visibility ───────────────────────────────
  function applyRoleToSettings(role) {
    document.querySelectorAll('.em-only').forEach(el => {
      el.style.display = role === 'em' ? '' : 'none';
    });
  }
  applyRoleToSettings(settings.role || '');

  // ── Alert settings ───────────────────────────────────────────────────
  renderAlertSettings(settings);
  document.getElementById('reset-alerts-btn')?.addEventListener('click', async () => {
    if (!confirm('Reset all alert rules to defaults?')) return;
    settings.alerts = { ...settings.alerts, rules: JSON.parse(JSON.stringify(DEFAULT_ALERT_RULES)) };
    await chrome.storage.local.set({ settings });
    renderAlertSettings(settings);
  });

  // ── Squad members (EM mode) ─────────────────────────────────────────
  let squadMembers = (settings.analytics?.discoveredMembers || [])
    .map(d => typeof d === 'string' ? { accountId: null, name: d } : { accountId: d.accountId || null, name: d.name || '' })
    .filter(m => m.name);

  function renderMemberTags() {
    const container = document.getElementById('squad-member-tags');
    if (!container) return;
    if (squadMembers.length === 0) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);margin:4px 0 0;">No members yet — save a sprint to auto-populate, or add manually below.</p>';
      return;
    }
    container.innerHTML = squadMembers.map(m =>
      `<span class="member-tag">${escapeAttr(m.name)
      }<button class="member-remove" data-name="${escapeAttr(m.name)}" type="button" title="Remove">×</button></span>`
    ).join('');
    container.querySelectorAll('.member-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        squadMembers = squadMembers.filter(m => m.name !== btn.dataset.name);
        renderMemberTags();
      });
    });
  }
  renderMemberTags();

  function addMember() {
    const input = document.getElementById('add-member-input');
    const name  = input?.value.trim();
    if (!name || squadMembers.some(m => m.name === name)) { if (input) input.value = ''; return; }
    squadMembers.push({ accountId: null, name });
    renderMemberTags();
    if (input) input.value = '';
  }
  document.getElementById('add-member-btn')?.addEventListener('click', addMember);
  document.getElementById('add-member-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addMember(); }
  });

  // ── Time Utilization (Google Calendar free/busy) ─────────────────────
  (function initUtilizationSettings() {
    const util = settings.utilization || {};
    const cidEl = document.getElementById('util-client-id');
    if (cidEl) cidEl.value = util.clientId || '';
    const redirectEl = document.getElementById('util-redirect-uri');
    if (redirectEl && chrome.identity?.getRedirectURL) redirectEl.textContent = chrome.identity.getRedirectURL();

    // Per-member email inputs, prefilled from saved mapping.
    const mapEl = document.getElementById('util-email-map');
    if (mapEl) {
      if (squadMembers.length === 0) {
        mapEl.innerHTML = '<p style="font-size:12px;color:var(--text-muted);margin:0;">No squad members yet — add them above first.</p>';
      } else {
        const saved = util.emails || {};
        mapEl.innerHTML = squadMembers.map(m =>
          `<div style="display:flex;align-items:center;gap:8px;">
             <span style="flex:0 0 120px;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeAttr(m.name)}</span>
             <input type="email" class="util-email" data-name="${escapeAttr(m.name)}" value="${escapeAttr(saved[m.name] || '')}" placeholder="name@getzeal.io" autocomplete="off" spellcheck="false" style="flex:1;"/>
           </div>`
        ).join('');
      }
    }

    const statusEl = document.getElementById('util-status');
    const setStatus = (txt, ok) => { if (statusEl) { statusEl.textContent = txt; statusEl.style.color = ok ? 'var(--status-on-track)' : 'var(--text-muted)'; } };
    getCachedToken().then(tok => setStatus(tok ? '✓ Connected' : 'Not connected', !!tok)).catch(() => {});

    document.getElementById('util-connect-btn')?.addEventListener('click', async () => {
      const clientId = (cidEl?.value || '').trim();
      if (!clientId) { setStatus('Enter the Client ID first', false); return; }
      // Persist the Client ID before auth so the cached token and ID stay aligned.
      const fresh = (await chrome.storage.local.get(['settings'])).settings || settings;
      fresh.utilization = { ...(fresh.utilization || {}), clientId, enabled: true };
      await chrome.storage.local.set({ settings: fresh });
      settings.utilization = fresh.utilization;
      setStatus('Opening Google sign-in…', false);
      try {
        await getToken(clientId, true);
        setStatus('✓ Connected', true);
      } catch (e) {
        setStatus('Connection failed: ' + (e?.message || 'dismissed'), false);
      }
    });
  })();

  const roleHints = {
    em:       'Full squad view — team timesheet, burndown and alerts for everyone.',
    engineer: 'Personal view by default. Squad context available on demand.'
  };
  function setRolePill(role) {
    ['em', 'eng'].forEach(id => {
      const btn = document.getElementById(`role-pill-${id}`);
      if (!btn) return;
      const btnRole = btn.dataset.role;
      btn.classList.toggle('active', btnRole === role);
    });
    const hint = document.getElementById('role-hint');
    if (hint) hint.textContent = roleHints[role] || '';
  }
  setRolePill(settings.role || '');

  document.querySelectorAll('.role-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const role = btn.dataset.role;
      settings.role = role;
      // Role change resets the scope default: engineers open on "Me",
      // EMs on "Squad" — otherwise a stale persisted scope survives the switch.
      settings.viewScope = role === 'engineer' ? 'me' : 'squad';
      setRolePill(role);
      applyRoleToSettings(role);
      await chrome.storage.local.set({ settings });
      const hint = document.getElementById('role-hint');
      if (hint) { hint.textContent = '✓ Saved'; setTimeout(() => setRolePill(role), 1200); }
    });
  });
  
  if (settings.sentry) {
    document.getElementById('sentry-url').value = settings.sentry.baseUrl || 'https://zeal.sentry.io';
    document.getElementById('sentry-org').value = settings.sentry.org || '';
    document.getElementById('sentry-token').value = settings.sentry.token || '';
  }
  
  // Always render Sentry view rows — runs even on fresh install (no settings.sentry yet)
  // so the user always sees one empty row to fill in
  renderSentryViewRows(settings.sentry?.views || [], settings.sentry?.trackedViewIds || (settings.sentry?.trackedViewId ? [settings.sentry.trackedViewId] : []));
  
  if (settings.squad) {
    document.getElementById('squad-key').value = settings.squad.key || '';
    document.getElementById('squad-name').value = settings.squad.name || '';
    // Extra boards (comma-separated)
    if (Array.isArray(settings.squad.extraBoards)) {
      document.getElementById('squad-extra-boards').value = settings.squad.extraBoards
        .map(b => typeof b === 'object' ? `${b.name}|${b.id}` : String(b))
        .join('\n');
    }
  }
  // Milestones (label | Display Name | Leapsome URL)
  if (Array.isArray(settings.milestones)) {
    const msEl = document.getElementById('squad-milestones');
    if (msEl) msEl.value = settings.milestones
      .map(m => [m.label, m.name !== m.label ? m.name : '', m.leapsomeUrl || '']
        .filter((p, i) => i === 0 || p)
        .join('|'))
      .join('\n');
  }
  
  // Select current theme
  const theme = settings.ui?.theme || 'browser';
  document.querySelector(`input[name="theme"][value="${theme}"]`)?.click();
  
  // "+ Add another view" — append blank row to Sentry view list
  document.getElementById('add-sentry-view')?.addEventListener('click', () => {
    const list = document.getElementById('sentry-views-list');
    if (list) list.appendChild(createSentryViewRow({ label: '', url: '' }, [], list.children.length));
  });
  
  // Test Jira connection
  document.getElementById('jira-test-btn').addEventListener('click', async () => {
    const btn = document.getElementById('jira-test-btn');
    const resultDiv = document.getElementById('jira-test-result');
    
    btn.disabled = true;
    btn.textContent = 'Testing...';
    resultDiv.classList.add('hidden');
    
    try {
      const baseUrl = document.getElementById('jira-url').value.trim();
      const email = document.getElementById('jira-email').value.trim();
      const token = document.getElementById('jira-token').value.trim();
      
      if (!baseUrl || !email || !token) {
        throw new Error('Please fill in all Jira fields');
      }
      
      // Test API call
      const authHeader = 'Basic ' + btoa(`${email}:${token}`);
      const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Connection failed (${response.status})`);
      }
      
      const user = await response.json();
      
      resultDiv.textContent = `✓ Connected as ${user.displayName || user.emailAddress}`;
      resultDiv.style.background = 'var(--status-on-track-bg)';
      resultDiv.style.color = 'var(--status-on-track)';
      resultDiv.classList.remove('hidden');
      
    } catch (error) {
      resultDiv.textContent = `✗ ${error.message}`;
      resultDiv.style.background = 'var(--status-off-track-bg)';
      resultDiv.style.color = 'var(--status-off-track)';
      resultDiv.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Jira connection';
    }
  });
  
  // Test Sentry connection
  document.getElementById('sentry-test-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sentry-test-btn');
    const resultDiv = document.getElementById('sentry-test-result');
    
    btn.disabled = true;
    btn.textContent = 'Testing...';
    resultDiv.classList.add('hidden');
    
    try {
      const baseUrl = document.getElementById('sentry-url').value.trim();
      const org = document.getElementById('sentry-org').value.trim();
      const token = document.getElementById('sentry-token').value.trim();
      
      if (!baseUrl || !org || !token) {
        throw new Error('Please fill in all Sentry fields');
      }
      
      // Test API call
      const response = await fetch(`${baseUrl}/api/0/organizations/${org}/`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Connection failed (${response.status})`);
      }
      
      const orgData = await response.json();
      
      resultDiv.textContent = `✓ Connected to ${orgData.name || org}`;
      resultDiv.style.background = 'var(--status-on-track-bg)';
      resultDiv.style.color = 'var(--status-on-track)';
      resultDiv.classList.remove('hidden');
      
    } catch (error) {
      resultDiv.textContent = `✗ ${error.message}`;
      resultDiv.style.background = 'var(--status-off-track-bg)';
      resultDiv.style.color = 'var(--status-off-track)';
      resultDiv.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Sentry connection';
    }
  });
  
  // Save settings
  document.getElementById('save-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-btn');
    const resultDiv = document.getElementById('save-result');
    
    btn.disabled = true;
    btn.textContent = 'Saving...';
    resultDiv.classList.add('hidden');
    
    try {
      const freshSnapshot = await chrome.storage.local.get(['settings']);
      const freshAnalytics = freshSnapshot.settings?.analytics || {};
      const newSettings = {
        jira: {
          baseUrl: document.getElementById('jira-url').value.trim(),
          email: document.getElementById('jira-email').value.trim(),
          token: document.getElementById('jira-token').value.trim()
        },
        sentry: {
          baseUrl: document.getElementById('sentry-url').value.trim(),
          org: document.getElementById('sentry-org').value.trim(),
          views: collectSentryViewsFromRows(),
          trackedViewIds: getTrackedViewIds(),
          token: document.getElementById('sentry-token').value.trim()
        },
        squad: {
          key: document.getElementById('squad-key').value.trim().toUpperCase(),
          name: document.getElementById('squad-name').value.trim(),
          extraBoards: document.getElementById('squad-extra-boards').value
            .split('\n')
            .map(line => line.trim())
            .filter(line => line)
            .map(line => {
              if (line.includes('|')) {
                const [name, id] = line.split('|').map(s => s.trim());
                return { name, id: parseInt(id, 10) };
              }
              return { name: `Board ${line}`, id: parseInt(line, 10) };
            })
            .filter(b => Number.isFinite(b.id))
        },
        ui: {
          theme: document.querySelector('input[name="theme"]:checked')?.value || 'browser',
          privacyMode: settings.ui?.privacyMode || false
        },
        alerts: {
          cadenceMin: 30,
          desktopNotifications: false,
          severityFloor: 'medium'
        },
        analytics: {
          // When role is EM and the member list has been curated in this session,
          // save the curated list and lock it so background auto-discovery stops
          // overriding the EM's intentional choices.
          discoveredMembers: (settings.role === 'em' && squadMembers.length > 0)
            ? squadMembers
            : (freshAnalytics.discoveredMembers || settings.analytics?.discoveredMembers || []),
          squadMembersCurated: settings.role === 'em' && squadMembers.length > 0,
          monitoredMembers: freshAnalytics.monitoredMembers ?? settings.analytics?.monitoredMembers ?? []
        },
        milestones: parseMilestoneLines(document.getElementById('squad-milestones')?.value || ''),
        report: {
          autoDownload: document.getElementById('report-autodownload')?.checked || false,
          retentionMonths: 12
        },
        calendar: (() => {
          const icsUrl = (document.getElementById('calendar-ics-url')?.value || '').trim();
          return { icsUrl, enabled: !!icsUrl };
        })(),
        utilization: (() => {
          const clientId = (document.getElementById('util-client-id')?.value || '').trim();
          const emails = {};
          document.querySelectorAll('#util-email-map .util-email').forEach(inp => {
            const name = inp.dataset.name; const val = (inp.value || '').trim();
            if (name && val) emails[name] = val;
          });
          return { clientId, emails, enabled: !!clientId };
        })(),
        // Preserve role and viewScope across saves
        role:      settings.role      || 'em',
        viewScope: settings.viewScope || (settings.role === 'engineer' ? 'me' : 'squad')
      };
      
      await chrome.storage.local.set({ settings: newSettings });
      
      // Notify popup to reload
      chrome.runtime.sendMessage({ type: 'settings-updated' }).catch(() => {
        // Popup might not be open, ignore error
      });
      
      // Apply theme immediately
      document.documentElement.setAttribute('data-theme', newSettings.ui.theme);
      
      resultDiv.textContent = '✓ Settings saved';
      resultDiv.style.background = 'var(--status-on-track-bg)';
      resultDiv.style.color = 'var(--status-on-track)';
      resultDiv.classList.remove('hidden');
      
      // If returning from auth screen, close settings after 1s
      setTimeout(() => {
        if (!settings.jira?.token) {
          window.close();
        }
      }, 1000);
      
    } catch (error) {
      resultDiv.textContent = `✗ Save failed: ${error.message}`;
      resultDiv.style.background = 'var(--status-off-track-bg)';
      resultDiv.style.color = 'var(--status-off-track)';
      resultDiv.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save settings →';
    }
  });
  

  // ── Sentry Trend History import ──────────────────────────────────────────
  const importBtn    = document.getElementById('sentry-import-btn');
  const importFile   = document.getElementById('sentry-import-file');
  const importStatus = document.getElementById('sentry-import-status');

  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());

    importFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const setStatus = (msg, color = 'var(--text-muted)') => {
        if (importStatus) { importStatus.textContent = msg; importStatus.style.color = color; }
        else console.log('[import]', msg);
      };

      setStatus('Reading file…');

      try {
        const text = await file.text();
        let payload;
        try { payload = JSON.parse(text); } catch { throw new Error('File is not valid JSON.'); }

        // Validate shape (same format as the export produces)
        if (typeof payload.viewId !== 'string' || !Array.isArray(payload.samples)) {
          throw new Error('Invalid format — use a file exported by Zealer Dashboard (⬇ button on the trend chart).');
        }
        if (payload.samples.length === 0) {
          importStatus.textContent = 'File contains 0 samples — nothing to import.';
          return;
        }

        setStatus(`Importing ${payload.samples.length} sample(s)…`);

        const { imported, skipped, errors } = await importTrendSamples(payload.viewId, payload.samples);

        const parts = [`✓ ${imported} sample${imported === 1 ? '' : 's'} imported`];
        if (skipped > 0) parts.push(`${skipped} skipped (live readings kept)`);
        if (errors  > 0) parts.push(`${errors} invalid rows ignored`);

        // Decision #3: silent import + warning if the view isn't currently tracked.
        // The data is stored regardless; it appears on the chart once the view is tracked.
        const r2 = await chrome.storage.local.get(['settings']);
        const trackedIds = Array.isArray(r2.settings?.sentry?.trackedViewIds)
          ? r2.settings.sentry.trackedViewIds
          : (r2.settings?.sentry?.trackedViewId ? [r2.settings.sentry.trackedViewId] : []);
        const isTracked = trackedIds.includes(payload.viewId);

        setStatus(parts.join(' · '), 'var(--status-on-track,#22c55e)');

        if (!isTracked) {
          // Non-blocking notice below the status line
          const note = document.getElementById('sentry-import-note');
          if (note) {
            note.style.display = 'block';
            note.innerHTML = `⚠ This data is for <strong>${escapeAttr(payload.viewLabel || payload.viewId)}</strong>, which isn't currently tracked. ` +
              `It's been saved, but won't show on the chart until you click <strong>Track</strong> on that view above.`;
          }
        } else {
          const note = document.getElementById('sentry-import-note');
          if (note) note.style.display = 'none';
        }
      } catch (err) {
        setStatus(`✗ ${err.message}`, 'var(--status-off-track,#ef4444)');
      } finally {
        importFile.value = ''; // allow re-importing same file
      }
    });
  }

  // Theme selection (apply immediately for preview)
  document.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.documentElement.setAttribute('data-theme', radio.value);
    });
  });

  // ── Demo / Mock Data Mode toggle (session-scoped) ─────────────────────
  const demoToggle = document.getElementById('demo-mode-toggle');
  const demoNote   = document.getElementById('demo-mode-active-note');
  const settingsBody = document.getElementById('settings-main-body');
  const mockRoleBtns = [
    document.getElementById('mock-as-em'),
    document.getElementById('mock-as-engineer'),
  ].filter(Boolean);

  function applyDemoUI(on, role) {
    if (demoToggle) demoToggle.checked = on;
    if (demoNote)   demoNote.style.display = on ? 'block' : 'none';
    if (settingsBody) settingsBody.classList.toggle('demo-active', on);
    mockRoleBtns.forEach((b) => {
      b.disabled = !on;
      b.classList.toggle('active', !!on && b.dataset.mockRole === role);
    });
  }

  // Read session state and initialise toggle + active preview role
  try {
    const sess = await chrome.storage.session.get(['mockModeEnabled', 'mockRole']);
    applyDemoUI(!!sess.mockModeEnabled, sess.mockRole || '');
  } catch { /* session storage unavailable */ }

  demoToggle?.addEventListener('change', async () => {
    const on = demoToggle.checked;
    try {
      // turning on previews as EM by default; turning off clears any previewed role
      await chrome.storage.session.set(on ? { mockModeEnabled: true, mockRole: 'em' } : { mockModeEnabled: false, mockRole: '' });
    } catch { /* noop */ }
    let role = '';
    if (on) { try { role = (await chrome.storage.session.get('mockRole')).mockRole || 'em'; } catch { role = 'em'; } }
    applyDemoUI(on, role);
    // Notify open popup to apply the change immediately (no close/reopen needed)
    chrome.runtime.sendMessage({ type: 'mock-mode-changed', enabled: on }).catch(() => {});
  });

  // "Mock as EM" / "Mock as Engineer" — set a transient preview role (session only,
  // never persisted to settings.role) and enable mock mode.
  mockRoleBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const role = btn.dataset.mockRole;
      try { await chrome.storage.session.set({ mockModeEnabled: true, mockRole: role }); } catch { /* noop */ }
      applyDemoUI(true, role);
      chrome.runtime.sendMessage({ type: 'mock-mode-changed', enabled: true }).catch(() => {});
    });
  });

})();
