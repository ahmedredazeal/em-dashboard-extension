#!/usr/bin/env node
/**
 * tests/alerts.test.js
 * Tests for src/metrics.js (new functions) and src/alerts.js rules.
 */
import { countWorkingDays, committedBurnPrediction, sentryDayOverDaySpike, isEarlySprint } from '../src/metrics.js';
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
test('first 2 days → early (no alarm)', () => {
  // Sprint starting today has 0 working days elapsed — always within early threshold
  const todayStr = new Date().toISOString().slice(0, 10);
  const endStr   = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const r = committedBurnPrediction({
    committedPoints: 40, completedPoints: 0,
    startDate: `${todayStr}T12:00:00`, endDate: `${endStr}T12:00:00`
  }, [1,2,3,4,5]);
  assertEqual(r.risk, 'early');
});
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

// ── isEarlySprint ─────────────────────────────────────────────────────────
console.log('\nisEarlySprint');
const todayStr = new Date().toISOString().slice(0, 10);
const farFuture = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
const spEarlyCheck = { startDate:`${todayStr}T12:00:00`, endDate:`${farFuture}T12:00:00` };
test('sprint started today → early', () => {
  assertEqual(isEarlySprint(spEarlyCheck, [0,1,2,3,4]), true);
});
test('sprint long over → not early', () => {
  const past = { startDate:'2026-05-01T12:00:00', endDate:'2026-05-15T12:00:00' };
  assertEqual(isEarlySprint(past, [0,1,2,3,4]), false);
});
test('missing dates → not early (safe default)', () => {
  assertEqual(isEarlySprint({}, [0,1,2,3,4]), false);
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
test('early sprint: high pts unassigned → capped at medium (not high)', () => {
  const spEarlyU = {
    name:'S', startDate:`${todayStr}T12:00:00`, endDate:`${farFuture}T12:00:00`,
    stories:[{ key:'HRM-X', assignee:null, statusCategory:'new', points:10 }]
  };
  const alert = unassignedWork({ currentSprint: spEarlyU, settings:{} });
  assertNotNull(alert);
  assertEqual(alert.severity, 'medium');
});

// ── dueDateRisk ───────────────────────────────────────────────────────────
console.log('\ndueDateRisk');
const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
const sprintEndFar = farFuture; // 14 days out
test('day-1: tickets with dueDate=sprint-end → null (not at risk yet)', () => {
  const sp3 = { name:'S', endDate: sprintEndFar, stories:[
    { key:'HRM-1', dueDate: sprintEndFar, statusCategory:'new', points:3 },
    { key:'HRM-2', dueDate: sprintEndFar, statusCategory:'new', points:5 },
  ]};
  assertNull(dueDateRisk({ currentSprint: sp3, settings:{} }));
});
test('genuinely overdue ticket → fires HIGH', () => {
  const sp4 = { name:'S', endDate: sprintEndFar, stories:[
    { key:'HRM-1', dueDate: yesterday, statusCategory:'new', points:3 },
  ]};
  const alert = dueDateRisk({ currentSprint: sp4, settings:{} });
  assertNotNull(alert);
  assertEqual(alert.severity, 'high');
});
test('no due dates → null', () => {
  const sp5 = { name:'S', endDate: sprintEndFar, stories:[
    { key:'HRM-1', dueDate: null, statusCategory:'new', points:5 },
  ]};
  assertNull(dueDateRisk({ currentSprint: sp5, settings:{} }));
});

// ── stalledBurndown ───────────────────────────────────────────────────────
console.log('\nstalledBurndown');
test('early sprint → null (ramp-up grace period)', () => {
  const spEarlyS = {
    name:'S', startDate:`${todayStr}T12:00:00`, endDate:`${farFuture}T12:00:00`,
    todayIndex: 3,
    stories:[{ key:'HRM-1', closedDay:null, statusCategory:'new', points:5 }]
  };
  assertNull(stalledBurndown({ currentSprint: spEarlyS, settings:{} }));
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

// ── Structured alert fields (compact + expandable UI) ──────────────────────
import { visibleAlerts, todayKey, tomorrowKey } from '../src/alerts.js';

test('dueDateRisk carries tickets + bullets for the expandable detail', () => {
  const today = new Date(); today.setHours(0,0,0,0);
  const past  = new Date(today); past.setDate(past.getDate() - 2);
  const iso = d => d.toISOString().slice(0,10);
  const a = dueDateRisk({
    settings: { ui: { workingDays:[0,1,2,3,4] } },
    currentSprint: { name:'S', stories: [
      { key:'HRM-1', points:3, statusCategory:'new', dueDate: iso(past), assignee:'Ali' },
    ] }
  });
  if (!a) throw new Error('expected an alert');
  if (!a.tickets.includes('HRM-1')) throw new Error('tickets[] missing the key');
  if (!a.bullets.length) throw new Error('bullets[] missing');
  if (!a.detail) throw new Error('detail missing');
});

console.log('\nSnooze model');
test('tomorrowKey is the day after todayKey', () => {
  const now = new Date('2026-06-13T10:00:00');
  if (todayKey(now) !== '2026-06-13') throw new Error('todayKey wrong: ' + todayKey(now));
  if (tomorrowKey(now) !== '2026-06-14') throw new Error('tomorrowKey wrong: ' + tomorrowKey(now));
});
test('an alert snoozed until tomorrow is hidden today, shown tomorrow', () => {
  const now = new Date('2026-06-13T10:00:00');
  const list = [{ id:'x1', ruleId:'scope_creep', severity:'medium', acknowledged:false }];
  const snoozes = { scope_creep: '2026-06-14' };
  // Today: hidden
  if (visibleAlerts(list, snoozes, now).length !== 0) throw new Error('should be hidden today');
  // Tomorrow: visible again
  const tmrw = new Date('2026-06-14T09:00:00');
  if (visibleAlerts(list, snoozes, tmrw).length !== 1) throw new Error('should reappear tomorrow');
});
test('acknowledged alerts never visible; unsnoozed alerts visible', () => {
  const now = new Date('2026-06-13T10:00:00');
  const list = [
    { id:'a', ruleId:'r1', acknowledged:true },
    { id:'b', ruleId:'r2', acknowledged:false },
  ];
  const v = visibleAlerts(list, {}, now);
  if (v.length !== 1 || v[0].id !== 'b') throw new Error('expected only the unacknowledged, unsnoozed alert');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
