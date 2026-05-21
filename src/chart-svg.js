/**
 * src/chart-svg.js
 * Vanilla SVG chart renderers — no external libs, CSP-safe.
 * Returns HTML strings with embedded <svg> ready for innerHTML injection.
 *
 * Colors use a mix of:
 *   - CSS vars (var(--color-text-secondary), var(--color-border-tertiary)) for theme-aware text/grid
 *   - Hardcoded brand hex for data series (work in both light/dark backgrounds)
 */

// Series colours
const C_IDEAL    = '#94a3b8'; // slate  — dashed
const C_ESTIMATE = '#60a5fa'; // blue
const C_ACTUAL   = '#34d399'; // emerald
const C_WEEK1    = '#6366f1'; // indigo
const C_WEEK2    = '#a78bfa'; // violet
const C_GRID     = 'rgba(148,163,184,0.2)';
const C_TEXT     = 'var(--color-text-secondary, #94a3b8)';

/**
 * Escape an SVG text value.
 */
function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/**
 * Compute nice round step for Y axis given a max value.
 */
function niceStep(maxVal, steps = 4) {
  const raw = maxVal / steps;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1,2,5,10].find(m => m * mag >= raw) || 10;
  return nice * mag;
}

// ─────────────────────────────────────────────────────────────
// BURNDOWN CHART
// ─────────────────────────────────────────────────────────────

/**
 * Render a burndown line chart with 3 series.
 *
 * @param {{
 *   ideal: number[],
 *   estimate: number[],
 *   actual: number[],
 *   labels: string[],
 *   totalPoints: number,
 *   totalDays: number,
 *   hasActualData: boolean
 * }} data
 * @returns {string} HTML string with embedded SVG
 */
