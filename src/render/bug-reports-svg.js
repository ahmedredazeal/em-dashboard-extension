/**
 * src/render/bug-reports-svg.js — Zealer Dashboard (T-BR-1)
 *
 * Pure builders for the Bug Reports card. The card is a 2×2 grid of four
 * equal-sized panels with a shared visual system:
 *   1. Incoming vs Resolved (grouped bars per sprint)
 *   2. Open bugs by age (horizontal bars)
 *   3. Reopen rate (big stat + caption)
 *   4. Open bugs by App (horizontal bars)
 *
 * Design system (consistent across all four panels):
 *   • One panel shell (buildPanel) — same padding, header style, min-height.
 *   • Shared palette: semantic red (incoming/bad), green (resolved/good),
 *     indigo (neutral counts), slate (muted/axis).
 *   • Horizontal bar rows share one builder (barRow) so label width, bar height,
 *     gaps, and count column line up everywhere.
 *   • Fixed gaps via the --space-* tokens; --fs-* tokens for every text size.
 *
 * Pure: metrics objects in → HTML string out. No DOM, no deps.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Shared palette ─────────────────────────────────────────────────────────
const C = {
  incoming: '#ef4444',   // red    — new bugs / bad
  resolved: '#22c55e',   // green  — closed bugs / good
  neutral:  'var(--primary, #6366f1)', // indigo — neutral counts
  warn:     '#f59e0b',   // amber  — mid severity
  danger:   '#ef4444',
  axis:     'var(--border, rgba(255,255,255,0.12))',
  muted:    'var(--text-muted, #94a3b8)',
  text:     'var(--text, #e2e8f0)',
  track:    'var(--surface-raised, rgba(255,255,255,0.06))',
};

const PRIORITY_COLORS = {
  Highest: '#dc2626', High: '#ef4444', Urgent: '#dc2626',
  Medium: '#f59e0b', Low: '#3b82f6', Lowest: '#64748b', None: '#94a3b8',
};

// ── Shared building blocks ───────────────────────────────────────────────────

/** A panel shell: consistent header + body, equal min-height, fixed padding. */
function buildPanel(title, bodyHtml, accentHtml = '') {
  return `
    <div style="background:var(--surface-raised,rgba(255,255,255,0.03));
                border:1px solid ${C.axis};border-radius:8px;
                padding:var(--space-3,12px);display:flex;flex-direction:column;
                gap:var(--space-2,8px);min-height:132px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:var(--fs-label,11px);font-weight:600;color:${C.muted};
                     letter-spacing:0.3px;text-transform:uppercase;">${esc(title)}</span>
        ${accentHtml ? `<span style="margin-left:auto;">${accentHtml}</span>` : ''}
      </div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;">${bodyHtml}</div>
    </div>`;
}

/** One horizontal bar row, shared by the age + app panels so they align. */
function barRow(label, count, maxCount, color, labelWidth = 70) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return `
    <div style="display:flex;align-items:center;gap:var(--space-2,8px);margin:3px 0;">
      <span style="width:${labelWidth}px;flex:0 0 ${labelWidth}px;font-size:var(--fs-caption,10px);
                   color:${C.muted};text-align:right;overflow:hidden;text-overflow:ellipsis;
                   white-space:nowrap;" title="${esc(label)}">${esc(label)}</span>
      <div style="flex:1;background:${C.track};border-radius:3px;height:12px;overflow:hidden;">
        <div style="width:${pct.toFixed(0)}%;background:${color};height:100%;border-radius:3px;
                    min-width:${count > 0 ? '3px' : '0'};transition:none;"></div>
      </div>
      <span style="width:24px;flex:0 0 24px;font-size:var(--fs-caption,10px);color:${C.text};
                   text-align:right;font-variant-numeric:tabular-nums;">${count}</span>
    </div>`;
}

