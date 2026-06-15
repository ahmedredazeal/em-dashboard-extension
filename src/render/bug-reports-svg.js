/**
 * src/render/bug-reports-svg.js — Zealer Dashboard (T-BR-1, phase 1)
 *
 * Pure builders for the Bug Reports card:
 *   • buildBugTrendSVG(trend)    — incoming vs resolved per sprint (grouped bars)
 *   • buildBugSnapshotSVG(snap)  — open-bug age buckets + median + priority split
 *   • buildBugReportsCard(...)   — wraps both with a header + scope-aware title
 *
 * Pure: metrics objects in → HTML string out. No DOM, no deps.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const C_INCOMING = '#ef4444'; // red — new bugs
const C_RESOLVED = '#22c55e'; // green — closed bugs
const C_AXIS     = 'var(--border,rgba(255,255,255,0.12))';
const C_MUTED    = 'var(--text-muted,#94a3b8)';
const C_TEXT     = 'var(--text,#e2e8f0)';

/** Priority → colour for the snapshot split. */
const PRIORITY_COLORS = {
  Highest: '#dc2626', High: '#ef4444', Urgent: '#dc2626',
  Medium: '#f59e0b', Low: '#3b82f6', Lowest: '#64748b', None: '#94a3b8',
};

/**
 * Chart 1 — incoming vs resolved, grouped vertical bars per sprint window.
 * @param {{buckets:Array<{name,incoming,resolved,net}>, totals, olderIncoming, olderResolved}} trend
 */
