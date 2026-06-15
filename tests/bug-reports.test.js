/**
 * tests/bug-reports.test.js — src/bug-reports.js (T-BR-1)
 * Run: node tests/bug-reports.test.js
 */
import { incomingVsResolved, openBugSnapshot, median, AGE_BUCKETS } from '../src/bug-reports.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

// Three consecutive 2-week sprints.
const sprints = [
  { name: 'S1', startDate: '2026-04-01', endDate: '2026-04-14' },
  { name: 'S2', startDate: '2026-04-15', endDate: '2026-04-28' },
  { name: 'S3', startDate: '2026-04-29', endDate: '2026-05-12' },
];

console.log('\nincomingVsResolved');
test('buckets created + resolved into the right sprint windows', () => {
  const bugs = [
    { created: '2026-04-03', resolved: '2026-04-20' }, // in S1, resolved S2
    { created: '2026-04-16', resolved: null },          // in S2, unresolved
    { created: '2026-05-01', resolved: '2026-05-10' },  // in S3, resolved S3
  ];
  const r = incomingVsResolved(bugs, sprints);
  assert(r.buckets.length === 3, 'three buckets');
  assert(r.buckets[0].incoming === 1 && r.buckets[0].resolved === 0, `S1 ${JSON.stringify(r.buckets[0])}`);
  assert(r.buckets[1].incoming === 1 && r.buckets[1].resolved === 1, `S2 ${JSON.stringify(r.buckets[1])}`);
  assert(r.buckets[2].incoming === 1 && r.buckets[2].resolved === 1, `S3 ${JSON.stringify(r.buckets[2])}`);
});
test('buckets are ordered oldest → newest regardless of input order', () => {
  const r = incomingVsResolved([], [sprints[2], sprints[0], sprints[1]]);
  assert(r.buckets.map(b => b.name).join(',') === 'S1,S2,S3', r.buckets.map(b => b.name).join(','));
});
test('net = incoming - resolved; totals aggregate', () => {
  const bugs = [
    { created: '2026-04-03', resolved: null },
    { created: '2026-04-04', resolved: null },
    { created: '2026-04-16', resolved: '2026-04-17' },
  ];
  const r = incomingVsResolved(bugs, sprints);
  assert(r.buckets[0].net === 2, `S1 net ${r.buckets[0].net}`);
  assert(r.totals.incoming === 3 && r.totals.resolved === 1 && r.totals.net === 2, JSON.stringify(r.totals));
});
test('dates before the earliest window count as "older", not plotted', () => {
  const bugs = [
    { created: '2026-03-01', resolved: '2026-03-15' }, // both before S1
    { created: '2026-04-05', resolved: null },
  ];
  const r = incomingVsResolved(bugs, sprints);
  assert(r.olderIncoming === 1, `olderIncoming ${r.olderIncoming}`);
  assert(r.olderResolved === 1, `olderResolved ${r.olderResolved}`);
  assert(r.totals.incoming === 1, 'only the in-window bug is plotted');
});
test('last window includes its end date (inclusive)', () => {
  const bugs = [{ created: '2026-05-12', resolved: null }]; // exactly S3 end
  const r = incomingVsResolved(bugs, sprints);
  assert(r.buckets[2].incoming === 1, 'end-of-last-sprint counts');
});
test('window boundary: start is inclusive, end is exclusive (non-last)', () => {
  // 2026-04-15 is S2 start AND would be S1 end+1 — must land in S2, not S1.
  const bugs = [{ created: '2026-04-15', resolved: null }];
  const r = incomingVsResolved(bugs, sprints);
  assert(r.buckets[0].incoming === 0 && r.buckets[1].incoming === 1, 'boundary → S2');
});
test('no sprints → empty result, no crash', () => {
  const r = incomingVsResolved([{ created: '2026-04-01' }], []);
  assert(r.buckets.length === 0 && r.totals.incoming === 0, 'empty');
});
test('skips sprints with missing dates', () => {
  const r = incomingVsResolved([], [{ name: 'X' }, sprints[0]]);
  assert(r.buckets.length === 1 && r.buckets[0].name === 'S1', 'only valid window kept');
});

console.log('\nopenBugSnapshot');
const NOW = new Date('2026-05-12T12:00:00');
test('counts only open bugs', () => {
  const bugs = [
    { created: '2026-05-10', done: false, priority: 'High' },
    { created: '2026-05-01', done: true,  priority: 'Low' }, // resolved → excluded
  ];
  const r = openBugSnapshot(bugs, NOW);
  assert(r.totalOpen === 1, `open ${r.totalOpen}`);
});
test('age buckets place bugs correctly', () => {
  const bugs = [
    { created: '2026-05-10', done: false }, // 2d → 0–7d
    { created: '2026-05-01', done: false }, // 11d → 8–30d
    { created: '2026-04-01', done: false }, // 41d → 31–90d
    { created: '2026-01-01', done: false }, // 131d → 90d+
  ];
  const r = openBugSnapshot(bugs, NOW);
  const byLabel = Object.fromEntries(r.ageBuckets.map(b => [b.label, b.count]));
  assert(byLabel['0–7d'] === 1, `0-7 ${byLabel['0–7d']}`);
  assert(byLabel['8–30d'] === 1, `8-30 ${byLabel['8–30d']}`);
  assert(byLabel['31–90d'] === 1, `31-90 ${byLabel['31–90d']}`);
  assert(byLabel['90d+'] === 1, `90+ ${byLabel['90d+']}`);
});
test('median age computed across open bugs', () => {
  const bugs = [
    { created: '2026-05-10', done: false }, // 2
    { created: '2026-05-08', done: false }, // 4
    { created: '2026-05-02', done: false }, // 10
  ];
  const r = openBugSnapshot(bugs, NOW);
  assert(r.medianAgeDays === 4, `median ${r.medianAgeDays}`);
});
test('priority split sorted desc, missing priority → None', () => {
  const bugs = [
    { created: '2026-05-10', done: false, priority: 'High' },
    { created: '2026-05-10', done: false, priority: 'High' },
    { created: '2026-05-10', done: false }, // None
  ];
  const r = openBugSnapshot(bugs, NOW);
  assert(r.byPriority[0].priority === 'High' && r.byPriority[0].count === 2, JSON.stringify(r.byPriority));
  assert(r.byPriority.some(p => p.priority === 'None' && p.count === 1), 'None bucket');
});
test('empty → zeros, no crash', () => {
  const r = openBugSnapshot([], NOW);
  assert(r.totalOpen === 0 && r.medianAgeDays === 0, 'empty');
  assert(r.ageBuckets.length === AGE_BUCKETS.length, 'buckets present');
});

console.log('\nmedian');
test('odd / even / empty', () => {
  assert(median([3, 1, 2]) === 2, 'odd');
  assert(median([1, 2, 3, 4]) === 3, 'even rounds (2.5→3)');
  assert(median([]) === 0, 'empty');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
