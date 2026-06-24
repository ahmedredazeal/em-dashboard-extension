/**
 * src/render/support-board-svg.js — Zealer Dashboard
 *
 * Pure builder for the "Support Board Breakdown" card: a horizontal bar per
 * status (In Progress / QA Testing / Open / …) with counts and a blocked
 * -external summary. Used in the Insights screen for support/kanban boards.
 *
 * Pure (boards array in → HTML string out; no DOM, no external deps).
 * Extracted from popup.js (stability S-3 step 4, v2.10.2). Byte-identical to the
 * previous inline implementation.
 *
 * Note: this uses status *display-name* colours (e.g. "QA Testing", "Code
 * Review"), which are board-workflow specific and intentionally distinct from
 * the status-*category* colours in domain-constants.js — so the map stays local.
 */

/** HTML-escape Jira-sourced strings (status names) before they hit innerHTML. */
function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Status display-name → bar colour (support-board workflow specific). */
const STATUS_COLORS = {
  'Open': '#94a3b8',
  'In Progress': '#3b82f6',
  'QA Testing': '#a855f7',
  'QA Rejected': '#ef4444',
  'QA Accepted': '#22c55e',
  'Code Review': '#f97316',
};

/** In-progress statuses first, Open last, everything else alphabetical. */
const STATUS_ORDER = ['In Progress', 'QA Testing', 'QA Rejected', 'Code Review', 'Open'];

/**
 * Build the support board breakdown card.
 * @param {Array} boards  extra-board data: [{ boardLabel, stories:[{status, labels}] }]
 * @returns {string} HTML, or '' if there's no support board with stories.
 */
export function buildSupportBoardChart(boards) {
  // Find first support board
  const sb = boards.find(b => b.boardLabel?.toLowerCase().includes('support'));
  if (!sb || !sb.stories?.length) return '';

  const stories = sb.stories;
  const cardStyle = 'padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;display:flex;flex-direction:column;width:100%;';

  // Count by status name, and track blocked-external + SLA-breached per status
  const byStatus = {};
  const blockedByStatus = {};
  const breachedByStatus = {};
  for (const s of stories) {
    const st = s.status || 'Unknown';
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (s.labels?.includes('blocked-external')) {
      blockedByStatus[st] = (blockedByStatus[st] || 0) + 1;
    }
    if (s.labels?.includes('BreachedSLA')) {
      breachedByStatus[st] = (breachedByStatus[st] || 0) + 1;
    }
  }

  // Sort: in-progress statuses first, open last
  const entries = Object.entries(byStatus).sort(([a], [b]) => {
    const ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const maxCount = Math.max(...entries.map(([, c]) => c), 1);

  const totalBlocked = Object.values(blockedByStatus).reduce((s, n) => s + n, 0);
  const totalBreached = Object.values(breachedByStatus).reduce((s, n) => s + n, 0);
  const rows = entries.map(([status, count]) => {
    const color = STATUS_COLORS[status] || '#6366f1';
    const pct = Math.round(count / maxCount * 100);
    const blocked = blockedByStatus[status] || 0;
    const breached = breachedByStatus[status] || 0;
    // Fixed-width right area (always reserved) — keeps bar width consistent across all rows
    const flags = [
      breached > 0 ? `<span style="font-size:10px;color:#ef4444;font-weight:700;white-space:nowrap;">🔴 ${breached} SLA</span>` : '',
      blocked > 0 ? `<span style="font-size:10px;color:#f59e0b;white-space:nowrap;">⚠ ${blocked}</span>` : '',
    ].filter(Boolean).join(' ');
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
      <div style="width:90px;font-size:10px;color:var(--text-muted);text-align:right;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(status)}</div>
      <div style="flex:1;height:8px;background:var(--border);border-radius:3px;overflow:hidden;min-width:0;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
      <span style="font-size:10px;color:var(--text);width:18px;text-align:right;flex-shrink:0;">${count}</span>
      <div style="width:96px;flex-shrink:0;text-align:left;display:flex;gap:6px;justify-content:flex-start;">${flags}</div>
    </div>`;
  }).join('');

  const breachedSummary = totalBreached > 0
    ? `<div style="margin-top:8px;padding:5px 8px;background:rgba(239,68,68,0.08);border-radius:4px;border:1px solid rgba(239,68,68,0.25);font-size:11px;color:#ef4444;font-weight:600;">🔴 ${totalBreached} ticket${totalBreached>1?'s':''} breached SLA across ${Object.keys(breachedByStatus).length} status${Object.keys(breachedByStatus).length>1?'es':''}</div>`
    : '';

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
      ${breachedSummary}
      ${blockedSummary}
    </div>
  </div>`;
}