/** A small legend dot + label. */
function legendDot(color, label) {
  return `<span style="font-size:var(--fs-caption,10px);color:${C.text};white-space:nowrap;">
    <span style="color:${color};">●</span> ${esc(label)}</span>`;
}

// ── Panel 1: Incoming vs Resolved (grouped vertical bars) ────────────────────

export function buildBugTrendSVG(trend) {
  const buckets = trend?.buckets || [];
  if (buckets.length === 0) {
    return `<div style="font-size:var(--fs-caption,10px);color:${C.muted};text-align:center;padding:12px 0;">No sprint windows yet.</div>`;
  }

  const W = 300, H = 120, PAD_L = 22, PAD_B = 22, PAD_T = 8;
  const plotW = W - PAD_L - 6, plotH = H - PAD_T - PAD_B;
  const maxVal = Math.max(1, ...buckets.map(b => Math.max(b.incoming, b.resolved)));
  const groupW = plotW / buckets.length;
  const barW = Math.max(5, Math.min(12, (groupW - 6) / 2));

  let grid = '';
  for (let i = 0; i <= 2; i++) {
    const v = Math.round((maxVal / 2) * i);
    const y = PAD_T + plotH - (v / maxVal) * plotH;
    grid += `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - 6}" y2="${y.toFixed(1)}" stroke="${C.axis}" stroke-width="1"/>`
          + `<text x="${PAD_L - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="${C.muted}" font-size="9" font-family="system-ui">${v}</text>`;
  }

  let bars = '';
  buckets.forEach((b, i) => {
    const cx = PAD_L + i * groupW + groupW / 2;
    const gx = cx - barW - 1;
    const hi = (b.incoming / maxVal) * plotH;
    const hr = (b.resolved / maxVal) * plotH;
    bars += `<rect x="${gx.toFixed(1)}" y="${(PAD_T + plotH - hi).toFixed(1)}" width="${barW}" height="${hi.toFixed(1)}" fill="${C.incoming}" rx="1"><title>${esc(b.name)}: ${b.incoming} new</title></rect>`;
    bars += `<rect x="${(gx + barW + 2).toFixed(1)}" y="${(PAD_T + plotH - hr).toFixed(1)}" width="${barW}" height="${hr.toFixed(1)}" fill="${C.resolved}" rx="1"><title>${esc(b.name)}: ${b.resolved} resolved</title></rect>`;
    const short = esc((b.name || '').split(/\s+/).pop()).slice(0, 5);
    bars += `<text x="${cx.toFixed(1)}" y="${H - PAD_B + 11}" text-anchor="middle" fill="${C.muted}" font-size="9" font-family="system-ui">${short}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${grid}${bars}</svg>`;
}

// ── Panel 2: Open bugs by age ────────────────────────────────────────────────

export function buildBugSnapshotSVG(snap) {
  if (!snap || snap.totalOpen === 0) {
    return `<div style="font-size:var(--fs-caption,10px);color:${C.resolved};text-align:center;padding:12px 0;">✓ No open bugs.</div>`;
  }
  const maxBucket = Math.max(1, ...snap.ageBuckets.map(b => b.count));
  return snap.ageBuckets.map(b => {
    const color = (b.label === '90d+' && b.count > 0) ? C.danger : C.neutral;
    return barRow(b.label, b.count, maxBucket, color, 44);
  }).join('');
}

// ── Panel 3: Reopen rate ─────────────────────────────────────────────────────

function buildReopenPanelBody(reopen) {
  const pct = reopen && reopen.total > 0 ? Math.round(reopen.rate * 100) : null;
  if (pct == null) {
    return `<div style="font-size:var(--fs-caption,10px);color:${C.muted};text-align:center;">No bugs in window.</div>`;
  }
  const color = pct >= 20 ? C.danger : (pct >= 10 ? C.warn : C.resolved);
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <span style="font-size:32px;font-weight:700;line-height:1;color:${color};font-variant-numeric:tabular-nums;">${pct}%</span>
      <span style="font-size:var(--fs-caption,10px);color:${C.muted};">${reopen.reopened} of ${reopen.total} reopened</span>
    </div>`;
}

// ── Panel 4: Open bugs by App ────────────────────────────────────────────────

function buildAppPanelBody(apps) {
  const top = (apps || []).slice(0, 5);
  if (top.length === 0) {
    return `<div style="font-size:var(--fs-caption,10px);color:${C.muted};text-align:center;padding:12px 0;">No App data.</div>`;
  }
  const maxApp = Math.max(1, ...top.map(a => a.count));
  return top.map(a => barRow(a.label, a.count, maxApp, C.neutral, 80)).join('');
}

// ── Full card: 2×2 grid ──────────────────────────────────────────────────────

/**
 * @param {Object} trend  incomingVsResolved()
 * @param {Object} snap   openBugSnapshot()
 * @param {string} scopeLabel  'Squad' | 'Me'
 * @param {Object} [quality]  { reopen, apps }
 */
export function buildBugReportsCard(trend, snap, scopeLabel = '', quality = null) {
  const reopen = quality?.reopen || null;
  const apps = quality?.apps || [];

  // Net-flow badge for the trend panel header.
  const net = trend?.totals?.net ?? 0;
  const netColor = net > 0 ? C.incoming : (net < 0 ? C.resolved : C.muted);
  const netText = net > 0 ? `+${net}` : `${net}`;
  const netBadge = `<span style="font-size:var(--fs-caption,10px);color:${netColor};font-weight:600;">net ${netText}</span>`;

  const older = (trend?.olderIncoming || 0) + (trend?.olderResolved || 0);

  const panel1 = buildPanel(
    `Incoming vs Resolved · ${trend?.buckets?.length || 0} sprints`,
    buildBugTrendSVG(trend),
    netBadge
  );
  const panel2 = buildPanel(
    `Open by age${snap?.totalOpen ? ` · median ${snap.medianAgeDays}d` : ''}`,
    buildBugSnapshotSVG(snap),
    snap?.totalOpen ? `<span style="font-size:var(--fs-caption,10px);color:${C.text};font-weight:600;">${snap.totalOpen} open</span>` : ''
  );
  const panel3 = buildPanel('Reopen rate · 6 sprints', buildReopenPanelBody(reopen));
  const panel4 = buildPanel('Open by app', buildAppPanelBody(apps));

  const scopeBadge = scopeLabel
    ? `<span style="font-size:var(--fs-caption,10px);color:${C.muted};margin-left:auto;
         border:1px solid ${C.axis};border-radius:10px;padding:1px 8px;">${esc(scopeLabel)}</span>`
    : '';

  // Shared legend (applies to panels 1 + 2 colour semantics).
  const legend = `<div style="display:flex;gap:var(--space-3,12px);align-items:center;">
      ${legendDot(C.incoming, 'Incoming')}${legendDot(C.resolved, 'Resolved')}
      ${older > 0 ? `<span style="font-size:var(--fs-caption,10px);color:${C.muted};margin-left:auto;">${older} older than window</span>` : ''}
    </div>`;

  return `
    <div style="background:var(--surface);border:1px solid ${C.axis};border-radius:8px;
                padding:var(--space-3,12px);display:flex;flex-direction:column;
                gap:var(--space-3,12px);width:100%;box-sizing:border-box;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="section-label-std">🐞 Bug Reports</span>${scopeBadge}
      </div>
      ${legend}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3,12px);">
        ${panel1}${panel2}${panel3}${panel4}
      </div>
    </div>`;
}

/** Back-compat: phase-2 quality row is now folded into the grid (panels 3+4). */
export function buildBugQualityRow(reopen, apps) {
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3,12px);">
    ${buildPanel('Reopen rate · 6 sprints', buildReopenPanelBody(reopen))}
    ${buildPanel('Open by app', buildAppPanelBody(apps))}
  </div>`;
}