export function buildBugTrendSVG(trend) {
  const buckets = trend?.buckets || [];
  if (buckets.length === 0) {
    return `<div class="empty-state"><div class="empty-icon">🐞</div><div class="empty-msg">No sprint windows for a bug trend yet.</div></div>`;
  }

  const W = 320, H = 150, PAD_L = 28, PAD_B = 30, PAD_T = 14;
  const plotW = W - PAD_L - 8, plotH = H - PAD_T - PAD_B;
  const maxVal = Math.max(1, ...buckets.map(b => Math.max(b.incoming, b.resolved)));
  const groupW = plotW / buckets.length;
  const barW = Math.min(14, groupW / 3);

  // Y gridlines (0, mid, max)
  let grid = '';
  for (let i = 0; i <= 2; i++) {
    const v = Math.round((maxVal / 2) * i);
    const y = PAD_T + plotH - (v / maxVal) * plotH;
    grid += `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - 8}" y2="${y.toFixed(1)}" stroke="${C_AXIS}" stroke-width="1"/>`
          + `<text x="${PAD_L - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="${C_MUTED}" font-size="9" font-family="system-ui">${v}</text>`;
  }

  let bars = '';
  buckets.forEach((b, i) => {
    const gx = PAD_L + i * groupW + (groupW - barW * 2 - 2) / 2;
    const hi = (b.incoming / maxVal) * plotH;
    const hr = (b.resolved / maxVal) * plotH;
    const yi = PAD_T + plotH - hi, yr = PAD_T + plotH - hr;
    bars += `<rect x="${gx.toFixed(1)}" y="${yi.toFixed(1)}" width="${barW}" height="${hi.toFixed(1)}" fill="${C_INCOMING}" rx="1"><title>${esc(b.name)}: ${b.incoming} new</title></rect>`;
    bars += `<rect x="${(gx + barW + 2).toFixed(1)}" y="${yr.toFixed(1)}" width="${barW}" height="${hr.toFixed(1)}" fill="${C_RESOLVED}" rx="1"><title>${esc(b.name)}: ${b.resolved} resolved</title></rect>`;
    // Short sprint label (last token, e.g. "Sprint 24" → "24")
    const short = esc((b.name || '').split(/\s+/).pop()).slice(0, 6);
    bars += `<text x="${(PAD_L + i * groupW + groupW / 2).toFixed(1)}" y="${H - PAD_B + 12}" text-anchor="middle" fill="${C_MUTED}" font-size="9" font-family="system-ui">${short}</text>`;
  });

  const net = trend.totals?.net ?? 0;
  const netColor = net > 0 ? C_INCOMING : (net < 0 ? C_RESOLVED : C_MUTED);
  const netLabel = net > 0 ? `+${net} net (backlog growing)` : (net < 0 ? `${net} net (backlog shrinking)` : 'net flat');
  const older = (trend.olderIncoming || 0) + (trend.olderResolved || 0);
  const olderNote = older > 0
    ? `<div style="font-size:var(--fs-caption);color:${C_MUTED};margin-top:2px;">${trend.olderIncoming} new / ${trend.olderResolved} resolved older than the window (not shown)</div>`
    : '';

  return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:2px;">
      <span style="font-size:var(--fs-caption);color:${C_TEXT};"><span style="color:${C_INCOMING};">●</span> Incoming</span>
      <span style="font-size:var(--fs-caption);color:${C_TEXT};"><span style="color:${C_RESOLVED};">●</span> Resolved</span>
      <span style="font-size:var(--fs-caption);color:${netColor};margin-left:auto;font-weight:600;">${netLabel}</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">${grid}${bars}</svg>
    ${olderNote}`;
}

/**
 * Chart 2 — open-bug snapshot: total + median age, age buckets, priority split.
 * @param {{totalOpen, medianAgeDays, ageBuckets:Array<{label,count}>, byPriority:Array<{priority,count}>}} snap
 */
export function buildBugSnapshotSVG(snap) {
  if (!snap || snap.totalOpen === 0) {
    return `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-msg">No open bugs.</div></div>`;
  }

  const maxBucket = Math.max(1, ...snap.ageBuckets.map(b => b.count));
  const ageRows = snap.ageBuckets.map(b => {
    const pct = (b.count / maxBucket) * 100;
    const danger = b.label === '90d+' && b.count > 0;
    const fill = danger ? C_INCOMING : 'var(--primary,#6366f1)';
    return `
      <div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
        <span style="width:42px;font-size:var(--fs-caption);color:${C_MUTED};text-align:right;">${esc(b.label)}</span>
        <div style="flex:1;background:var(--surface-raised,rgba(255,255,255,0.05));border-radius:3px;height:12px;position:relative;">
          <div style="width:${pct.toFixed(0)}%;background:${fill};height:100%;border-radius:3px;min-width:${b.count > 0 ? '2px' : '0'};"></div>
        </div>
        <span style="width:20px;font-size:var(--fs-caption);color:${C_TEXT};">${b.count}</span>
      </div>`;
  }).join('');

  const prioChips = (snap.byPriority || []).map(p => {
    const c = PRIORITY_COLORS[p.priority] || C_MUTED;
    return `<span style="font-size:var(--fs-caption);color:${C_TEXT};white-space:nowrap;"><span style="color:${c};">●</span> ${esc(p.priority)} ${p.count}</span>`;
  }).join('');

  return `
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;">
      <span style="font-size:var(--fs-head);font-weight:700;color:${C_TEXT};">${snap.totalOpen}</span>
      <span style="font-size:var(--fs-caption);color:${C_MUTED};">open · median age ${snap.medianAgeDays}d</span>
    </div>
    ${ageRows}
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">${prioChips}</div>`;
}

/**
 * Full Bug Reports card: header + both charts.
 * @param {Object} trend  result of incomingVsResolved()
 * @param {Object} snap   result of openBugSnapshot()
 * @param {string} scopeLabel  'Squad' | 'Me' — shown in the header
 */
export function buildBugReportsCard(trend, snap, scopeLabel = '') {
  const card = 'padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;display:flex;flex-direction:column;width:100%;gap:8px;';
  const scopeBadge = scopeLabel
    ? `<span style="font-size:var(--fs-caption);color:${C_MUTED};margin-left:auto;">${esc(scopeLabel)}</span>`
    : '';
  return `
    <div style="${card}">
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="section-label-std">🐞 Bug Reports</span>${scopeBadge}
      </div>
      <div>
        <div style="font-size:var(--fs-caption);color:${C_MUTED};margin-bottom:2px;">Incoming vs Resolved · last ${trend?.buckets?.length || 0} sprints</div>
        ${buildBugTrendSVG(trend)}
      </div>
      <div>
        <div style="font-size:var(--fs-caption);color:${C_MUTED};margin-bottom:2px;">Open bugs by age</div>
        ${buildBugSnapshotSVG(snap)}
      </div>
    </div>`;
}
