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
  const PAD_TOP = 24;  // headroom for the Cap/Pace labels above the reference lines
  const PAD_BOT = 28;  // room for legend
  const H = PAD_TOP + members.length * ROW_H + PAD_BOT;

  // Scale so the longest bar OR either reference line (whichever is largest) fits.
  // When the Time Utilization overlay is active, a member's busy hours can exceed
  // their logged hours, so the scale must accommodate busy too (kept in-bounds).
  const anyBusy = members.some(m => (m.busyHours || 0) > 0);
  const maxLogged = Math.max(...members.map(m => Math.max(m.total || 0, m.busyHours || 0)), 0.1);
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
    // Time Utilization overlay: a hatched slate sub-bar beneath the logged bar
    // showing meeting/busy hours (durations only — no titles). Drawn only when
    // this member has busy hours, so the chart is unchanged when the overlay is
    // off. A faint busy total sits under the logged total.
    const busy = m.busyHours || 0;
    let busySvg = '';
    if (busy > 0) {
      const bwBusy = bw(busy);
      busySvg = `<rect class="ts-busy" data-ts-name="${esc(m.name || '')}" data-ts-busy="${busy}" `
              + `x="${baseX}" y="${(y1 + BAR_H + 0.5).toFixed(1)}" width="${bwBusy.toFixed(1)}" height="3.5" fill="url(#tsBusyHatch)" rx="1">`
              + `<title>${esc(m.name || '')} — meetings: ${busy}h</title></rect>`
              + `<text x="${(segX + 3).toFixed(1)}" y="${(y1 + BAR_H + 4).toFixed(1)}" dominant-baseline="central" fill="#94a3b8" font-size="8" font-family="system-ui">${busy}h</text>`;
    }
    // Days off (all-day / OOO / vacation) — a small icon + count beside the name,
    // kept OUT of the busy hours so a vacation doesn't inflate the bar.
    const daysOff = m.daysOff || 0;
    const offSvg = daysOff > 0
      ? `<text x="2" y="${y1 + BAR_H / 2 + 1}" dominant-baseline="central" font-size="9" font-family="system-ui" fill="#f59e0b">`
        + `<title>${esc(m.name || '')} — ${daysOff} day${daysOff > 1 ? 's' : ''} off (excluded from meeting hours)</title>🌴${daysOff}</text>`
      : '';
    rows += `
      ${offSvg}<text x="${NAME_W - 5}" y="${y1 + BAR_H/2 + 1}" text-anchor="end" dominant-baseline="central" fill="${nameColor}" font-size="9.5" font-family="system-ui">${displayName}</text>
      ${segSvg}${busySvg}
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

  // Reference lines share the SAME vertical extent (PAD_TOP-1 → H-PAD_BOT) and
  // the SAME label level (top), so cap and pace read as equal-height verticals.
  const LINE_Y1 = (PAD_TOP - 1).toFixed(1);
  const LINE_Y2 = (H - PAD_BOT).toFixed(1);
  const LABEL_Y = PAD_TOP - 8;

  const cxNum = capacityHours > 0 ? baseX + (capacityHours / maxTotal) * PW : null;
  const pxNum = (paceMark > 0 && paceMark !== capacityHours) ? baseX + (paceMark / maxTotal) * PW : null;

  // Capacity reference line — the FIXED full-sprint budget. Dashed amber
  // vertical; bars/names past it are flagged ⚠ above ("over capacity").
  let capLine = '';
  if (cxNum !== null) {
    const cx = cxNum.toFixed(1);
    const nearRight = cxNum > baseX + PW * 0.75;
    const labelAnchor = nearRight ? 'end' : 'middle';
    const labelX = nearRight ? Math.min(cxNum + 5, W - 2) : cxNum;
    capLine = `<line x1="${cx}" y1="${LINE_Y1}" x2="${cx}" y2="${LINE_Y2}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3"/>`
            + `<text x="${labelX.toFixed(1)}" y="${LABEL_Y}" text-anchor="${labelAnchor}" fill="#f59e0b" font-size="10" font-weight="600" font-family="system-ui">Cap ${capacityHours}h</text>`;
  }

  // Pace-to-date marker — expected hours per person SO FAR (elapsed working days
  // × rate). Slate dashed line, same height as the cap; reference only, no ⚠.
  // Suppressed when it coincides with the cap (e.g. last day of the sprint).
  let paceLine = '';
  if (pxNum !== null) {
    const px = pxNum.toFixed(1);
    const nearRight = pxNum > baseX + PW * 0.75;
    const labelAnchor = nearRight ? 'end' : 'middle';
    const labelX = nearRight ? Math.min(pxNum + 5, W - 2) : pxNum;
    // Both labels live at the top; if the two lines are close enough that the
    // labels would overlap, stack the pace label one line higher instead of
    // dropping it mid-chart (which made the pace line look "shorter").
    const close = cxNum !== null && Math.abs(cxNum - pxNum) < 44;
    const paceLabelY = close ? LABEL_Y - 9 : LABEL_Y;
    paceLine = `<line x1="${px}" y1="${LINE_Y1}" x2="${px}" y2="${LINE_Y2}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="2,2"/>`
             + `<text x="${labelX.toFixed(1)}" y="${paceLabelY.toFixed(1)}" text-anchor="${labelAnchor}" fill="#94a3b8" font-size="9" font-weight="600" font-family="system-ui">Pace ${paceMark}h</text>`;
  }

  // Legend: show the largest projects BY HOURS (not alphabetical), so the
  // dominant project — e.g. the squad's main board — is always represented.
  const ly = H - 10;
  let legendX = baseX;
  const projectTotals = {};
  members.forEach(m => Object.entries(m.byProject || {}).forEach(([k, v]) => {
    projectTotals[k] = (projectTotals[k] || 0) + (v || 0);
  }));
  const legendItems = Object.keys(projectTotals).sort((a, b) => projectTotals[b] - projectTotals[a]).slice(0, anyBusy ? 3 : 4);
  let legendSvg = legendItems.map(pk => {
    const color = colorMap[pk];
    const label = pk.length > 8 ? pk.slice(0, 7) + '…' : pk;
    const item = `<rect x="${legendX}" y="${ly - 5}" width="8" height="7" fill="${color}" rx="1"/><text x="${legendX + 11}" y="${ly}" dominant-baseline="central" fill="var(--text-muted)" font-size="8.5" font-family="system-ui">${label}</text>`;
    legendX += 48;
    return item;
  }).join('');
  // Busy swatch (hatched) when the utilization overlay is active.
  if (anyBusy) {
    legendSvg += `<rect x="${legendX}" y="${ly - 5}" width="8" height="7" fill="url(#tsBusyHatch)" rx="1"/><text x="${legendX + 11}" y="${ly}" dominant-baseline="central" fill="var(--text-muted)" font-size="8.5" font-family="system-ui">meetings</text>`;
  }

  // Diagonal-hatch pattern marks busy/meeting time, visually distinct from the
  // solid project colours. Defined only when the overlay is active.
  const defs = anyBusy
    ? `<defs><pattern id="tsBusyHatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
         <rect width="4" height="4" fill="#94a3b8" fill-opacity="0.18"/>
         <line x1="0" y1="0" x2="0" y2="4" stroke="#94a3b8" stroke-width="1.4"/></pattern></defs>`
    : '';

  return `<div class="ts-wrap" style="position:relative;">
    <div class="ts-tooltip" style="display:none;position:absolute;z-index:20;pointer-events:none;
      background:var(--surface-raised,#1f2937);border:1px solid var(--border,rgba(255,255,255,0.12));
      border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text,#e2e8f0);white-space:nowrap;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);transform:translate(-50%,-100%);"></div>
    <svg viewBox="0 -8 ${W} ${H + 12}" width="100%" xmlns="http://www.w3.org/2000/svg">
    ${defs}${grid}${ax}${paceLine}${capLine}${rows}${legendSvg}</svg>
  </div>`;
}
