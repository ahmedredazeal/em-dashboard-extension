/**
 * tests/monthly-report.test.js — src/monthly-report.js (T-RPT-1)
 * Run: node tests/monthly-report.test.js
 */
import {
  monthKey, dayKey, emptyBucket, buildSnapshot, updateBucket, shouldRollover,
  computeDerived, finalizeMonth, pruneHistory, retentionWarning, sliceEngineer,
  METRICS, DEFAULT_RETENTION_MONTHS,
} from '../src/monthly-report.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(c, m = 'assertion failed') { if (!c) throw new Error(m); }

console.log('\nkeys');
test('monthKey / dayKey use local components, zero-padded', () => {
  const d = new Date(2026, 0, 5, 12, 0, 0); // 2026-01-05 local
  assert(monthKey(d) === '2026-01', monthKey(d));
  assert(dayKey(d) === '2026-01-05', dayKey(d));
});

console.log('\nrollover');
test('same month → no rollover', () => {
  assert(shouldRollover('2026-06', new Date(2026, 5, 20)) === false);
});
test('month change → rollover', () => {
  assert(shouldRollover('2026-05', new Date(2026, 5, 1)) === true);
});
test('year boundary Dec→Jan → rollover', () => {
  assert(shouldRollover('2025-12', new Date(2026, 0, 1)) === true);
});
test('no stored month → no rollover (nothing to finalize)', () => {
  assert(shouldRollover(null, new Date()) === false);
});

console.log('\nupdateBucket — flow idempotency');
test('re-applying the same day overwrites, does not double count', () => {
  const today = new Date(2026, 5, 10);
  let b = emptyBucket('2026-06', 'HRM', new Date(2026, 5, 1).toISOString());
  const snap = { day: '2026-06-10', flow: { bugsOpened: 2, bugsResolved: 1, supportOpened: 0, supportClosed: 0 }, byEngineer: {}, state: { openBugs: 5, medianBugAge: 3 }, closedSprints: [] };
  b = updateBucket(b, snap, today);
  b = updateBucket(b, snap, today); // same day again
  const d = computeDerived(b);
  assert(d.bugsOpened === 2, `bugsOpened ${d.bugsOpened} (should be 2, not 4)`);
  assert(b.observedDays === 1, `observedDays ${b.observedDays}`);
});
test('different days sum', () => {
  let b = emptyBucket('2026-06', 'HRM', new Date(2026, 5, 1).toISOString());
  b = updateBucket(b, { day: '2026-06-10', flow: { bugsOpened: 2, bugsResolved: 0, supportOpened: 0, supportClosed: 0 }, byEngineer: {}, state: { openBugs: 5, medianBugAge: 3 }, closedSprints: [] }, new Date(2026, 5, 10));
  b = updateBucket(b, { day: '2026-06-11', flow: { bugsOpened: 3, bugsResolved: 1, supportOpened: 0, supportClosed: 0 }, byEngineer: {}, state: { openBugs: 7, medianBugAge: 4 }, closedSprints: [] }, new Date(2026, 5, 11));
  const d = computeDerived(b);
  assert(d.bugsOpened === 5 && d.bugsResolved === 1, `${d.bugsOpened}/${d.bugsResolved}`);
  assert(b.observedDays === 2, `observedDays ${b.observedDays}`);
});

console.log('\nstate first + latest');
test('stateFirst sticks, stateLatest updates', () => {
  let b = emptyBucket('2026-06', 'HRM', new Date(2026, 5, 1).toISOString());
  b = updateBucket(b, { day: '2026-06-01', flow: {}, byEngineer: {}, state: { openBugs: 10, medianBugAge: 2 }, closedSprints: [] }, new Date(2026, 5, 1));
  b = updateBucket(b, { day: '2026-06-15', flow: {}, byEngineer: {}, state: { openBugs: 4, medianBugAge: 6 }, closedSprints: [] }, new Date(2026, 5, 15));
  assert(b.stateFirst.openBugs === 10, `first ${b.stateFirst.openBugs}`);
  assert(b.stateLatest.openBugs === 4, `latest ${b.stateLatest.openBugs}`);
  const d = computeDerived(b);
  assert(d.openBugsStart === 10 && d.openBugsEnd === 4, `${d.openBugsStart}/${d.openBugsEnd}`);
});

