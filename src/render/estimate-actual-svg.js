/**
 * src/render/estimate-actual-svg.js — Zealer Dashboard
 *
 * Pure builder for the "Estimate vs Actual" card: per-member horizontal bars
 * comparing logged hours (solid) against estimated time (thin underbar), with an
 * over/under ratio badge (×1.3+ over in orange, ×0.7− under in green).
 *
 * Pure (members array + optional date-range label in → HTML out; no DOM, no
 * external deps). Extracted from popup.js (stability S-3 step 6, v2.10.4).
 * Byte-identical to the previous inline implementation.
 *
 * NOTE (carried over from the audit, Hat 2 / item 2.3): this card compares
 * story-point estimates against logged HOURS — different units — so the ratio is
 * a rough signal, not a precise estimate-accuracy metric. Parked for rework
 * under the bug-charts ideation; the extraction here is behaviour-preserving and
 * does not change that semantics.
 */

/**
 * Build the Estimate vs Actual card.
 * @param {Array}  members    [{ name, total (logged hrs), estimated, estimateRatio }]
 * @param {string} [dateRange] optional date-range label shown under the title
 * @returns {string} HTML
 */
export function buildEstimateVsActualCard(members, dateRange) {
  const cardStyle = 'padding:10px 12px;background:var(--surface);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;display:flex;flex-direction:column;width:100%;';
  const maxVal = Math.max(...members.map(m => Math.max(m.total, m.estimated || 0)), 0.1);
  const W = 280, NAME_W = 100, PW = W - NAME_W - 8;
  const bw = h => Math.max(1, (h / maxVal) * PW);

  let rows = '';
  members.filter(m => m.total > 0).forEach((m, i) => {
    const y1 = 8 + i * 22;
    const name = (m.name || '').length > 14 ? m.name.slice(0, 13) + '…' : (m.name || '');
    const wActual   = bw(m.total);
    const wEstimate = m.estimated > 0 ? bw(m.estimated) : 0;
    const ratio = m.estimateRatio;
    const ratioColor = !ratio ? 'var(--text-muted)' : ratio > 1.3 ? '#f97316' : ratio < 0.7 ? '#22c55e' : 'var(--text-muted)';
    const ratioTxt = ratio ? `×${ratio.toFixed(1)}` : '';
    rows += `
      <text x="${NAME_W-5}" y="${y1+5}" text-anchor="end" dominant-baseline="central" fill="var(--text)" font-size="9.5" font-family="system-ui">${name}</text>
      <rect x="${NAME_W}" y="${y1}" width="${wActual.toFixed(1)}" height="6" fill="#6366f1" rx="2" opacity="0.85"/>
      ${wEstimate > 0 ? `<rect x="${NAME_W}" y="${y1+7}" width="${wEstimate.toFixed(1)}" height="3" fill="var(--text-muted)" rx="1" opacity="0.4"/>` : ''}
      <text x="${NAME_W+wActual+3}" y="${y1+3}" dominant-baseline="central" fill="${ratioColor}" font-size="9" font-family="system-ui">${ratioTxt}</text>`;
  });

  const H = 8 + members.length * 22 + 20;
  const legend = `<text x="${NAME_W}" y="${H-6}" fill="var(--text-muted)" font-size="9" font-family="system-ui">■ Logged</text><text x="${NAME_W+50}" y="${H-6}" fill="var(--text-muted)" font-size="9" font-family="system-ui">— Estimated</text><text x="${NAME_W+130}" y="${H-6}" fill="#f97316" font-size="9" font-family="system-ui">×1.3+ over</text><text x="${NAME_W+190}" y="${H-6}" fill="#22c55e" font-size="9" font-family="system-ui">×0.7− under</text>`;

  return `<div style="${cardStyle}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
      <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">ESTIMATE VS ACTUAL</span>
    </div>
    ${dateRange ? `<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">${dateRange}</div>` : ''}
    <svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">${rows}${legend}</svg>
  </div>`;
}
