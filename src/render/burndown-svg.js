/**
 * src/render/burndown-svg.js — Zealer Dashboard
 *
 * Pure builder for the sprint burndown chart. Takes a burndown data object
 * (from src/burndown.js computeBurndownSeries) and returns an HTML string
 * containing the SVG + an empty tooltip div. No DOM access — the hover wiring
 * (wireBurndownHover) stays in popup.js and binds to the `.bd-point` / `.bd
 * -tooltip` elements this produces.
 *
 * Extracted from popup.js (stability S-3, v2.9.1) so the bug-prone burndown
 * rendering is unit-testable. Output is byte-identical to the previous inline
 * implementation.
 */

/** Chart colours. */
export const BD_COLORS = {
  ideal: '#94a3b8', estimate: '#60a5fa', actual: '#34d399',
  week1: '#6366f1', week2: '#a78bfa',
  grid: 'rgba(148,163,184,0.2)', text: 'var(--color-text-secondary,#94a3b8)',
};

/** "Nice" axis step (1/2/5 × 10ⁿ) for a given max and target tick count. */
export function niceStep(max, steps = 4) {
  if (!max) return 1;
  const raw = max / steps;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return ([1, 2, 5, 10].find(m => m * mag >= raw) || 10) * mag;
}

/**
 * Build the burndown chart markup.
 * @param {Object} bd  computeBurndownSeries output:
 *   { ideal[], estimate[], actual[], labels[], totalPoints, committedPoints,
 *     totalDays, hasActualData, todayIndex, perDayData[] }
 * @returns {string} HTML (div.bd-wrap > svg + div.bd-tooltip)
 */
