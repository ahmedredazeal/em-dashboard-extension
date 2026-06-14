/**
 * src/render/personal-bars-svg.js — Zealer Dashboard
 *
 * Pure builder for the engineer-mode "personal hours" bar chart: grouped bars
 * across time periods (days/weeks/quarters) showing logged hours, with an
 * optional estimate bar alongside each, a 0/mid/max y-axis, and x-labels that
 * thin out automatically when the series gets dense.
 *
 * Pure (periods array + opts in → SVG string out; no DOM, no external deps).
 * Extracted from popup.js (stability S-3 step 7, v2.10.5). Byte-identical to the
 * previous inline implementation.
 */

/**
 * Build the personal hours bar chart.
 * @param {Array}  periods  [{ label, actual (hours), estimate? }]
 * @param {Object} [opts]
 * @param {boolean} [opts.showEstimate=false]  draw an estimate bar per group + legend
 * @param {string}  [opts.unit='h']            y-axis label unit suffix
 * @param {string}  [opts.primaryColor]        actual-bar colour
 * @param {string}  [opts.estimateColor]       estimate-bar colour
 * @returns {string} SVG markup, or '' for empty input.
 */
export function buildPersonalBarsSVG(periods, opts = {}) {
  if (!periods || periods.length === 0) return '';
  const {
    showEstimate  = false,
    unit          = 'h',
    primaryColor  = 'var(--primary,#6366f1)',
    estimateColor = 'rgba(100,116,139,0.55)',
  } = opts;

  const W = 290, H = 95;
  const ML = 26, MR = 4, MT = 6, MB = 20;
  const CW = W - ML - MR, CH = H - MT - MB;

  const maxVal = Math.max(
    ...periods.map(p => Math.max(p.actual || 0, showEstimate ? (p.estimate || 0) : 0)),
    0.5
  );
  const round1 = v => Math.round(v * 10) / 10;
  const n = periods.length;
  const groupW = CW / n;
  const barsPerGroup = showEstimate ? 2 : 1;
  const barW  = Math.max(2, Math.min(14, (groupW / barsPerGroup) - 2));
  const barGap = showEstimate ? 1 : 0;

  // ── Y axis labels (0, mid, max) ──────────────────────────────────────
  const yLevels = [0, maxVal / 2, maxVal];
  const yLines = yLevels.map(v => {
    const y = MT + CH - (v / maxVal) * CH;
    const lbl = v === 0 ? '0' : `${round1(v)}${unit}`;
    return `<line x1="${ML}" y1="${y.toFixed(1)}" x2="${W - MR}" y2="${y.toFixed(1)}"
        stroke="var(--border,rgba(255,255,255,0.06))" stroke-width="0.5"/>
      <text x="${ML - 3}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle"
        style="font-size:8px;fill:var(--text-muted);">${lbl}</text>`;
  }).join('');

  // ── Bars ─────────────────────────────────────────────────────────────
  const bars = periods.map((p, i) => {
    const cx = ML + i * groupW + groupW / 2;
    let rects = '';

    if (showEstimate) {
      const eh = ((p.estimate || 0) / maxVal) * CH;
      const ex = cx - barW - barGap / 2;
      const ey = MT + CH - eh;
      rects += `<rect x="${ex.toFixed(1)}" y="${ey.toFixed(1)}" width="${barW}" height="${Math.max(0.5, eh).toFixed(1)}"
        rx="1" fill="${estimateColor}"/>`;
    }

    const ah = ((p.actual || 0) / maxVal) * CH;
    const ax = showEstimate ? cx + barGap / 2 : cx - barW / 2;
    const ay = MT + CH - ah;
    rects += `<rect x="${ax.toFixed(1)}" y="${ay.toFixed(1)}" width="${barW}" height="${Math.max(0.5, ah).toFixed(1)}"
      rx="1" fill="${primaryColor}" opacity="0.9"/>`;

    return rects;
  }).join('');

  // ── X axis labels (skip if too dense) ────────────────────────────────
  const every = Math.max(1, Math.ceil(n / 10));
  const xLabels = periods
    .filter((_, i) => i % every === 0 || i === n - 1)
    .map(p => {
      const i = periods.indexOf(p);
      const x = ML + i * groupW + groupW / 2;
      return `<text x="${x.toFixed(1)}" y="${H - 5}" text-anchor="middle"
        style="font-size:8px;fill:var(--text-muted);">${p.label}</text>`;
    }).join('');

  // ── Legend for estimate vs actual ────────────────────────────────────
  const legend = showEstimate ? `
    <rect x="${ML}" y="0" width="7" height="5" fill="${estimateColor}" rx="1"/>
    <text x="${ML + 9}" y="4" style="font-size:7px;fill:var(--text-muted);">Est</text>
    <rect x="${ML + 30}" y="0" width="7" height="5" fill="${primaryColor}" rx="1" opacity="0.9"/>
    <text x="${ML + 40}" y="4" style="font-size:7px;fill:var(--text-muted);">Actual</text>` : '';

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;overflow:visible;"
      preserveAspectRatio="xMidYMid meet">
    ${legend}
    <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + CH}"
      stroke="var(--border,rgba(255,255,255,0.1))" stroke-width="0.5"/>
    ${yLines}
    ${bars}
    ${xLabels}
  </svg>`;
}