export function renderBurndownChart(data) {
  if (!data || !data.totalPoints) {
    return `<div style="padding:20px;text-align:center;font-size:12px;color:${C_TEXT};">No point data available for burndown.</div>`;
  }

  const W = 320, H = 175;
  const PAD = { top: 12, right: 16, bottom: 42, left: 36 };
  const PW = W - PAD.left - PAD.right; // plot width
  const PH = H - PAD.top - PAD.bottom; // plot height

  const { ideal, estimate, actual, labels, totalPoints, totalDays, hasActualData } = data;
  const maxY = totalPoints;
  const step = niceStep(maxY, 4);
  const yMax = Math.ceil(maxY / step) * step;

  function px(day)  { return PAD.left + (day / totalDays) * PW; }
  function py(val)  { return PAD.top  + PH - (Math.max(0, val) / yMax) * PH; }

  function polyline(series, color, dash = '') {
    const pts = series.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  }

  // Y-axis gridlines + labels
  let gridLines = '', yLabels = '';
  for (let v = 0; v <= yMax; v += step) {
    const y = py(v).toFixed(1);
    gridLines += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="${C_GRID}" stroke-width="1"/>`;
    yLabels += `<text x="${PAD.left - 5}" y="${y}" text-anchor="end" dominant-baseline="central" fill="${C_TEXT}" font-size="10" font-family="system-ui,sans-serif">${v}</text>`;
  }

  // X-axis labels — show every 2 days for 14-day sprint, every day for shorter
  let xLabels = '';
  const xStep = totalDays <= 7 ? 1 : 2;
  for (let d = 0; d <= totalDays; d += xStep) {
    const x = px(d).toFixed(1);
    const label = labels[d] || `D${d}`;
    xLabels += `<text x="${x}" y="${H - PAD.bottom + 14}" text-anchor="middle" fill="${C_TEXT}" font-size="10" font-family="system-ui,sans-serif">${esc(label)}</text>`;
  }

  // Legend
  const legendY = H - 8;
  const legend = `
    <line x1="${PAD.left}" y1="${legendY}" x2="${PAD.left + 14}" y2="${legendY}" stroke="${C_IDEAL}" stroke-width="2" stroke-dasharray="4 2"/>
    <text x="${PAD.left + 18}" y="${legendY}" dominant-baseline="central" fill="${C_TEXT}" font-size="10" font-family="system-ui,sans-serif">Ideal</text>
    <line x1="${PAD.left + 54}" y1="${legendY}" x2="${PAD.left + 68}" y2="${legendY}" stroke="${C_ESTIMATE}" stroke-width="2"/>
    <text x="${PAD.left + 72}" y="${legendY}" dominant-baseline="central" fill="${C_TEXT}" font-size="10" font-family="system-ui,sans-serif">By due date</text>
    ${hasActualData ? `
    <line x1="${PAD.left + 140}" y1="${legendY}" x2="${PAD.left + 154}" y2="${legendY}" stroke="${C_ACTUAL}" stroke-width="2"/>
    <text x="${PAD.left + 158}" y="${legendY}" dominant-baseline="central" fill="${C_TEXT}" font-size="10" font-family="system-ui,sans-serif">Actual</text>
    ` : `<text x="${PAD.left + 140}" y="${legendY}" dominant-baseline="central" fill="${C_TEXT}" font-size="10" font-family="system-ui,sans-serif" opacity="0.5">Actual: no data yet</text>`}`;

  // Today marker
  const todayIdx = Math.min(data.totalDays, ideal.findIndex((_, i) => i === data.totalDays - (estimate.filter(v => v > 0).length)));
  // simpler: don't draw today marker since we don't track "today" in the data
  // (can add in Phase 4 when we have sprint.daysElapsed)

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="overflow:visible;" xmlns="http://www.w3.org/2000/svg">
    ${gridLines}
    <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${H - PAD.bottom}" stroke="${C_GRID}" stroke-width="1"/>
    <line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" stroke="${C_GRID}" stroke-width="1"/>
    ${yLabels}
    ${xLabels}
    ${polyline(ideal,    C_IDEAL,    '5 3')}
    ${polyline(estimate, C_ESTIMATE)}
    ${hasActualData ? polyline(actual, C_ACTUAL) : ''}
    ${legend}
  </svg>`;

  return svg;
}

// ─────────────────────────────────────────────────────────────
// TIMESHEET CHART
// ─────────────────────────────────────────────────────────────

/**
 * Render a grouped bar chart: week1 vs week2 hours per member.
 *
 * @param {Array<{ name, week1, week2, total }>} members - sorted by total desc
 * @param {string} week1Label
 * @param {string} week2Label
 * @returns {string} HTML string with embedded SVG
 */
export function renderTimesheetChart(members, week1Label = 'Week 1', week2Label = 'Week 2') {
  if (!members || members.length === 0) {
    return `<div style="padding:20px;text-align:center;font-size:12px;color:${C_TEXT};">No worklog data available for this sprint.</div>`;
  }

  const BAR_GROUP = 36;       // width per person (2 bars + gap)
  const BAR_W     = 14;       // individual bar width
  const BAR_GAP   = 4;        // gap between the two bars in a group
  const GROUP_GAP = 8;        // gap between groups
  const PAD = { top: 12, right: 16, bottom: 52, left: 32 };

  const n  = members.length;
  const PW = n * (BAR_GROUP + GROUP_GAP) - GROUP_GAP;
  const PH = 100;
  const W  = PAD.left + PW + PAD.right;
  const H  = PAD.top + PH + PAD.bottom;

  const maxHours = Math.max(...members.map(m => Math.max(m.week1, m.week2, 0.1)));
  const step  = niceStep(maxHours, 4);
  const yMax  = Math.ceil(maxHours / step) * step;

  function barH(h) { return Math.max(1, (h / yMax) * PH); }
  function barY(h) { return PAD.top + PH - barH(h); }
  function groupX(i) { return PAD.left + i * (BAR_GROUP + GROUP_GAP); }

  // Gridlines + Y labels
  let grid = '', yLabels = '';
  for (let v = 0; v <= yMax; v += step) {
    const y = (PAD.top + PH - (v / yMax) * PH).toFixed(1);
    grid    += `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + PW}" y2="${y}" stroke="${C_GRID}" stroke-width="1"/>`;
    yLabels += `<text x="${PAD.left - 4}" y="${y}" text-anchor="end" dominant-baseline="central" fill="${C_TEXT}" font-size="10" font-family="system-ui,sans-serif">${v}</text>`;
  }

  // Bars + name labels
  let bars = '', nameLabels = '';
  members.forEach((m, i) => {
    const gx = groupX(i);
    const x1 = gx;
    const x2 = gx + BAR_W + BAR_GAP;
    const h1 = barH(m.week1), h2 = barH(m.week2);
    const y1 = barY(m.week1), y2 = barY(m.week2);
    bars += `
      <rect x="${x1}" y="${y1.toFixed(1)}" width="${BAR_W}" height="${h1.toFixed(1)}" fill="${C_WEEK1}" rx="2"/>
      <rect x="${x2}" y="${y2.toFixed(1)}" width="${BAR_W}" height="${h2.toFixed(1)}" fill="${C_WEEK2}" rx="2"/>`;

    // Abbreviated name (first name only)
    const firstName = m.name.split(' ')[0];
    nameLabels += `<text x="${(gx + BAR_W + BAR_GAP / 2).toFixed(1)}" y="${PAD.top + PH + 14}" text-anchor="middle" fill="${C_TEXT}" font-size="10" font-family="system-ui,sans-serif">${esc(firstName)}</text>`;
  });

  // Axes
  const axes = `
    <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + PH}" stroke="${C_GRID}" stroke-width="1"/>
    <line x1="${PAD.left}" y1="${PAD.top + PH}" x2="${PAD.left + PW}" y2="${PAD.top + PH}" stroke="${C_GRID}" stroke-width="1"/>`;

  // Legend
  const legendY = H - 12;
  const legend = `
    <rect x="${PAD.left}" y="${legendY - 6}" width="10" height="10" fill="${C_WEEK1}" rx="2"/>
    <text x="${PAD.left + 14}" y="${legendY}" dominant-baseline="central" fill="${C_TEXT}" font-size="10" font-family="system-ui,sans-serif">${esc(week1Label)}</text>
    <rect x="${PAD.left + 70}" y="${legendY - 6}" width="10" height="10" fill="${C_WEEK2}" rx="2"/>
    <text x="${PAD.left + 84}" y="${legendY}" dominant-baseline="central" fill="${C_TEXT}" font-size="10" font-family="system-ui,sans-serif">${esc(week2Label)}</text>`;

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="overflow:visible;" xmlns="http://www.w3.org/2000/svg">
    ${grid}
    ${axes}
    ${yLabels}
    ${bars}
    ${nameLabels}
    ${legend}
  </svg>`;

  return svg;
}