export function buildBurndownSVG(bd) {
  const _C = BD_COLORS;
  const W = 320, H = 150, PAD = { top: 10, right: 16, bottom: 38, left: 36 };
  const PW = W - PAD.left - PAD.right, PH = H - PAD.top - PAD.bottom;
  const { ideal, estimate, actual, labels, totalPoints, committedPoints: bdCommitted,
          totalDays, hasActualData, todayIndex, perDayData = [] } = bd;
  // yMax is based on the committed baseline so the guideline always fits;
  // also accommodate actual peaks from scope additions.
  const peakVal = Math.max(bdCommitted || totalPoints,
    ...actual.slice(0, Math.min((todayIndex ?? actual.length - 1) + 1, actual.length)));
  const step = niceStep(peakVal, 4);
  const yMax = Math.ceil(peakVal / step) * step || 1;
  const px = d => PAD.left + (d / totalDays) * PW;
  const py = v => PAD.top + PH - (Math.max(0, v) / yMax) * PH;
  const poly = (arr, col, dash = '') => {
    const pts = arr.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  };
  let grid = '', ylbl = '';
  for (let v = 0; v <= yMax; v += step) {
    const y = py(v).toFixed(1);
    grid += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="${_C.grid}" stroke-width="1"/>`;
    ylbl += `<text x="${PAD.left - 4}" y="${y}" text-anchor="end" dominant-baseline="central" fill="${_C.text}" font-size="10" font-family="system-ui">${v}</text>`;
  }
  const xStep = totalDays <= 7 ? 1 : 2;
  let xlbl = '';
  for (let d = 0; d <= totalDays; d += xStep) {
    const lbl = (labels && labels[d]) ? labels[d].replace(/\s\d{4}$/, '') : `D${d}`;
    xlbl += `<text x="${px(d).toFixed(1)}" y="${H - PAD.bottom + 14}" text-anchor="middle" fill="${_C.text}" font-size="10" font-family="system-ui">${lbl}</text>`;
  }
  const ly = H - 8;
  const legend = `
    <line x1="${PAD.left}" y1="${ly}" x2="${PAD.left + 14}" y2="${ly}" stroke="${_C.ideal}" stroke-width="2" stroke-dasharray="4 2"/>
    <text x="${PAD.left + 18}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="10" font-family="system-ui">Committed</text>
    <line x1="${PAD.left + 82}" y1="${ly}" x2="${PAD.left + 96}" y2="${ly}" stroke="${_C.estimate}" stroke-width="2"/>
    <text x="${PAD.left + 100}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="10" font-family="system-ui">By due date</text>
    ${hasActualData ? `
    <line x1="${PAD.left + 172}" y1="${ly}" x2="${PAD.left + 186}" y2="${ly}" stroke="#639922" stroke-width="2"/>
    <text x="${PAD.left + 190}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="10" font-family="system-ui">Done</text>
    <line x1="${PAD.left + 220}" y1="${ly}" x2="${PAD.left + 234}" y2="${ly}" stroke="#BA7517" stroke-width="2"/>
    <text x="${PAD.left + 238}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="10" font-family="system-ui">+Scope</text>
    ` : `<text x="${PAD.left + 172}" y="${ly}" dominant-baseline="central" fill="${_C.text}" font-size="9" opacity="0.5">Remaining: no data yet</text>`}`;
  // Actual line — drawn ONLY up to today (Jira-style: remaining work stops at
  // "now"; future days show just the guideline/estimate). Without this the
  // actual line runs flat across the whole sprint and looks like a straight line.
  let actualSvg = '', actualHit = '';
  if (hasActualData) {
    const ti = (typeof todayIndex === 'number') ? Math.max(0, Math.min(todayIndex, totalDays)) : totalDays;
    const actualToToday = actual.slice(0, ti + 1);
    // Segment colours encode the cause of each day's change:
    //  green  — work completed (the classic burn)
    //  amber  — scope added mid-sprint (remaining steps up)
    //  blue dashed — scope removed or estimate reduced (remaining drops for non-work reasons)
    const SEG = { done: '#639922', add: '#BA7517', remove: '#378ADD' };
    for (let d = 1; d <= ti; d++) {
      const pd = perDayData[d] || {};
      const sNet = pd.scopeNet || 0;
      let col = SEG.done, dash = '';
      if (sNet > 0)                            { col = SEG.add; }
      else if (sNet < 0 && !pd.completedDelta) { col = SEG.remove; dash = '5 3'; }
      actualSvg += `<polyline points="${px(d - 1).toFixed(1)},${py(actual[d - 1]).toFixed(1)} ${px(d).toFixed(1)},${py(actual[d]).toFixed(1)}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    }
    // Dot at today's remaining — visible even when only day 0 exists
    const lastV = actualToToday[actualToToday.length - 1];
    actualSvg += `<circle cx="${px(ti).toFixed(1)}" cy="${py(lastV).toFixed(1)}" r="2.5" fill="${SEG.done}"/>`;
    // Invisible hover targets with date, completed, and scope info
    const _fmtPts = n => { const a = Math.abs(n); return Number.isInteger(a) ? `${a}` : a.toFixed(1); };
    for (let d = 0; d <= ti; d++) {
      const v = actual[d];
      const dateLbl = (labels && labels[d]) ? labels[d].replace(/\s(\d{4})$/, ', $1') : `Day ${d}`;
      const pd = perDayData[d] || {};
      // Line 1: date. Line 2: change summary (one or more causes).
      let parts = [];
      if (d === 0) {
        parts.push(`${_fmtPts(v)} ${v === 1 ? 'point' : 'points'} committed`);
      } else {
        const comp = pd.completedDelta || 0;
        const sNet = pd.scopeNet || 0;
        if (comp > 0) parts.push(`${_fmtPts(comp)} ${comp === 1 ? 'point' : 'points'} completed`);
        if (sNet > 0) parts.push(`+${_fmtPts(sNet)} scope added`);
        if (sNet < 0) parts.push(`${_fmtPts(Math.abs(sNet))} pts scope reduced`);
        if (parts.length === 0) parts.push('No change');
      }
      actualHit += `<circle class="bd-point" cx="${px(d).toFixed(1)}" cy="${py(v).toFixed(1)}" r="6" data-date="${dateLbl}" data-change="${parts.join(' · ')}"/>`;
    }
  }
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
    ${grid}<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${H - PAD.bottom}" stroke="${_C.grid}" stroke-width="1"/>
    <line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" stroke="${_C.grid}" stroke-width="1"/>
    ${ylbl}${xlbl}${poly(ideal, _C.ideal, '5 3')}${poly(estimate, _C.estimate)}
    ${actualSvg}${actualHit}${legend}</svg>`;
  return `<div class="bd-wrap" style="position:relative;">${svg}<div class="bd-tooltip" style="display:none;position:absolute;z-index:50;pointer-events:none;background:var(--surface-raised,#1f2937);border:1px solid var(--border,rgba(255,255,255,0.15));border-radius:6px;padding:5px 9px;font-size:11px;line-height:1.35;color:var(--text);white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,0.45);"></div></div>`;
}