console.log('\nsprints + partial');
test('closed sprints deduped by name', () => {
  let b = emptyBucket('2026-06', 'HRM', new Date(2026, 5, 1).toISOString());
  const sp = [{ name: 'S30', velocity: 20, completionPct: 90 }];
  b = updateBucket(b, { day: '2026-06-10', flow: {}, byEngineer: {}, state: { openBugs: 1, medianBugAge: 1 }, closedSprints: sp }, new Date(2026, 5, 10));
  b = updateBucket(b, { day: '2026-06-11', flow: {}, byEngineer: {}, state: { openBugs: 1, medianBugAge: 1 }, closedSprints: sp }, new Date(2026, 5, 11));
  assert(b.sprintsClosed.length === 1, `sprints ${b.sprintsClosed.length}`);
});
test('partial flag when bucket starts after the 1st', () => {
  let b = emptyBucket('2026-06', 'HRM', new Date(2026, 5, 14).toISOString());
  b = updateBucket(b, { day: '2026-06-14', flow: {}, byEngineer: {}, state: { openBugs: 1, medianBugAge: 1 }, closedSprints: [] }, new Date(2026, 5, 14));
  assert(b.partial === true, 'should be partial');
});

console.log('\nfinalize — hours via finalizeQuery');
test('finalize folds hours total + per engineer; hoursAvailable reflects the read', () => {
  let b = emptyBucket('2026-05', 'HRM', new Date(2026, 4, 1).toISOString());
  b = updateBucket(b, { day: '2026-05-10', flow: { bugsOpened: 1, bugsResolved: 0, supportOpened: 0, supportClosed: 0 }, byEngineer: { 'acc-a': { bugsOpened: 1, bugsResolved: 0 } }, state: { openBugs: 3, medianBugAge: 5 }, closedSprints: [] }, new Date(2026, 4, 10));
  const hours = { total: 120, perEngineer: { 'acc-a': 80, 'acc-b': 40 } };
  const fm = finalizeMonth(b, hours, '2026-06-01T00:00:00Z');
  assert(fm.derived.totalHours === 120, `total ${fm.derived.totalHours}`);
  assert(fm.hoursAvailable === true, 'hoursAvailable');
  assert(fm.derived.byEngineer['acc-a'].hours === 80, 'acc-a hours');
  assert(fm.derived.byEngineer['acc-a'].bugsOpened === 1, 'acc-a bugs');
  assert(fm.derived.byEngineer['acc-b'].hours === 40, 'acc-b hours from finalizeQuery only');
});
test('finalize with no hours read → hoursAvailable false, totalHours null', () => {
  let b = emptyBucket('2026-05', 'HRM', new Date(2026, 4, 1).toISOString());
  b = updateBucket(b, { day: '2026-05-10', flow: { bugsOpened: 1, bugsResolved: 0, supportOpened: 0, supportClosed: 0 }, byEngineer: {}, state: { openBugs: 3, medianBugAge: 5 }, closedSprints: [] }, new Date(2026, 4, 10));
  const fm = finalizeMonth(b, null);
  assert(fm.hoursAvailable === false && fm.derived.totalHours === null, 'no hours');
  assert(fm.derived.bugsOpened === 1, 'bug flow still computed');
});

console.log('\nper-engineer slice (F3)');
test('sliceEngineer pulls one engineer view', () => {
  const fm = { derived: { byEngineer: { 'acc-a': { bugsOpened: 3, bugsResolved: 2, hours: 70 }, 'acc-b': { bugsOpened: 1, bugsResolved: 1, hours: 50 } } } };
  const s = sliceEngineer(fm, 'acc-a');
  assert(s.hours === 70 && s.bugsOpened === 3 && s.bugsResolved === 2, JSON.stringify(s));
  const z = sliceEngineer(fm, 'nobody');
  assert(z.bugsOpened === 0 && z.hours === null, 'unknown engineer → zeros');
});

