/**
 * src/monthly-report.js — Zealer Dashboard (T-RPT-1)
 *
 * Pure core for the monthly report. No chrome, no DOM. Everything here is a
 * function of its inputs so it unit-tests cleanly (same pattern as
 * bug-reports.js / burndown.js).
 *
 * Model (see docs/T-RPT-1-PLAN.md Part 2, revised):
 *   - Accumulate continuously into an in-progress MonthBucket; finalize on
 *     month rollover (detected by comparing stored month key to today's).
 *   - Per-metric reducers: flow metrics are summed from per-day deltas; state
 *     metrics keep first + latest snapshot; hours are computed at finalize from
 *     a date-bounded read passed in (finalizeQuery — never accumulated here).
 *   - history retains `retentionMonths` finalized months; retentionWarning()
 *     flags the prune one month ahead.
 *
 * `buildSnapshot(state)` is the one impure-ish boundary (it reads the dashboard
 * state shape) but is still a pure function of the state object, and is
 * fixture-tested.
 */

export const SCHEMA_VERSION = 1;
export const DEFAULT_RETENTION_MONTHS = 12;

/** Local YYYY-MM for a Date (uses local time, per the plan). */
export function monthKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Local YYYY-MM-DD for a Date. */
export function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Metric reducer registry. Each entry declares how a metric rolls up.
 *   - sumDailyDelta : per-day count; month total = sum of daily values.
 *   - latestSnapshot: point-in-time state; keep first + latest.
 *   - finalizeQuery : not accumulated; computed at finalize from a passed-in read.
 */
export const METRICS = [
  { key: 'bugsOpened',    type: 'flow',  reducer: 'sumDailyDelta' },
  { key: 'bugsResolved',  type: 'flow',  reducer: 'sumDailyDelta' },
  { key: 'supportOpened', type: 'flow',  reducer: 'sumDailyDelta' },
  { key: 'supportClosed', type: 'flow',  reducer: 'sumDailyDelta' },
  { key: 'openBugs',      type: 'state', reducer: 'latestSnapshot' },
  { key: 'medianBugAge',  type: 'state', reducer: 'latestSnapshot' },
  { key: 'hoursLogged',   type: 'flow',  reducer: 'finalizeQuery' },
];

const FLOW_DELTA_KEYS = METRICS.filter(m => m.reducer === 'sumDailyDelta').map(m => m.key);
const STATE_KEYS = METRICS.filter(m => m.reducer === 'latestSnapshot').map(m => m.key);

/** A fresh, empty month bucket. */
export function emptyBucket(month, squad, startedAt = new Date().toISOString()) {
  return {
    month,
    partial: false,
    startedAt,
    squad: squad || null,
    observedDays: 0,
    daily: {},              // dayKey -> { bugsOpened, bugsResolved, supportOpened, supportClosed, byEngineer:{} }
    stateFirst: null,       // { openBugs, medianBugAge, capturedAt }
    stateLatest: null,
    sprintsClosed: [],      // [{ name, closedAt, committedPts, completedPts, velocity, completionPct }]
    appVersion: null,
  };
}

/**
 * buildSnapshot(state) — translate the dashboard's live state into the small
 * snapshot the accumulator consumes. The one boundary that reads `state` shape.
 * Returns per-day deltas for flow metrics + current state values.
 *
 * NOTE on flow deltas: the dashboard exposes current counts, not "happened
 * today". We derive a conservative daily delta by reading explicit *today*
 * counters when present (state.reportDeltas), else 0 — accumulation only counts
 * what the data source can attribute to the day. Bug flow is sliced per engineer
 * when assignee info is available.
 */
