/**
 * src/render/progress-svg.js — Zealer Dashboard
 *
 * Pure builders for the two progress visualisations:
 *
 * - buildDonut        — SVG donut chart (engineer progress circles, milestone
 *                       summary cards). Segments + centre text.
 * - buildMiniProgressBar — compact inline progress bar + metric pills (done %,
 *                       in-flight count, unassigned, risk text, SLA breaches).
 *                       Used by board summaries, sprint-health cards, and
 *                       collapsedBoardSummary.
 *
 * Both functions are pure (data in → HTML/SVG string out; no DOM access) and
 * have no external dependencies, so they are easily unit-testable.
 *
 * Extracted from popup.js (stability S-3 step 3, v2.9.4). Output is byte
 * -identical to the previous inline implementations.
 */

/**
 * Build a donut chart SVG.
 * @param {Object} opts
 * @param {Array}  opts.segments    [{value:number, color:string}]
 * @param {string} opts.centerMain  large centre label (e.g. "3/8")
 * @param {string} opts.centerSub   small centre sub-label (e.g. "tickets")
 * @param {number} [opts.size=80]   overall diameter in px
 * @param {number} [opts.strokeW=14] ring stroke width in px
 * @returns {string} SVG markup, or '' when all segment values are 0.
 */
export function buildDonut({ segments, centerMain, centerSub, size = 80, strokeW = 14 }) {
  const r    = (size - strokeW) / 2;
  const circ = 2 * Math.PI * r;
  const cx   = size / 2;
  const cy   = size / 2;
  const total = segments.reduce((s, g) => s + g.value, 0);
  if (total === 0) return '';

  // Start at 12 o'clock
  const startOff = circ / 4;
  let accumulated = 0;

  const track = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
    stroke="var(--surface-raised,#1f2937)" stroke-width="${strokeW}"/>`;

  const arcs = segments.map(seg => {
    const dash   = (seg.value / total) * circ;
    const gap    = circ - dash;
    const offset = startOff - accumulated;
    accumulated += dash;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${seg.color}" stroke-width="${strokeW}"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      stroke-dashoffset="${offset.toFixed(2)}"
      style="transform-origin:center;transition:stroke-dasharray .3s ease;"/>`;
  });

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    ${track}
    ${arcs.join('')}
    <text x="${cx}" y="${cy - 1}" text-anchor="middle" dominant-baseline="middle"
      style="font-size:12px;font-weight:700;fill:var(--text);">${centerMain}</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle"
      style="font-size:9px;fill:var(--text-muted);">${centerSub}</text>
  </svg>`;
}

/**
 * Build a compact inline progress bar + metric pills.
 * @param {Array}  stories  ticket objects with {statusCategory, points, assignee}
 * @param {Object} [opts]
 * @param {boolean} [opts.showUnassigned]  show unassigned count pill
 * @param {string}  [opts.riskText]        amber risk warning text (e.g. "behind pace")
 * @param {number}  [opts.blockedCount]    external-blocker count
 * @param {number}  [opts.breachedCount]   SLA-breached count
 * @returns {string} HTML markup.
 */
export function buildMiniProgressBar(stories, opts = {}) {
  if (!stories || stories.length === 0) {
    return `<span style="font-size:11px;color:var(--text-muted);">No tickets</span>`;
  }

  const totalPoints = stories.reduce((s, t) => s + (t.points || 0), 0);
  const usePoints   = totalPoints > 0;

  let donePts, inProgPts, openPts, total;
  if (usePoints) {
    donePts   = stories.filter(s => s.statusCategory === 'done').reduce((sum, s) => sum + (s.points || 0), 0);
    inProgPts = stories.filter(s => s.statusCategory === 'indeterminate').reduce((sum, s) => sum + (s.points || 0), 0);
    openPts   = totalPoints - donePts - inProgPts;
    total     = totalPoints;
  } else {
    donePts   = stories.filter(s => s.statusCategory === 'done').length;
    inProgPts = stories.filter(s => s.statusCategory === 'indeterminate').length;
    openPts   = stories.length - donePts - inProgPts;
    total     = stories.length;
  }

  const donePct = total > 0 ? Math.round(donePts  / total * 100) : 0;
  const ipPct   = total > 0 ? Math.round(inProgPts / total * 100) : 0;
  const openPct = Math.max(0, 100 - donePct - ipPct);

  // In-flight count (tickets, not points — easier to action)
  const inFlightTickets = stories.filter(s => s.statusCategory === 'indeterminate').length;

  // Unassigned count
  const unassigned = stories.filter(s => !s.assignee && s.statusCategory !== 'done').length;

  const doneBar = donePct > 0 ? `<div style="width:${donePct}%;background:#22c55e;border-radius:2px;min-width:1px;"></div>` : '';
  const ipBar   = ipPct   > 0 ? `<div style="width:${ipPct}%;background:#3b82f6;border-radius:2px;min-width:1px;"></div>` : '';
  const openBar = openPct > 0 ? `<div style="flex:1;background:rgba(148,163,184,0.2);border-radius:2px;min-width:1px;"></div>` : '';

  // Build the metric pills (right of the bar)
  const pills = [];
  pills.push(`<span style="color:var(--text);font-weight:600;">${donePct}%</span> <span style="color:var(--text-muted);">done</span>`);
  if (inFlightTickets > 0) {
    pills.push(`<span style="color:#3b82f6;font-weight:600;">${inFlightTickets}</span> <span style="color:var(--text-muted);">in flight</span>`);
  }
  if (opts.showUnassigned && unassigned > 0) {
    pills.push(`<span style="color:#f59e0b;font-weight:600;">${unassigned}</span> <span style="color:var(--text-muted);">unassigned</span>`);
  }
  if (opts.riskText) {
    pills.push(`<span style="color:#f97316;font-weight:600;">⚠ ${opts.riskText}</span>`);
  }
  if (opts.blockedCount && opts.blockedCount > 0) {
    pills.push(`<span style="color:#f59e0b;font-weight:600;">⚠ ${opts.blockedCount} blocked-external</span>`);
  }
  if (opts.breachedCount && opts.breachedCount > 0) {
    pills.push(`<span style="color:#ef4444;font-weight:700;">🔴 ${opts.breachedCount} SLA</span>`);
  }

  return `
    <div style="display:flex;align-items:center;gap:8px;margin-top:4px;font-size:11px;">
      <div style="display:flex;height:5px;border-radius:3px;overflow:hidden;gap:1px;background:rgba(148,163,184,0.1);width:60px;flex-shrink:0;">
        ${doneBar}${ipBar}${openBar}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        ${pills.join('<span style="color:var(--text-muted);">·</span>')}
      </div>
    </div>`;
}
