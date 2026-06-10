/**
 * src/burndown.js
 * Computes the three burndown series for a sprint.
 * Pure functions — no side effects.
 *
 * THREE SERIES:
 *
 * 1. Ideal bar  — linear decay: totalPts drops by (totalPts/totalDays) per day.
 *    Represents perfect, evenly-distributed throughput.
 *
 * 2. Estimate bar — decay based on ticket due dates.
 *    On any given day, "remaining" = total - sum(points of tickets due on or before that day).
 *    Represents the team's own commitments as declared via due dates.
 *
 * 3. Actual line — decay based on when tickets actually transitioned to done.
 *    Stories must have a `closedDay` property (set by changelog-parser.attachCloseTimestamps).
 *    Tickets not yet done never leave the "remaining" pool.
 *
 * Each series is an array of length (totalDays + 1).
 * Index 0 = sprint start (day 0 = all points remaining).
 * Index N = after day N (how many points are still open).
 *
 * NOTE: If a ticket was closed BEFORE the sprint started (closedDay < 0),
 *       we treat it as closed on day 0 (counts from the beginning).
 */

import { dayIndex } from './changelog-parser.js';

/**
 * Generate day labels for x-axis display ("5 May", "6 May", …).
 * @param {string} sprintStartDate - ISO date
 * @param {number} totalDays
 * @returns {string[]}
 */
export function sprintDayLabels(sprintStartDate, totalDays) {
  const start = new Date(sprintStartDate);
  return Array.from({ length: totalDays + 1 }, (_, i) => {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  });
}

/**
 * Compute burndown remaining at end of each day.
 * Returns an array of length (totalDays + 1) where index i = remaining points
 * AFTER day i closes (i.e. at the start of day i+1 / end of day i).
 *
 * @param {number}   totalPoints
 * @param {number}   totalDays
 * @param {number[]} closeDays  - Array of day-indices when each point-unit was closed.
 *                                Pass a flat array of day values (one per point, not per ticket).
 * @returns {number[]}
 */
function remainingByDay(totalPoints, totalDays, closeDays) {
  // Count how many points close ON each day
  const burnPerDay = new Array(totalDays + 1).fill(0);
  for (const d of closeDays) {
    const capped = Math.max(0, Math.min(totalDays, d));
    burnPerDay[capped]++;
  }

  // Cumulative: remaining[i] = remaining[i-1] - burnPerDay[i]
  const remaining = new Array(totalDays + 1);
  remaining[0] = totalPoints - burnPerDay[0];
  for (let i = 1; i <= totalDays; i++) {
    remaining[i] = Math.max(0, remaining[i - 1] - burnPerDay[i]);
  }
  return remaining;
}

/**
 * Main export: compute all three burndown series.
 *
 * @param {Object} sprint  - { startDate, totalDays, totalPoints }
 * @param {Array}  stories - Normalised stories, each with:
 *                           { points, dueDate, closedDay } (closedDay may be null)
 * @returns {{
 *   ideal:    number[],
 *   estimate: number[],
 *   actual:   number[],
 *   labels:   string[],
 *   totalPoints: number,
 *   totalDays: number,
 *   hasActualData: boolean
 * }}
 */
