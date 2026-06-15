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

/** Done-ish status names for reopen detection (display-name heuristic). */
const DONE_NAMES = new Set(['done', 'closed', 'resolved', 'qa accepted', 'complete', 'completed']);

/**
 * Reopen rate (T-BR-1 ph2) — share of bugs that were moved Done → not-Done at
 * least once, among bugs whose created date falls within the given windows.
 *
 * A "reopen" = a status-change history item whose fromString is a done-ish
 * status and whose toString is not. Requires bugs fetched with changelog.
 *
 * @param {Array} bugs  normalized bugs; each may carry `reopenCount` (precomputed
 *                      from changelog by the fetch layer) OR raw `changelog`.
 * @param {Array} windows  sprint windows (same shape as incomingVsResolved)
 * @returns {{ total, reopened, rate, reopenedKeys: string[] }}
 *   rate is 0..1 (reopened / total). total counts in-window bugs only.
 */
export function reopenRate(bugs, windows) {
  const wins = (windows || [])
    .map(w => ({ start: day(w.startDate), end: day(w.endDate) }))
    .filter(w => w.start && w.end)
    .sort((a, b) => a.start - b.start);
  if (wins.length === 0) return { total: 0, reopened: 0, rate: 0, reopenedKeys: [] };

  const earliest = wins[0].start;
  const latest = wins[wins.length - 1].end;
  const inWindow = (d) => d && d >= earliest && d <= latest;

  let total = 0, reopened = 0;
  const reopenedKeys = [];
  for (const b of bugs || []) {
    const cd = day(b.created);
    if (!inWindow(cd)) continue;
    total++;
    const count = typeof b.reopenCount === 'number'
      ? b.reopenCount
      : countReopens(b.changelog);
    if (count > 0) { reopened++; reopenedKeys.push(b.key); }
  }
  return { total, reopened, rate: total ? reopened / total : 0, reopenedKeys };
}

/** Count Done→not-Done status transitions in a raw Jira changelog object. */
/**
 * Count reopens in a raw Jira changelog. A reopen is detected two ways, and the
 * stronger (workflow-independent) signal is preferred:
 *
 *  1. RESOLUTION CLEARED — a `resolution` field change whose new value is empty
 *     (Jira sets resolution when an issue is resolved and clears it on reopen).
 *     This does NOT depend on status names, so it works for any workflow.
 *  2. STATUS Done→not-Done — a `status` change out of a done-ish display name.
 *     Fallback for workflows that reopen without a resolution field.
 *
 * To avoid double-counting a single reopen that fires both signals in the same
 * history entry, each history entry contributes at most one reopen.
 */
export function countReopens(changelog) {
  const histories = changelog?.histories;
  if (!Array.isArray(histories)) return 0;
  let n = 0;
  for (const h of histories) {
    if (!Array.isArray(h.items)) continue;
    let entryReopened = false;
    for (const it of h.items) {
      // Signal 1: resolution cleared (set → empty). Workflow-independent.
      if (it.field === 'resolution') {
        const hadResolution = !!(it.from || it.fromString);
        const nowEmpty = !it.to && !it.toString;
        if (hadResolution && nowEmpty) { entryReopened = true; break; }
      }
      // Signal 2: status moved out of a done-ish name.
      if (it.field === 'status') {
        const from = (it.fromString || '').toLowerCase().trim();
        const to = (it.toString || '').toLowerCase().trim();
        if (DONE_NAMES.has(from) && !DONE_NAMES.has(to)) { entryReopened = true; break; }
      }
    }
    if (entryReopened) n++;
  }
  return n;
}

/**
 * Group bugs by a string attribute (e.g. App Name), descending by count.
 * @param {Array} bugs  normalized bugs carrying `appName`
 * @param {Object} [opts]
 * @param {boolean} [opts.openOnly=false]  count only open bugs
 * @param {string}  [opts.emptyLabel='Unspecified']
 * @returns {Array<{label, count}>}
 */
export function byAppName(bugs, opts = {}) {
  const { openOnly = false, emptyLabel = 'Unspecified' } = opts;
  const map = new Map();
  for (const b of bugs || []) {
    if (openOnly && b.done) continue;
    const label = (b.appName && String(b.appName).trim()) || emptyLabel;
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}