export function buildSnapshot(state, now = new Date()) {
  state = state || {};
  const rd = state.reportDeltas || {};
  const bugs = (state.bugReports && state.bugReports.bugs) || [];

  // Per-day bug flow, derived from bug created/resolved dates == today.
  const today = dayKey(now);
  let bugsOpened = 0, bugsResolved = 0;
  const byEngineer = {};
  for (const b of bugs) {
    const created = b.created ? dayKey(new Date(b.created)) : null;
    const resolved = b.resolved ? dayKey(new Date(b.resolved)) : null;
    const acc = b.assigneeAccountId || null;
    if (created === today) {
      bugsOpened++;
      if (acc) (byEngineer[acc] = byEngineer[acc] || { bugsOpened: 0, bugsResolved: 0 }).bugsOpened++;
    }
    if (resolved === today) {
      bugsResolved++;
      if (acc) (byEngineer[acc] = byEngineer[acc] || { bugsOpened: 0, bugsResolved: 0 }).bugsResolved++;
    }
  }

  // Support flow: count tickets created/closed today across main + extra boards.
  const supportTickets = collectSupportTickets(state);
  let supportOpened = 0, supportClosed = 0;
  for (const t of supportTickets) {
    if (t.created && dayKey(new Date(t.created)) === today) supportOpened++;
    if (t.resolved && dayKey(new Date(t.resolved)) === today) supportClosed++;
  }

  // State snapshot: open bugs + median age right now.
  const openBugs = bugs.filter(b => !b.done).length;
  const medianBugAge = medianAge(bugs.filter(b => !b.done), now);

  // Sprints closed: any sprint in history whose state is closed and not yet recorded
  // (the accumulator dedupes by name).
  const closedSprints = (state.sprintHistory || [])
    .filter(s => (s.state || '').toLowerCase() === 'closed')
    .map(s => ({
      name: s.name,
      closedAt: s.completeDate || s.endDate || null,
      committedPts: s.committedPoints ?? null,
      completedPts: s.completedPoints ?? null,
      velocity: s.velocity ?? null,
      completionPct: (s.committedPoints && s.completedPoints != null)
        ? Math.round((s.completedPoints / s.committedPoints) * 100) : null,
    }));

  return {
    day: today,
    flow: {
      bugsOpened: rd.bugsOpened ?? bugsOpened,
      bugsResolved: rd.bugsResolved ?? bugsResolved,
      supportOpened: rd.supportOpened ?? supportOpened,
      supportClosed: rd.supportClosed ?? supportClosed,
    },
    byEngineer,
    state: { openBugs, medianBugAge },
    closedSprints,
    appVersion: state.appVersion || null,
    squad: squadLabel(state),
  };
}

function squadLabel(state) {
  const s = (state.settings && state.settings.squad) || state.squad || null;
  if (!s) return null;
  return typeof s === 'string' ? s : (s.key || s.name || null);
}

function collectSupportTickets(state) {
  const out = [];
  for (const t of (state.supportTickets || [])) out.push(t);
  for (const b of (state.extraBoardsData || [])) {
    for (const t of (b.stories || [])) out.push(t);
  }
  return out;
}

function medianAge(openBugs, now) {
  if (!openBugs.length) return 0;
  const ages = openBugs.map(b => {
    if (!b.created) return 0;
    const ms = now.getTime() - new Date(b.created).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  }).sort((a, b) => a - b);
  const mid = Math.floor(ages.length / 2);
  return ages.length % 2 ? ages[mid] : Math.round((ages[mid - 1] + ages[mid]) / 2);
}

/**
 * Apply a snapshot to the in-progress bucket. Idempotent per day for flow
 * metrics (re-applying the same day overwrites that day's entry rather than
 * adding). Returns the (mutated) bucket.
 */
export function updateBucket(bucket, snapshot, today = new Date()) {
  if (!bucket) bucket = emptyBucket(monthKey(today), snapshot.squad);
  const dk = snapshot.day || dayKey(today);

  // observedDays: count a day the first time we see it.
  const isNewDay = !bucket.daily[dk];
  if (isNewDay) bucket.observedDays = (bucket.observedDays || 0) + 1;

  // FLOW (latest-wins per day → idempotent).
  bucket.daily[dk] = {
    bugsOpened: snapshot.flow.bugsOpened || 0,
    bugsResolved: snapshot.flow.bugsResolved || 0,
    supportOpened: snapshot.flow.supportOpened || 0,
    supportClosed: snapshot.flow.supportClosed || 0,
    byEngineer: snapshot.byEngineer || {},
  };

  // STATE (first + latest).
  const stateVal = { ...snapshot.state, capturedAt: new Date(today).toISOString() };
  if (!bucket.stateFirst) bucket.stateFirst = stateVal;
  bucket.stateLatest = stateVal;

  // EVENTS: append newly-closed sprints (dedupe by name).
  const known = new Set(bucket.sprintsClosed.map(s => s.name));
  for (const s of (snapshot.closedSprints || [])) {
    if (s.name && !known.has(s.name)) { bucket.sprintsClosed.push(s); known.add(s.name); }
  }

  if (snapshot.appVersion) bucket.appVersion = snapshot.appVersion;
  if (!bucket.squad && snapshot.squad) bucket.squad = snapshot.squad;

  // partial: started after the 1st of its month.
  const started = new Date(bucket.startedAt);
  if (started.getDate() > 1 && monthKey(started) === bucket.month) bucket.partial = true;

  return bucket;
}

/** True if the stored month differs from today's month (rollover needed). */
export function shouldRollover(storedMonth, today = new Date()) {
  return !!storedMonth && storedMonth !== monthKey(today);
}

