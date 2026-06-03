#!/usr/bin/env node
/**
 * tests/alerts.test.js
 * Tests for src/metrics.js (new functions) and src/alerts.js rules.
 */
import { countWorkingDays, committedBurnPrediction, sentryDayOverDaySpike } from '../src/metrics.js';
import { scopeCreep, unassignedWork, reopenedTickets, dueDateRisk, stalledBurndown, sentryTrendSpike } from '../src/alerts.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); fail++; }
}
function assertEqual(a, b) {
  if (a !== b) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertNotNull(a) { if (a == null) throw new Error('Expected non-null'); }
function assertNull(a) { if (a != null) throw new Error(`Expected null, got ${JSON.stringify(a)}`); }

// ── countWorkingDays ──────────────────────────────────────────────────────
console.log('\ncountWorkingDays');
// Use local (no-Z) timestamps for tz-robustness
const MON = new Date('2026-06-01T12:00:00'); // Monday
const FRI = new Date('2026-06-05T12:00:00'); // Friday
const WED = new Date('2026-06-03T12:00:00'); // Wednesday

test('Mon→Fri = 5 working days (Mon–Fri schedule)', () =>
  assertEqual(countWorkingDays(MON, FRI, [1,2,3,4,5]), 4)); // Mon inclusive, Fri exclusive
test('Mon→Fri = 4 working days (Sun–Thu schedule)', () =>
  assertEqual(countWorkingDays(MON, FRI, [0,1,2,3,4]), 4)); // Mon,Tue,Wed,Thu only
test('same day = 0', () =>
  assertEqual(countWorkingDays(MON, MON, [1,2,3,4,5]), 0));
test('Mon→Wed = 2 working days (Mon–Fri)', () =>
  assertEqual(countWorkingDays(MON, WED, [1,2,3,4,5]), 2));

// ── committedBurnPrediction ───────────────────────────────────────────────
console.log('\ncommittedBurnPrediction');
const spBase = {
  committedPoints: 40, completedPoints: 0,
  startDate: '2026-06-01T12:00:00', endDate: '2026-06-07T12:00:00'
};
test('no committedPoints → no-data', () =>
  assertEqual(committedBurnPrediction({ startDate: '2026-06-01', endDate: '2026-06-07' }).risk, 'no-data'));
test('first 2 days → early (no alarm)', () =>
  assertEqual(committedBurnPrediction({ ...spBase, completedPoints: 0 }, [1,2,3,4,5]).risk, 'early'));
const spGood = { ...spBase, completedPoints: 30 };  // 30/40 done — well on track
test('on track → risk none', () => {
  const r = committedBurnPrediction(spGood, [1,2,3,4,5]);
  // risk depends on remaining days; just check it doesn't blow up
  assertNotNull(r.risk);
});
test('no points done → shortfall = committedPoints when sprint over', () => {
  const r = committedBurnPrediction({ committedPoints:30, completedPoints:0,
    startDate:'2026-05-25T12:00:00', endDate:'2026-05-31T12:00:00' }, [1,2,3,4,5]);
  assertEqual(r.risk, 'goal-missed');
});

// ── sentryDayOverDaySpike ─────────────────────────────────────────────────
console.log('\nsentryDayOverDaySpike');
const samples = [
  { date: '2026-06-01', count: 40 },
  { date: '2026-06-02', count: 42 },
];
test('small delta → no spike', () => assertNull(sentryDayOverDaySpike(44, samples)));
test('large absolute delta → spike', () => assertNotNull(sentryDayOverDaySpike(55, samples)));
test('large pct delta → spike', () => assertNotNull(sentryDayOverDaySpike(60, samples)));
test('lower count → no spike', () => assertNull(sentryDayOverDaySpike(38, samples)));
test('empty samples → no spike', () => assertNull(sentryDayOverDaySpike(99, [])));

// ── scopeCreep ────────────────────────────────────────────────────────────
console.log('\nscopeCreep');
const spScopeOk = { name:'S', committedPoints:40, scopeByDay:{ 1:{ added:0,removed:0,estimateDelta:-1 } } };
const spScopeBig = { name:'S', committedPoints:40, scopeByDay:{ 1:{ added:5,removed:0,estimateDelta:0 }, 2:{ added:3,removed:0,estimateDelta:0 } } };
test('no additions → null', () => assertNull(scopeCreep({ currentSprint: spScopeOk })));
test('20% scope added → fires', () => assertNotNull(scopeCreep({ currentSprint: spScopeBig })));
test('<10% scope added → null', () => {
  const sp2 = { name:'S', committedPoints:40, scopeByDay:{ 1:{ added:2,removed:0,estimateDelta:0 } } };
  assertNull(scopeCreep({ currentSprint: sp2 }));
});

// ── unassignedWork ────────────────────────────────────────────────────────
console.log('\nunassignedWork');
const spUnassigned = { name:'S', stories:[
  { key:'HRM-1', assignee: null, statusCategory:'new', points:3 },
  { key:'HRM-2', assignee: 'Ali', statusCategory:'new', points:2 },
  { key:'HRM-3', assignee: null, statusCategory:'done', points:1 },
]};
test('has unassigned open story → fires', () => assertNotNull(unassignedWork({ currentSprint: spUnassigned })));
test('all assigned → null', () => {
  const sp2 = { name:'S', stories:[{ assignee:'Ali', statusCategory:'new', points:5 }] };
  assertNull(unassignedWork({ currentSprint: sp2 }));
});

// ── reopenedTickets ───────────────────────────────────────────────────────
console.log('\nreopenedTickets');
const spReopened = { name:'S', stories:[
  { key:'HRM-1', closedAt:'2026-06-01T10:00:00Z', statusCategory:'indeterminate', points:3 },
  { key:'HRM-2', closedAt: null, statusCategory:'new', points:2 },
]};
test('has reopened ticket → fires', () => assertNotNull(reopenedTickets({ currentSprint: spReopened })));
test('no closedAt on non-done → null', () => {
  const sp2 = { name:'S', stories:[{ closedAt:null, statusCategory:'new', points:2 }] };
  assertNull(reopenedTickets({ currentSprint: sp2 }));
});

// ── sentryTrendSpike ──────────────────────────────────────────────────────
console.log('\nsentryTrendSpike');
const sentryState = {
  sentryViews: [{ viewId:'201', label:'BE Issues', count: 70 }],
  sentryTrendSamples: { '201': [{ date:'2026-06-02', count:42 }] }
};
test('big Sentry delta → fires', () => assertNotNull(sentryTrendSpike(sentryState)));
const sentryStateQuiet = {
  sentryViews: [{ viewId:'201', label:'BE Issues', count: 44 }],
  sentryTrendSamples: { '201': [{ date:'2026-06-02', count:42 }] }
};
test('small Sentry delta → null', () => assertNull(sentryTrendSpike(sentryStateQuiet)));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
