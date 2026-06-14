/**
 * src/render/sentry-trend-svg.js — Zealer Dashboard
 *
 * Pure builder for the multi-view Sentry trend card: a sparkline per tracked
 * view over the last ~30 days, with a clickable legend (latest count + day
 * -over-day delta), gap shading for missing days (single-line only), an export
 * dropdown, and an empty/no-data prompt.
 *
 * Pure: takes the series array + the set of hidden view ids, returns an HTML
 * string. No DOM, no module state — the legend-visibility Set lives in popup.js
 * and is passed in, and the hover/legend/export wiring stays in popup.js and
 * binds to the `.trend-point` / `.trend-legend-item` / `.sentry-export-*`
 * elements this produces.
 *
 * Extracted from popup.js (stability S-3 step 5, v2.10.3). Byte-identical to the
 * previous inline implementation when given the same hidden-set.
 */

/** Pure HTML-escape (DOM-free, so this module unit-tests). */
function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const _MS_PER_DAY = 86400000;
const _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _fmtDay = d => `${parseInt(d.slice(8))} ${_MONTHS[parseInt(d.slice(5, 7)) - 1]}`;

/**
 * Build the multi-view Sentry trend card.
 * @param {Array} series  [{ viewId, label, color, samples:[{day:'YYYY-MM-DD', count}] }]
 * @param {Set}   [hiddenViewIds]  view ids the user has toggled off in the legend
 * @returns {string} HTML
 */
