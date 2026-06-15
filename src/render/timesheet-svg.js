/**
 * src/render/timesheet-svg.js — Zealer Dashboard
 *
 * Pure builder for the "Time Logged" stacked-bar chart (hours per person,
 * coloured by project), including the over-capacity reference line. Takes the
 * aggregated member array and an optional capacity figure; returns an HTML
 * string (div.ts-wrap > tooltip + svg). No DOM access — the hover wiring
 * (wireTimesheetHover) stays in popup.js and binds to the `.ts-seg` /
 * `.ts-tooltip` / `.ts-wrap` elements this produces.
 *
 * Extracted from popup.js (stability S-3 step 2, v2.9.2). Output is byte
 * -identical to the previous inline implementation.
 */
import { assignProjectColors } from '../worklog-aggregator.js';

/**
 * Pure HTML-escape (the popup uses a DOM-based escapeHtml; this module is
 * DOM-free so it can be unit-tested). Escapes the five XML-significant chars.
 */
function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the Time Logged chart markup.
 * @param {Array}  members  [{ name, total, byProject:{KEY:hours} }]
 * @param {number|{fixed:number, pace:number}} [capacity=0]
 *   - number (legacy): the fixed full-sprint capacity line. Members over it are
 *     flagged ⚠ + amber.
 *   - object: { fixed, pace } draws TWO reference lines — a solid-ish amber
 *     "cap" line at the fixed full-sprint budget (drives the ⚠ over-capacity
 *     flag), and a lighter dotted "pace" marker at the expected-hours-so-far.
 *     Either may be 0/omitted to skip that line.
 * @returns {string} HTML (div.ts-wrap), or '' when there are no members.
 */
export function buildTimesheetSVG(members, capacity = 0) {
  if (!members || members.length === 0) return '';

  // Normalize: a bare number means the fixed cap (legacy callers); an object
  // carries both the fixed budget and the pace-to-date marker.
  const fixedCap = typeof capacity === 'number' ? capacity : (capacity?.fixed || 0);
  const paceMark = typeof capacity === 'number' ? 0          : (capacity?.pace  || 0);
  // The ⚠ over-capacity flag keys off the fixed budget (exceeding your
  // full-sprint capacity is the meaningful warning, not the moving pace line).
  const capacityHours = fixedCap;

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

  // Scale so the longest bar OR either reference line (whichever is largest) fits.
  const maxLogged = Math.max(...members.map(m => m.total || 0), 0.1);
  const maxRef    = Math.max(capacityHours, paceMark);
  const maxTotal  = maxRef > 0 ? Math.max(maxLogged, maxRef) : maxLogged;
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
      const seg = `<rect class="ts-seg" data-ts-name="${esc(m.name || '')}" data-ts-proj="${esc(pk)}" data-ts-hrs="${hrs}" `
                + `x="${segX.toFixed(1)}" y="${y1}" width="${w.toFixed(1)}" height="${BAR_H}" fill="${color}" rx="2" style="cursor:pointer;">`
                + `<title>${esc(m.name || '')} — ${esc(pk)}: ${hrs}h</title></rect>`;
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

  // Capacity reference line — the FIXED full-sprint budget. Dashed amber
  // vertical; bars/names past it are flagged ⚠ above ("over capacity").
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

  // Pace-to-date marker — expected hours per person SO FAR (elapsed working days
  // × rate). A lighter dotted slate line; reference only, no ⚠ flag. Skipped if
  // it would coincide with the fixed cap (e.g. last day of sprint).
  let paceLine = '';
  if (paceMark > 0 && paceMark !== capacityHours) {
    const pxNum = baseX + (paceMark / maxTotal) * PW;
    const px = pxNum.toFixed(1);
    const nearRight = pxNum > baseX + PW * 0.75;
    const labelAnchor = nearRight ? 'end' : 'middle';
    const labelX = nearRight ? Math.min(pxNum + 2, W - 2) : pxNum;
    // Label sits lower (mid-chart) so it doesn't collide with the cap label up top.
    paceLine = `<line x1="${px}" y1="${PAD_TOP - 1}" x2="${px}" y2="${H - PAD_BOT}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="1,3"/>`
             + `<text x="${labelX.toFixed(1)}" y="${(PAD_TOP + 7).toFixed(1)}" text-anchor="${labelAnchor}" fill="#94a3b8" font-size="9" font-weight="600" font-family="system-ui">pace ${paceMark}h</text>`;
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
    ${grid}${ax}${paceLine}${capLine}${rows}${legendSvg}</svg>
  </div>`;
}
