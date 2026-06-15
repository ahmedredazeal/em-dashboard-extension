/**
 * src/bug-reports.js — Zealer Dashboard (T-BR-1, phase 1)
 *
 * Pure metrics for the Bug Reports insights card. No DOM, no network — takes
 * normalized bug objects + sprint windows and returns plottable series, so it
 * unit-tests cleanly.
 *
 * A "bug" here is any issue of type Bug or QA Bug (the fetch layer applies that
 * JQL filter; this module just consumes the results). Each normalized bug is:
 *   { key, summary, created, resolved, status, priority, assigneeAccountId, done }
 * where `created`/`resolved` are ISO date strings (resolved may be null) and
 * `done` is whether the bug is currently in a resolved/closed state.
 */

/** Parse an ISO date to a midnight-local Date, or null. */
function day(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10));
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Whole calendar days between two Dates (b - a), floored. */
function daysBetween(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Chart 1 — Incoming vs Resolved, bucketed by actual sprint [start, end) windows.
 *
 * @param {Array}  bugs     normalized bugs (need created + resolved)
 * @param {Array}  sprints  sprint history objects { name, startDate, endDate }
 *                          — typically the last 6 closed sprints, any order.
 * @returns {{ buckets: Array<{name, start, end, incoming, resolved, net}>,
 *             totals: {incoming, resolved, net}, olderResolved, olderIncoming }}
 *   buckets are returned oldest → newest. `net` = incoming - resolved (>0 grows
 *   the backlog). olderIncoming/olderResolved count bugs whose date falls before
 *   the earliest window (shown as an "older" note, not plotted).
 */
export function incomingVsResolved(bugs, sprints) {
  const windows = (sprints || [])
    .map(s => ({ name: s.name || '', start: day(s.startDate), end: day(s.endDate) }))
    .filter(w => w.start && w.end)
    .sort((a, b) => a.start - b.start);

  const buckets = windows.map(w => ({
    name: w.name, start: w.start, end: w.end, incoming: 0, resolved: 0, net: 0,
  }));

  if (buckets.length === 0) {
    return { buckets: [], totals: { incoming: 0, resolved: 0, net: 0 }, olderIncoming: 0, olderResolved: 0 };
  }

  const earliest = buckets[0].start;
  let olderIncoming = 0, olderResolved = 0;

  // Bucket a date into the sprint window that contains it: [start, end).
  // The last window is treated as inclusive of its end so a bug created/resolved
  // exactly on the final day still counts.
  const place = (d) => {
    if (!d) return -1;
    for (let i = 0; i < buckets.length; i++) {
      const isLast = i === buckets.length - 1;
      if (d >= buckets[i].start && (isLast ? d <= buckets[i].end : d < buckets[i].end)) return i;
    }
    return -1;
  };

  for (const b of bugs || []) {
    const cd = day(b.created);
    if (cd) {
      const i = place(cd);
      if (i >= 0) buckets[i].incoming++;
      else if (cd < earliest) olderIncoming++;
    }
    const rd = day(b.resolved);
    if (rd) {
      const i = place(rd);
      if (i >= 0) buckets[i].resolved++;
      else if (rd < earliest) olderResolved++;
    }
  }

  let ti = 0, tr = 0;
  for (const bk of buckets) { bk.net = bk.incoming - bk.resolved; ti += bk.incoming; tr += bk.resolved; }

  return {
    buckets,
    totals: { incoming: ti, resolved: tr, net: ti - tr },
    olderIncoming, olderResolved,
  };
}

/** Age buckets for the open-bug snapshot. */
export const AGE_BUCKETS = [
  { label: '0–7d',  min: 0,  max: 7 },
  { label: '8–30d', min: 8,  max: 30 },
  { label: '31–90d', min: 31, max: 90 },
  { label: '90d+',  min: 91, max: Infinity },
];

/**
 * Chart 2 — Open-bug snapshot: age buckets + median age + priority split.
 *
 * @param {Array} bugs  normalized bugs
 * @param {Date}  [now] reference "today" (defaults to now), for testability
 * @returns {{ totalOpen, medianAgeDays, ageBuckets: Array<{label,count}>,
 *             byPriority: Array<{priority,count}> }}
 *   Only bugs that are NOT done are counted. medianAgeDays is calendar days
 *   from created → now (wall-clock, the convention for bug age).
 */
export function openBugSnapshot(bugs, now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);

  const open = (bugs || []).filter(b => !b.done);
  const ages = [];
  const bucketCounts = AGE_BUCKETS.map(b => ({ label: b.label, count: 0 }));
  const prioMap = new Map();

  for (const b of open) {
    const cd = day(b.created);
    const age = cd ? Math.max(0, daysBetween(cd, today)) : 0;
    ages.push(age);
    const bi = AGE_BUCKETS.findIndex(bk => age >= bk.min && age <= bk.max);
    if (bi >= 0) bucketCounts[bi].count++;
    const p = b.priority || 'None';
    prioMap.set(p, (prioMap.get(p) || 0) + 1);
  }

  return {
    totalOpen: open.length,
    medianAgeDays: median(ages),
    ageBuckets: bucketCounts,
    byPriority: [...prioMap.entries()]
      .map(([priority, count]) => ({ priority, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Median of a numeric array (0 for empty). */
export function median(nums) {
  if (!nums || nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