export function computeBurndownSeries(sprint, stories) {
  const { startDate, totalDays = 14, totalPoints = 0 } = sprint;
  // committedPoints = the scope at sprint kickoff (may differ from the live
  // sum of story points when estimates are edited or stories added mid-sprint).
  // Fall back to totalPoints so callers that haven't been updated yet still work.
  const committedPoints = sprint.committedPoints || totalPoints;
  // scopeByDay: { [day]: { added, removed, estimateDelta } } — scope changes by day
  const scopeByDay = sprint.scopeByDay || {};

  const _td = totalDays || 14;
  const _rawToday = (typeof sprint.todayIndex === 'number')
    ? sprint.todayIndex
    : (typeof sprint.daysElapsed === 'number') ? sprint.daysElapsed : _td;
  const todayIndex = Math.max(0, Math.min(_rawToday, _td));

  if (!committedPoints && !totalPoints || !totalDays) {
    const empty = new Array((totalDays || 14) + 1).fill(committedPoints || 0);
    return {
      ideal: empty, estimate: empty, actual: empty,
      labels: sprintDayLabels(startDate, totalDays || 14),
      totalPoints: totalPoints || 0, committedPoints: committedPoints || 0,
      totalDays: totalDays || 14, todayIndex, hasActualData: false, perDayData: []
    };
  }

  // ── Ideal ──────────────────────────────────────────────────────────
  // Guideline anchored to committedPoints (the sprint's agreed scope),
  // not the live total — so it never shifts when estimates change.
  const dailyIdeal = committedPoints / totalDays;
  const ideal = Array.from({ length: totalDays + 1 }, (_, d) =>
    Math.max(0, Math.round((committedPoints - dailyIdeal * d) * 10) / 10)
  );

  // ── Estimate (by due date) ──────────────────────────────────────────
  const estimateCloseDays = [];
  for (const s of stories) {
    if (!s.dueDate || !s.points) continue;
    const dDay = dayIndex(s.dueDate, startDate);
    for (let p = 0; p < s.points; p++) estimateCloseDays.push(dDay);
  }
  const estimateTotal = stories.filter(s => s.dueDate && s.points).reduce((a, s) => a + s.points, 0);
  const estimateNoDate = totalPoints - estimateTotal;
  const estimateRaw = remainingByDay(estimateTotal, totalDays, estimateCloseDays);
  const estimate = estimateRaw.map(r => r + estimateNoDate);

  // ── Actual — with scope-change steps ───────────────────────────────
  // Build per-day completion and scope deltas.
  const burnPerDay = new Array(_td + 1).fill(0);
  for (const s of stories) {
    if (s.closedDay === null || s.closedDay === undefined || !s.points) continue;
    const d = Math.max(0, Math.min(s.closedDay, _td));
    burnPerDay[d] += s.points;
  }
  const actualClosed = stories
    .filter(s => s.closedDay !== null && s.closedDay !== undefined)
    .reduce((a, s) => a + (s.points || 0), 0);

  // Net scope change per day (positive = scope grew, negative = scope shrank)
  const scopeNetPerDay = new Array(_td + 1).fill(0);
  let hasScopeChanges = false;
  for (const [dayStr, sc] of Object.entries(scopeByDay)) {
    const dayNum = Number(dayStr);
    if (!Number.isFinite(dayNum)) continue; // guard: a bad key must never silently swallow a scope step
    const d = Math.max(0, Math.min(dayNum, _td));
    const net = (sc.added || 0) - (sc.removed || 0) + (sc.estimateDelta || 0);
    if (net !== 0) { scopeNetPerDay[d] += net; hasScopeChanges = true; }
  }

  // Remaining starts at committedPoints and steps down for completions,
  // up/down for scope changes (both are visible on the chart).
  const actual = new Array(_td + 1);
  actual[0] = committedPoints - burnPerDay[0] + scopeNetPerDay[0];
  for (let i = 1; i <= _td; i++) {
    actual[i] = Math.max(0, actual[i - 1] - burnPerDay[i] + scopeNetPerDay[i]);
  }

  // Per-day detail for hover tooltips and segment colouring.
  const perDayData = Array.from({ length: _td + 1 }, (_, d) => ({
    day: d,
    remaining: actual[d],
    completedDelta: burnPerDay[d],
    scopeNet: scopeNetPerDay[d]  // >0 added, <0 removed/reduced
  }));

  return {
    ideal,
    estimate,
    actual,
    labels: sprintDayLabels(startDate, totalDays),
    totalPoints,
    committedPoints,
    totalDays,
    todayIndex,
    hasActualData: actualClosed > 0 || hasScopeChanges,
    perDayData
  };
}