/**
 * Compute derived metrics for a bucket. hoursResult (optional) is the result of
 * the finalize-time worklog read: { total, perEngineer:{accId:hrs} } or null.
 */
export function computeDerived(bucket, hoursResult = null) {
  const days = Object.values(bucket.daily || {});
  const sum = (k) => days.reduce((acc, d) => acc + (d[k] || 0), 0);

  const bugsOpened = sum('bugsOpened');
  const bugsResolved = sum('bugsResolved');
  const supportOpened = sum('supportOpened');
  const supportClosed = sum('supportClosed');

  // Per-engineer bug flow, summed across days.
  const byEngineer = {};
  for (const d of days) {
    for (const [acc, v] of Object.entries(d.byEngineer || {})) {
      const e = byEngineer[acc] = byEngineer[acc] || { bugsOpened: 0, bugsResolved: 0, hours: null };
      e.bugsOpened += v.bugsOpened || 0;
      e.bugsResolved += v.bugsResolved || 0;
    }
  }
  // Fold in hours (finalizeQuery) total + per engineer.
  const hoursAvailable = !!hoursResult;
  const totalHours = hoursResult ? hoursResult.total : null;
  if (hoursResult && hoursResult.perEngineer) {
    for (const [acc, hrs] of Object.entries(hoursResult.perEngineer)) {
      (byEngineer[acc] = byEngineer[acc] || { bugsOpened: 0, bugsResolved: 0, hours: null }).hours = hrs;
    }
  }

  const sprints = bucket.sprintsClosed || [];
  const velocities = sprints.map(s => s.velocity).filter(v => v != null);
  const completions = sprints.map(s => s.completionPct).filter(v => v != null);
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  return {
    totalHours,
    hoursAvailable,
    perEngineerHours: hoursResult ? (hoursResult.perEngineer || {}) : {},
    bugsOpened,
    bugsResolved,
    netBugFlow: bugsOpened - bugsResolved,
    byEngineer,
    supportOpened,
    supportClosed,
    openBugsStart: bucket.stateFirst ? bucket.stateFirst.openBugs : null,
    openBugsEnd: bucket.stateLatest ? bucket.stateLatest.openBugs : null,
    medianBugAgeEnd: bucket.stateLatest ? bucket.stateLatest.medianBugAge : null,
    velocityAvg: avg(velocities),
    completionPctAvg: avg(completions),
    sprintCount: sprints.length,
  };
}

/** Finalize a bucket into an immutable FinalizedMonth. */
export function finalizeMonth(bucket, hoursResult = null, finalizedAt = new Date().toISOString()) {
  const derived = computeDerived(bucket, hoursResult);
  return {
    ...bucket,
    finalizedAt,
    hoursAvailable: derived.hoursAvailable,
    derived,
  };
}

/** Keep at most retentionMonths finalized months; drop the oldest. Pure. */
export function pruneHistory(history, retentionMonths = DEFAULT_RETENTION_MONTHS) {
  const keys = Object.keys(history || {}).sort(); // YYYY-MM sorts chronologically
  if (keys.length <= retentionMonths) return { ...history };
  const keep = keys.slice(keys.length - retentionMonths);
  const out = {};
  for (const k of keep) out[k] = history[k];
  return out;
}

/**
 * Will the next finalize prune a month? Warn one month ahead.
 * @returns {{ willPrune, monthsAtRisk: string[] }}
 */
export function retentionWarning(history, currentMonth, retentionMonths = DEFAULT_RETENTION_MONTHS) {
  const keys = Object.keys(history || {}).sort();
  // After the current in-progress month finalizes, history grows by 1.
  const projected = keys.includes(currentMonth) ? keys.length : keys.length + 1;
  if (projected <= retentionMonths) return { willPrune: false, monthsAtRisk: [] };
  const overBy = projected - retentionMonths;
  const monthsAtRisk = keys.slice(0, overBy);
  return { willPrune: true, monthsAtRisk };
}

/**
 * Slice a finalized month (or its derived) down to a single engineer's view.
 * Returns { hours, bugsOpened, bugsResolved } for the engineer, or zeros.
 */
export function sliceEngineer(finalizedMonth, accountId) {
  const d = (finalizedMonth && finalizedMonth.derived) || {};
  const e = (d.byEngineer && d.byEngineer[accountId]) || null;
  return {
    accountId,
    hours: e ? e.hours : null,
    bugsOpened: e ? e.bugsOpened : 0,
    bugsResolved: e ? e.bugsResolved : 0,
  };
}
