/**
 * report.js — Monthly Report viewer (T-RPT-1)
 *
 * Thin viewer: loads the report store (or demo data), lists months, renders the
 * selected month via the pure builders into an iframe, supports squad/me scope,
 * shows the retention warning, and exports JSON/HTML permission-free via a blob
 * anchor (F4 — no downloads permission needed for manual export).
 */
import { buildReportHTML, buildReportJSON, LIGHT_PALETTE } from './src/report-html.js';
import { retentionWarning, finalizeMonth, sliceEngineer, DEFAULT_RETENTION_MONTHS } from './src/monthly-report.js';
import { generateMockReportStore } from './src/mock-data.js';

const isDemo = new URLSearchParams(location.search).get('demo') === '1';

const els = {
  monthSelect: document.getElementById('monthSelect'),
  scopeToggle: document.getElementById('scopeToggle'),
  frame: document.getElementById('reportFrame'),
  empty: document.getElementById('emptyMsg'),
  warnSlot: document.getElementById('warnSlot'),
  demoPill: document.getElementById('demoPill'),
  exportJson: document.getElementById('exportJson'),
  exportHtml: document.getElementById('exportHtml'),
};

let store = null;          // { currentMonth, current, history, retentionMonths }
let months = [];           // selectable month keys (history + current if it has data), newest first
let scope = 'squad';       // 'squad' | 'me'
let myAccountId = null;

init();

async function init() {
  if (isDemo) {
    els.demoPill.style.display = '';
    store = generateMockReportStore();
    myAccountId = 'mock-acc-ahmed';
    els.scopeToggle.style.display = '';
  } else {
    const got = await chrome.storage.local.get(['reportStore', 'currentUser']);
    store = got.reportStore || null;
    myAccountId = got.currentUser && got.currentUser.accountId;
    if (myAccountId) els.scopeToggle.style.display = '';
  }

  months = collectMonths(store);
  if (months.length === 0) { showEmpty(); wireExportDisabled(); return; }

  populateMonths();
  wireControls();
  render();
  renderWarning();
}

/** History months + the in-progress current month (if it has any data), newest first. */
function collectMonths(s) {
  if (!s) return [];
  const keys = Object.keys(s.history || {});
  const list = [...keys];
  if (s.current && s.current.month && (s.current.observedDays > 0 || Object.keys(s.current.daily || {}).length)) {
    if (!list.includes(s.current.month)) list.push(s.current.month);
  }
  return list.sort().reverse();
}

/** Resolve a month key to a FinalizedMonth (history is already finalized; the
 *  current in-progress month is finalized on the fly, without hours). */
function finalizedFor(monthKeyStr) {
  if (store.history && store.history[monthKeyStr]) return store.history[monthKeyStr];
  if (store.current && store.current.month === monthKeyStr) {
    return finalizeMonth(store.current, null); // in-progress → no hours read here
  }
  return null;
}

function populateMonths() {
  els.monthSelect.innerHTML = months.map(m => {
    const inProgress = store.current && store.current.month === m && !(store.history || {})[m];
    return `<option value="${m}">${m}${inProgress ? ' (in progress)' : ''}</option>`;
  }).join('');
}

function wireControls() {
  els.monthSelect.addEventListener('change', () => { render(); });
  els.scopeToggle.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      scope = b.dataset.scope;
      els.scopeToggle.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      render();
    });
  });
  els.exportJson.addEventListener('click', () => exportCurrent('json'));
  els.exportHtml.addEventListener('click', () => exportCurrent('html'));
}
function wireExportDisabled() {
  els.exportJson.disabled = true;
  els.exportHtml.disabled = true;
}

function currentFinalized() {
  return finalizedFor(els.monthSelect.value);
}

/** Build the FinalizedMonth actually rendered. In Me scope we narrow HOURS to
 *  the engineer (bug/support counts stay squad-level — they're not attributed to
 *  individuals by design). */
function viewModel(fm) {
  if (scope === 'me' && myAccountId) {
    const slice = sliceEngineer(fm, myAccountId);
    return {
      ...fm,
      derived: {
        ...fm.derived,
        // Hours become the engineer's own; bug/support counts remain squad-level.
        totalHours: slice.hours,
        hoursAvailable: slice.hours != null,
        byEngineer: { [myAccountId]: { hours: slice.hours } },
      },
    };
  }
  return fm;
}

function render() {
  const fm = currentFinalized();
  if (!fm) { showEmpty(); return; }
  els.empty.style.display = 'none';
  els.frame.style.display = '';
  const vm = viewModel(fm);
  const opts = scope === 'me'
    ? { scope: 'Me', engineerName: (isDemo ? 'Ahmed Reda (demo)' : (myAccountId || 'Me')) }
    : { scope: 'Squad' };
  const html = buildReportHTML(vm, LIGHT_PALETTE, opts);
  els.frame.srcdoc = html;
}

function renderWarning() {
  if (!store) return;
  const retention = store.retentionMonths || DEFAULT_RETENTION_MONTHS;
  const w = retentionWarning(store.history || {}, store.current && store.current.month, retention);
  if (w.willPrune && w.monthsAtRisk.length) {
    const div = document.createElement('div');
    div.className = 'warn';
    div.textContent = `Heads up: ${w.monthsAtRisk.join(', ')} will be removed when the current month closes (12-month limit). Export ${w.monthsAtRisk.length > 1 ? 'them' : 'it'} now to keep a permanent copy.`;
    els.warnSlot.appendChild(div);
  }
}

function showEmpty() {
  els.frame.style.display = 'none';
  els.empty.style.display = '';
}

function exportCurrent(kind) {
  const fm = currentFinalized();
  if (!fm) return;
  // Usage: count report exports as an action (suppressed in demo mode so sample
  // sessions don't pollute analytics). Best-effort — never blocks the export.
  try {
    const demo = new URLSearchParams(location.search).get('demo');
    if (!demo) chrome.runtime.sendMessage({ type: 'track-action', action: 'export_report' }).catch(() => {});
  } catch { /* ignore */ }
  const vm = viewModel(fm);
  const month = fm.month;
  const scopeTag = scope === 'me' ? '-me' : '';
  if (kind === 'json') {
    downloadBlob(`zealer-report-${month}${scopeTag}.json`, 'application/json', buildReportJSON(vm));
  } else {
    const opts = scope === 'me' ? { scope: 'Me', engineerName: myAccountId || 'Me' } : { scope: 'Squad' };
    downloadBlob(`zealer-report-${month}${scopeTag}.html`, 'text/html', buildReportHTML(vm, LIGHT_PALETTE, opts));
  }
}

/** Permission-free download via a blob anchor (no chrome.downloads needed). */
function downloadBlob(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
