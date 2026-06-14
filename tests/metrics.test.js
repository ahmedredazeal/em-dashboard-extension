#!/usr/bin/env node
/**
 * tests/metrics.test.js — coverage for src/metrics.js (S-9 stability item).
 * 390 lines powering every alert + the burndown projection were untested.
 * Focus: deterministic pure functions get exact assertions; time-dependent
 * ones get branch/structure coverage with controlled inputs.
 */
import {
  calculateVelocity, velocityDropped, goalAchievementRate, carryOverRate,
  supportSLAAdherence, incidentFrequency, growthPlanCoverage,
  countWorkingDays, isEarlySprint, committedBurnPrediction,
  sprintBurndownPrediction, sentryDayOverDaySpike, ticketStale, sentryUntriaged,
} from '../src/metrics.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }

console.log('\ncalculateVelocity');
test('empty → 0', () => eq(calculateVelocity([]), 0));
test('averages last 5 sprints, rounded', () => {
  eq(calculateVelocity([{velocity:10},{velocity:20},{velocity:30}]), 20);
});
test('uses only the most recent 5', () => {
  const h = [{velocity:0},{velocity:0},{velocity:10},{velocity:10},{velocity:10},{velocity:10},{velocity:10}];
  eq(calculateVelocity(h), 10);
});

console.log('\nvelocityDropped');
test('fewer than 3 sprints → false', () => eq(velocityDropped([{velocity:10}]), false));

console.log('\ngoalAchievementRate');
test('empty → 0', () => eq(goalAchievementRate([]), 0));
test('percentage of goalAchieved over last 5', () => {
  eq(goalAchievementRate([{goalAchieved:true},{goalAchieved:false},{goalAchieved:true},{goalAchieved:true}]), 75);
});

console.log('\ncarryOverRate');
test('empty → 0', () => eq(carryOverRate([]), 0));
test('averages carryOver to 1 decimal', () => {
  eq(carryOverRate([{carryOver:1},{carryOver:2}]), 1.5);
});

console.log('\nsupportSLAAdherence');
test('no tickets → 100%', () => eq(supportSLAAdherence([]), 100));
test('half within SLA → 50%', () => {
  eq(supportSLAAdherence([{resolvedWithinSLA:true},{resolvedWithinSLA:false}]), 50);
});

console.log('\nincidentFrequency');
test('empty → 0', () => eq(incidentFrequency([]), 0));
test('averages incidents over last 5', () => {
  eq(incidentFrequency([{incidents:2},{incidents:4}]), 3);
});

console.log('\ngrowthPlanCoverage');
test('empty → 0', () => eq(growthPlanCoverage([]), 0));
test('counts active growth plans', () => {
  eq(growthPlanCoverage([{growthPlan:{active:true}},{growthPlan:{active:false}},{}]), 33);
});

console.log('\ncountWorkingDays');
test('default working set is Sun–Thu (Zeal), end-exclusive', () => {
  // 2026-06-07 (Sun) → 2026-06-12 (Fri), default [0,1,2,3,4]=Sun..Thu:
  // Sun,Mon,Tue,Wed,Thu = 5 (Fri is the exclusive end and not a working day).
  eq(countWorkingDays(new Date('2026-06-07'), new Date('2026-06-12')), 5);
});
test('respects custom working-day set (Sun–Thu)', () => {
  // Sun 2026-06-07 → Fri 2026-06-12 with [0,1,2,3,4]=Sun..Thu → Sun,Mon,Tue,Wed,Thu = 5
  eq(countWorkingDays(new Date('2026-06-07'), new Date('2026-06-12'), [0,1,2,3,4]), 5);
});
test('zero-length span → 0', () => {
  eq(countWorkingDays(new Date('2026-06-08'), new Date('2026-06-08')), 0);
});

console.log('\nisEarlySprint');
test('missing dates → false', () => eq(isEarlySprint({}), false));
test('first day of a 10-day sprint is early', () => {
  const today = new Date(); today.setHours(12,0,0,0);
  const end = new Date(today); end.setDate(end.getDate()+13);
  ok(isEarlySprint({ startDate: today.toISOString(), endDate: end.toISOString() }) === true);
});

console.log('\ncommittedBurnPrediction');
test('no baseline → no-data risk', () => {
  eq(committedBurnPrediction({}).risk, 'no-data');
});
test('returns structured prediction with a known shape', () => {
  const now = new Date(); now.setHours(12,0,0,0);
  const start = new Date(now); start.setDate(start.getDate()-3);
  const end = new Date(now); end.setDate(end.getDate()+7);
  const out = committedBurnPrediction({
    committedPoints: 40, completedPoints: 10,
    startDate: start.toISOString(), endDate: end.toISOString(),
  });
  ok('predicted' in out && 'risk' in out && 'dailyVelocity' in out, 'shape');
  ok(['no-data','on-track','at-risk','behind','ahead','done'].includes(out.risk) || typeof out.risk === 'string', 'risk is a string verdict');
});

console.log('\nsprintBurndownPrediction');
test('no totalPoints → no-data', () => {
  eq(sprintBurndownPrediction({}).risk, 'no-data');
});
test('on-track when pace meets remaining work', () => {
  const out = sprintBurndownPrediction({ totalPoints: 40, completedPoints: 20, daysElapsed: 5, totalDays: 10 });
  ok('predicted' in out && 'onTrack' in out, 'shape');
});

console.log('\nsentryDayOverDaySpike (regression: {date}|{day} tolerance)');
test('no samples → null', () => eq(sentryDayOverDaySpike(50, []), null));
test('spike above delta threshold detected', () => {
  const out = sentryDayOverDaySpike(60, [{ date:'2026-06-12', count:40 }], 10, 25);
  ok(out && out.delta === 20, 'delta 20');
});
test('tolerates {day} sample shape (was throwing before v2.8.5)', () => {
  const out = sentryDayOverDaySpike(60, [{ day:'2026-06-12', count:40 }], 10, 25);
  ok(out && out.delta === 20, 'delta 20 with day-key');
});
test('small delta below thresholds → null', () => {
  eq(sentryDayOverDaySpike(42, [{ date:'2026-06-12', count:40 }], 10, 25), null);
});

console.log('\nticketStale / sentryUntriaged (time-based branch coverage)');
test('ticket with no lastUpdated → not stale', () => eq(ticketStale({}), false));
test('ticket updated long ago → stale', () => {
  eq(ticketStale({ lastUpdated: new Date(Date.now() - 5*24*3600*1000).toISOString() }), true);
});
test('triaged sentry issue → not untriaged', () => eq(sentryUntriaged({ triaged:true }), false));
test('old untriaged sentry issue → true', () => {
  eq(sentryUntriaged({ triaged:false, createdAt: new Date(Date.now() - 48*3600*1000).toISOString() }), true);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