console.log('\nretention');
test('pruneHistory keeps newest N', () => {
  const history = {};
  for (let m = 1; m <= 14; m++) history[`2025-${String(m).padStart(2, '0')}`] = { month: m };
  // 14 keys but months only go to 12; build explicitly across a year boundary instead
  const h2 = { '2025-01': {}, '2025-02': {}, '2025-03': {}, '2025-04': {}, '2025-05': {}, '2025-06': {}, '2025-07': {}, '2025-08': {}, '2025-09': {}, '2025-10': {}, '2025-11': {}, '2025-12': {}, '2026-01': {} };
  const pruned = pruneHistory(h2, 12);
  const keys = Object.keys(pruned).sort();
  assert(keys.length === 12, `kept ${keys.length}`);
  assert(keys[0] === '2025-02' && keys[11] === '2026-01', `range ${keys[0]}..${keys[11]}`);
});
test('pruneHistory no-op under the cap', () => {
  const h = { '2026-01': {}, '2026-02': {} };
  assert(Object.keys(pruneHistory(h, 12)).length === 2);
});
test('retentionWarning fires one month ahead', () => {
  // 12 finalized months already; current in-progress month not yet in history.
  const h = {};
  for (let m = 1; m <= 12; m++) h[`2025-${String(m).padStart(2, '0')}`] = {};
  const w = retentionWarning(h, '2026-01', 12);
  assert(w.willPrune === true, 'should warn');
  assert(w.monthsAtRisk[0] === '2025-01', `at risk ${w.monthsAtRisk}`);
});
test('retentionWarning quiet under the cap', () => {
  const h = { '2026-01': {}, '2026-02': {} };
  assert(retentionWarning(h, '2026-03', 12).willPrune === false);
});

console.log('\nbuildSnapshot boundary');
test('buildSnapshot derives today flow + state from dashboard state shape', () => {
  const now = new Date(2026, 5, 10, 12, 0, 0);
  const t = dayKey(now); // 2026-06-10
  const state = {
    settings: { squad: 'HRM' },
    bugReports: { bugs: [
      { key: 'B1', created: t + 'T09:00:00Z', resolved: null, done: false, assigneeAccountId: 'acc-a' },
      { key: 'B2', created: '2026-06-01T09:00:00Z', resolved: t + 'T10:00:00Z', done: true, assigneeAccountId: 'acc-b' },
      { key: 'B3', created: '2026-05-01T09:00:00Z', resolved: null, done: false, assigneeAccountId: 'acc-a' },
    ] },
    supportTickets: [{ created: t + 'T08:00:00Z', resolved: null }],
    extraBoardsData: [],
    sprintHistory: [{ name: 'S29', state: 'closed', endDate: '2026-06-09', committedPoints: 20, completedPoints: 18, velocity: 18 }],
  };
  const snap = buildSnapshot(state, now);
  assert(snap.flow.bugsOpened === 1, `bugsOpened ${snap.flow.bugsOpened}`);     // B1 created today
  assert(snap.flow.bugsResolved === 1, `bugsResolved ${snap.flow.bugsResolved}`); // B2 resolved today
  assert(snap.flow.supportOpened === 1, `supportOpened ${snap.flow.supportOpened}`);
  assert(snap.state.openBugs === 2, `openBugs ${snap.state.openBugs}`);          // B1, B3
  assert(snap.byEngineer['acc-a'].bugsOpened === 1, 'acc-a opened today');
  assert(snap.byEngineer['acc-b'].bugsResolved === 1, 'acc-b resolved today');
  assert(snap.closedSprints.length === 1 && snap.closedSprints[0].completionPct === 90, JSON.stringify(snap.closedSprints));
  assert(snap.squad === 'HRM', 'squad');
});
test('buildSnapshot honors explicit reportDeltas override', () => {
  const state = { reportDeltas: { bugsOpened: 9, bugsResolved: 4, supportOpened: 1, supportClosed: 2 }, bugReports: { bugs: [] } };
  const snap = buildSnapshot(state, new Date(2026, 5, 10));
  assert(snap.flow.bugsOpened === 9 && snap.flow.supportClosed === 2, JSON.stringify(snap.flow));
});

console.log('\nregistry sanity');
test('METRICS registry has the expected reducers', () => {
  const byKey = Object.fromEntries(METRICS.map(m => [m.key, m.reducer]));
  assert(byKey.bugsOpened === 'sumDailyDelta', 'bugsOpened reducer');
  assert(byKey.openBugs === 'latestSnapshot', 'openBugs reducer');
  assert(byKey.hoursLogged === 'finalizeQuery', 'hours reducer');
  assert(DEFAULT_RETENTION_MONTHS === 12, 'retention default');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
