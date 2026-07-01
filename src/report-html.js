/**
 * src/report-html.js — Zealer Dashboard (T-RPT-1)
 *
 * Pure builders that turn a FinalizedMonth (or the in-progress bucket finalized
 * on the fly) into shareable artifacts:
 *   - buildReportJSON(finalizedMonth)  → pretty JSON string (data of record)
 *   - buildReportHTML(finalizedMonth, palette?) → standalone HTML document
 *
 * Per the plan (F8) the HTML is SELF-CONTAINED: it inlines resolved colours and
 * its own CSS — no `var(--...)`, no external stylesheet — so an exported file
 * opens correctly outside the extension. A palette can be injected; the default
 * is a light, print-friendly palette.
 */

export const LIGHT_PALETTE = {
  bg: '#ffffff', surface: '#f8fafc', border: '#e2e8f0',
  text: '#111827', muted: '#6b7280', primary: '#2563eb',
  good: '#16a34a', bad: '#dc2626', warn: '#d97706',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmt(n, dash = '—') {
  if (n == null || (typeof n === 'number' && isNaN(n))) return dash;
  return String(n);
}

/** Pretty JSON — the machine-readable data of record. */
export function buildReportJSON(finalizedMonth) {
  return JSON.stringify(finalizedMonth, null, 2);
}

/** Human-readable month label, e.g. "2026-05" → "May 2026". */
export function monthLabel(key) {
  if (!/^\d{4}-\d{2}$/.test(key || '')) return key || '';
  const [y, m] = key.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[m - 1]} ${y}`;
}

function statCard(label, value, sub, p) {
  return `
    <div class="card">
      <div class="card-label">${esc(label)}</div>
      <div class="card-value">${esc(value)}</div>
      ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
    </div>`;
}

function barList(rows, p, opts = {}) {
  const max = Math.max(1, ...rows.map(r => r.value || 0));
  return rows.map(r => {
    const pct = ((r.value || 0) / max) * 100;
    const color = r.color || p.primary;
    return `
      <div class="row">
        <span class="row-label" title="${esc(r.label)}">${esc(r.label)}</span>
        <span class="row-bar"><span class="row-fill" style="width:${pct.toFixed(0)}%;background:${color};"></span></span>
        <span class="row-val">${esc(fmt(r.value))}${opts.suffix || ''}</span>
      </div>`;
  }).join('');
}

/**
 * Build a standalone HTML report for a finalized month.
 * @param {Object} fm  FinalizedMonth (has .derived)
 * @param {Object} [palette]  colour overrides; defaults to LIGHT_PALETTE
 * @param {Object} [opts]  { engineerName, scope } for a "my report" variant
 */
export function buildReportHTML(fm, palette = LIGHT_PALETTE, opts = {}) {
  const p = { ...LIGHT_PALETTE, ...palette };
  const d = (fm && fm.derived) || {};
  const month = monthLabel(fm && fm.month);
  const scope = opts.scope || 'Squad';
  const partial = fm && fm.partial;
  const observed = fm && fm.observedDays;

  const net = d.netBugFlow;
  const netColor = net > 0 ? p.bad : (net < 0 ? p.good : p.muted);
  const netLabel = net > 0 ? `+${net} (backlog grew)` : (net < 0 ? `${net} (backlog shrank)` : '0 (flat)');

  // Per-engineer table — HOURS ONLY (bug flow is squad-level, not per-person).
  const engineers = Object.entries(d.byEngineer || {})
    .map(([acc, v]) => ({ acc, ...v }))
    .sort((a, b) => (b.hours || 0) - (a.hours || 0));
  const engRows = engineers.length ? engineers.map(e => `
      <tr>
        <td>${esc(e.acc)}</td>
        <td class="num">${fmt(e.hours)}</td>
      </tr>`).join('') : `<tr><td colspan="2" class="muted">No per-engineer hours data.</td></tr>`;

  // Sprints table
  const sprints = (fm && fm.sprintsClosed) || [];
  const sprintRows = sprints.length ? sprints.map(s => `
      <tr>
        <td>${esc(s.name)}</td>
        <td class="num">${fmt(s.committedPts)}</td>
        <td class="num">${fmt(s.completedPts)}</td>
        <td class="num">${fmt(s.velocity)}</td>
        <td class="num">${s.completionPct != null ? s.completionPct + '%' : '—'}</td>
      </tr>`).join('') : `<tr><td colspan="5" class="muted">No sprints closed this month.</td></tr>`;

  const css = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin:0; padding:24px; background:${p.bg}; color:${p.text};
           font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size:13px; line-height:1.5; }
    .wrap { max-width: 820px; margin: 0 auto; }
    h1 { font-size:22px; margin:0 0 2px; }
    h2 { font-size:15px; margin:24px 0 8px; border-bottom:1px solid ${p.border}; padding-bottom:4px; }
    .meta { color:${p.muted}; font-size:12px; margin-bottom:16px; }
    .badge { display:inline-block; border:1px solid ${p.border}; border-radius:10px; padding:1px 8px; font-size:11px; color:${p.muted}; }
    .warn-banner { background:#fef3c7; border:1px solid ${p.warn}; color:#92400e; border-radius:8px; padding:8px 12px; margin:12px 0; font-size:12px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
    .card { background:${p.surface}; border:1px solid ${p.border}; border-radius:8px; padding:12px; }
    .card-label { font-size:11px; color:${p.muted}; text-transform:uppercase; letter-spacing:.3px; }
    .card-value { font-size:24px; font-weight:700; margin-top:2px; }
    .card-sub { font-size:11px; color:${p.muted}; margin-top:2px; }
    .row { display:flex; align-items:center; gap:8px; margin:4px 0; }
    .row-label { width:120px; flex:0 0 120px; color:${p.muted}; font-size:12px; text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .row-bar { flex:1; background:${p.surface}; border:1px solid ${p.border}; border-radius:3px; height:14px; overflow:hidden; }
    .row-fill { display:block; height:100%; }
    .row-val { width:48px; flex:0 0 48px; text-align:right; font-variant-numeric:tabular-nums; }
    table { width:100%; border-collapse:collapse; margin-top:4px; }
    th, td { text-align:left; padding:6px 8px; border-bottom:1px solid ${p.border}; font-size:12px; }
    th { color:${p.muted}; font-weight:600; }
    td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
    .muted { color:${p.muted}; }
    .foot { margin-top:24px; color:${p.muted}; font-size:11px; border-top:1px solid ${p.border}; padding-top:8px; }`;

  const warnBanner = (partial || (observed != null))
    ? `<div class="warn-banner">${partial ? 'Partial month — accumulation started after the 1st. ' : ''}${observed != null ? `Data captured on ${observed} day(s) the dashboard was opened.` : ''}</div>`
    : '';

  const hoursLine = d.hoursAvailable
    ? statCard('Hours logged', fmt(d.totalHours), 'vs 6h/day capacity', p)
    : statCard('Hours logged', '—', 'unavailable this month', p);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zealer Monthly Report — ${esc(month)}${scope === 'Me' ? ' (Me)' : ''}</title>
<style>${css}</style></head>
<body><div class="wrap">
  <h1>Monthly Report — ${esc(month)}<span style="display:inline-block;margin-left:6px;padding:0 4px;font-size:9px;font-weight:700;letter-spacing:0.5px;color:#0b0f19;background:#fbbf24;border-radius:3px;vertical-align:middle;font-family:system-ui;">ALPHA</span></h1>
  <div class="meta">
    <span class="badge">${esc(scope)}</span>
    ${fm && fm.squad ? `<span class="badge">${esc(fm.squad)}</span>` : ''}
    ${opts.engineerName ? `<span class="badge">${esc(opts.engineerName)}</span>` : ''}
    &nbsp; Generated ${esc((fm && fm.finalizedAt) || new Date().toISOString())}
    ${fm && fm.appVersion ? ` · v${esc(fm.appVersion)}` : ''}
  </div>
  ${warnBanner}
  ${scope === 'Me' ? `<div class="meta" style="margin-top:-4px;">Hours are yours; bug &amp; support counts are squad-wide (bugs aren't attributed to individuals).</div>` : ''}

  <h2>Delivery</h2>
  <div class="grid">
    ${statCard('Sprints closed', fmt(d.sprintCount), null, p)}
    ${statCard('Avg velocity', fmt(d.velocityAvg), 'points/sprint', p)}
    ${statCard('Avg completion', d.completionPctAvg != null ? d.completionPctAvg + '%' : '—', 'committed vs done', p)}
    ${hoursLine}
  </div>
  <table>
    <thead><tr><th>Sprint</th><th class="num">Committed</th><th class="num">Completed</th><th class="num">Velocity</th><th class="num">Completion</th></tr></thead>
    <tbody>${sprintRows}</tbody>
  </table>

  <h2>Bugs</h2>
  <div class="grid">
    ${statCard('Opened', fmt(d.bugsOpened), null, p)}
    ${statCard('Resolved', fmt(d.bugsResolved), null, p)}
    ${statCard('Net flow', netLabel, null, p)}
    ${statCard('Open at month end', fmt(d.openBugsEnd), d.openBugsStart != null ? `started at ${d.openBugsStart}` : null, p)}
    ${statCard('Median age', d.medianBugAgeEnd != null ? d.medianBugAgeEnd + 'd' : '—', 'at month end', p)}
  </div>

  <h2>Support</h2>
  <div class="grid">
    ${statCard('Tickets opened', fmt(d.supportOpened), null, p)}
    ${statCard('Tickets closed', fmt(d.supportClosed), null, p)}
  </div>

  <h2>Hours by engineer</h2>
  <table>
    <thead><tr><th>Engineer</th><th class="num">Hours</th></tr></thead>
    <tbody>${engRows}</tbody>
  </table>

  <div class="foot">
    Zealer Dashboard monthly report · ${esc(month)} · ${esc(scope)} scope.
    JSON data of record available alongside this file.
  </div>
</div></body></html>`;
}