export function buildMultiTrendCardHTML(series, hiddenViewIds = new Set()) {
  const visible = series.filter(s => !hiddenViewIds.has(s.viewId));
  const withData = visible.filter(s => s.samples.length > 0);

  // ── Export dropdown menu (always available) ───────────────────────────
  const exportItems =
    series.map(s =>
      `<div class="sentry-export-item" data-view-id="${esc(s.viewId)}"
        style="padding:6px 10px;font-size:11px;color:var(--text);cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px;">
        <span style="width:8px;height:8px;border-radius:2px;background:${s.color};flex-shrink:0;"></span>
        ${esc(s.label)}
      </div>`
    ).join('') +
    (series.length > 1
      ? `<div class="sentry-export-item" data-view-id="__all__"
          style="padding:6px 10px;font-size:11px;color:var(--text);cursor:pointer;white-space:nowrap;border-top:1px solid var(--border,rgba(255,255,255,0.1));font-weight:600;">
          All views (separate files)
        </div>`
      : '');

  const exportControl = `
    <div style="position:relative;flex-shrink:0;">
      <button class="sentry-export-btn" title="Export data & chart" aria-label="Export"
        style="background:none;border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:4px;
               padding:2px 6px;color:var(--text-muted);font-size:10px;cursor:pointer;line-height:1.4;">⬇</button>
      <div class="sentry-export-menu"
        style="display:none;position:absolute;right:0;top:calc(100% + 4px);z-index:99;
               background:var(--surface);border:1px solid var(--border);border-radius:8px;
               box-shadow:0 8px 24px rgba(0,0,0,0.4);min-width:160px;overflow:hidden;">
        <div style="padding:5px 10px;font-size:9px;font-weight:600;color:var(--text-muted);
                    letter-spacing:0.3px;text-transform:uppercase;border-bottom:1px solid var(--border,rgba(255,255,255,0.08));">Export</div>
        ${exportItems}
      </div>
    </div>`;

  // ── Legend (all series; hidden ones greyed + struck through) ──────────
  const legend = series.map(s => {
    const hidden = hiddenViewIds.has(s.viewId);
    const last   = s.samples[s.samples.length - 1];
    const prev   = s.samples[s.samples.length - 2];
    const latest = last ? last.count : '–';
    const delta  = (last && prev) ? last.count - prev.count : 0;
    const dStr   = !last ? '' : delta > 0 ? `↑${delta}` : delta < 0 ? `↓${Math.abs(delta)}` : '=';
    const dCol   = delta > 0 ? '#f97316' : delta < 0 ? '#22c55e' : 'var(--text-muted)';
    return `<div class="trend-legend-item" data-view-id="${esc(s.viewId)}"
        title="Click to ${hidden ? 'show' : 'hide'} this line"
        style="display:flex;align-items:center;gap:5px;cursor:pointer;opacity:${hidden ? '0.4' : '1'};">
        <span style="width:8px;height:8px;border-radius:2px;background:${s.color};flex-shrink:0;"></span>
        <span style="font-size:10px;color:var(--text);${hidden ? 'text-decoration:line-through;' : ''}">${esc(s.label)}</span>
        <span style="font-size:10px;font-weight:600;color:var(--text);">${latest}</span>
        ${dStr ? `<span style="font-size:9px;font-weight:700;color:${dCol};">${dStr}</span>` : ''}
      </div>`;
  }).join('');

  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;
                   text-transform:uppercase;">Sentry Trend · last 30 days</span>
      ${exportControl}
    </div>`;

  const legendRow = `
    <div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:8px;">${legend}</div>`;

  const cardOpen  = `<div class="sentry-trend-wrap" style="position:relative;padding:10px 12px;background:var(--surface,#11131c);border:1px solid var(--border,rgba(255,255,255,0.05));border-radius:8px;"><div class="trend-tooltip" style="display:none;position:absolute;z-index:50;pointer-events:none;transform:translate(-50%,-100%);background:var(--surface-raised,#1f2937);border:1px solid var(--border,rgba(255,255,255,0.15));border-radius:5px;padding:3px 7px;font-size:10px;color:var(--text);white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>`;
  const cardClose = `</div>`;

  // ── No visible data → show header + legend + prompt ───────────────────
  if (withData.length === 0) {
    return `${cardOpen}${header}
      <div style="font-size:12px;color:var(--text-muted);padding:6px 0;">
        Open the panel daily to build trend history${visible.length < series.length ? ' (some lines hidden)' : ''}.
      </div>
      ${legendRow}${cardClose}`;
  }

  // ── Shared axes ───────────────────────────────────────────────────────
  const allDays   = [];
  const allCounts = [];
  withData.forEach(s => s.samples.forEach(p => { allDays.push(p.day); allCounts.push(p.count); }));

  const allMs   = allDays.map(d => new Date(d).getTime());
  const firstMs = Math.min(...allMs);
  const lastMs  = Math.max(...allMs);
  const totalMs = lastMs - firstMs || 1;

  const minVal  = Math.min(...allCounts);
  const maxVal  = Math.max(...allCounts);
  const yPad    = Math.max(Math.ceil(maxVal * 0.15), 3);
  const yMin    = Math.max(0, minVal - yPad);
  const yMax    = maxVal + yPad;
  const yRange  = yMax - yMin || 1;

  const W = 280, H = 70, PAD_L = 4, PAD_R = 4, PAD_T = 8, PAD_B = 20;
  const PW = W - PAD_L - PAD_R, PH = H - PAD_T - PAD_B;
  const pxD = (day) => PAD_L + ((new Date(day).getTime() - firstMs) / totalMs) * PW;
  const py  = (v)   => PAD_T + PH - ((v - yMin) / yRange) * PH;

  const showGaps = withData.length === 1; // gap shading only when single line (keeps multi-line readable)

  let svgParts = '';
  for (const s of withData) {
    const pts = s.samples;

    // Segment by gaps (>1 day) so we never draw a fake line across missing days
    const segs = [];
    let streak = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const diff = Math.round((new Date(pts[i].day) - new Date(pts[i-1].day)) / _MS_PER_DAY);
      if (diff > 1) {
        segs.push({ type: 'data', points: [...streak] });
        segs.push({ type: 'gap', start: pts[i-1].day, end: pts[i].day, days: diff - 1 });
        streak = [pts[i]];
      } else {
        streak.push(pts[i]);
      }
    }
    segs.push({ type: 'data', points: streak });

    if (showGaps) {
      for (const seg of segs) {
        if (seg.type !== 'gap') continue;
        const gx1 = pxD(seg.start), gx2 = pxD(seg.end), gw = Math.max(gx2 - gx1, 2);
        svgParts += `<rect x="${gx1.toFixed(1)}" y="${PAD_T}" width="${gw.toFixed(1)}" height="${PH}" fill="rgba(148,163,184,0.10)" rx="2"/>`;
        if (gw > 32) {
          const mx = ((gx1 + gx2) / 2).toFixed(1), my = (PAD_T + PH / 2).toFixed(1);
          svgParts += `<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="central" fill="var(--text-muted)" font-size="7.5" font-family="system-ui" opacity="0.75">no data · ${seg.days}d</text>`;
        }
      }
    }

    for (const seg of segs) {
      if (seg.type !== 'data' || seg.points.length === 0) continue;
      const segPts = seg.points.map(p => `${pxD(p.day).toFixed(1)},${py(p.count).toFixed(1)}`).join(' ');
      svgParts += `<polyline points="${segPts}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      // Small visible dot on every data point (like the print view), plus a
      // larger transparent "hit" circle that's easy to hover and carries the
      // date/value tooltip text.
      for (const p of seg.points) {
        const cx = pxD(p.day).toFixed(1), cy = py(p.count).toFixed(1);
        svgParts += `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${s.color}"/>`;
        svgParts += `<circle class="trend-point" cx="${cx}" cy="${cy}" r="5" data-info="${esc(s.label)} · ${_fmtDay(p.day)} · ${p.count}"/>`;
      }
    }

    // Slightly larger dot on the latest reading so "today" stands out
    const last = pts[pts.length - 1];
    svgParts += `<circle cx="${pxD(last.day).toFixed(1)}" cy="${py(last.count).toFixed(1)}" r="2.2" fill="${s.color}"/>`;
  }

  // X-axis labels: first date (left), today (right), and a mid-span date when
  // the range is more than 2 days so the timeline has a reference point.
  const firstDay = new Date(firstMs).toISOString().slice(0, 10);
  let xLabels = `<text x="${PAD_L}" y="${H-4}" text-anchor="start" fill="var(--text-muted)" font-size="8.5" font-family="system-ui">${_fmtDay(firstDay)}</text>`;
  const spanDays = Math.round((lastMs - firstMs) / _MS_PER_DAY);
  if (spanDays > 2) {
    const midDay = new Date((firstMs + lastMs) / 2).toISOString().slice(0, 10);
    xLabels += `<text x="${(PAD_L + PW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" fill="var(--text-muted)" font-size="8.5" font-family="system-ui">${_fmtDay(midDay)}</text>`;
  }
  xLabels    += `<text x="${(PAD_L+PW).toFixed(1)}" y="${H-4}" text-anchor="end" fill="var(--text-muted)" font-size="8.5" font-family="system-ui">today</text>`;

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;">
    ${svgParts}
    ${xLabels}
  </svg>`;

  return `${cardOpen}${header}${svg}${legendRow}${cardClose}`;
}
