/**
 * tests/engineer-burndown.test.js — src/burndown.js engineerSprintBurndown (T-EBD-1)
 * Run: node tests/engineer-burndown.test.js
 *
 * Verifies the personal burndown scopes to the engineer's stories: committed =
 * sum of their points, window inherited from the sprint, actual line steps down
 * on their completions, and the empty case is handled.
 */
import { engineerSprintBurndown } from '../src/burndown.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

const sprint = {
  startDate: '2026-06-01T00:00:00.000Z',
  totalDays: 10,
  todayIndex: 5,
};

console.log('\nengineerSprintBurndown');
test('committed = sum of my points, not the team total', () => {
  const myStories = [
    { points: 3, closedDay: null, dueDate: null },
    { points: 5, closedDay: null, dueDate: null },
  ];
  const bd = engineerSprintBurndown(sprint, myStories);
  assert(bd.committedPoints === 8, `committed ${bd.committedPoints}`);
  assert(bd.totalPoints === 8, `total ${bd.totalPoints}`);
});
test('inherits the sprint window (totalDays, todayIndex)', () => {
  const bd = engineerSprintBurndown(sprint, [{ points: 4, closedDay: null }]);
  assert(bd.totalDays === 10, `totalDays ${bd.totalDays}`);
  assert(bd.todayIndex === 5, `todayIndex ${bd.todayIndex}`);
  assert(bd.ideal.length === 11, `ideal length ${bd.ideal.length}`); // totalDays+1
});
test('ideal guideline runs from my committed points to 0', () => {
  const bd = engineerSprintBurndown(sprint, [{ points: 10, closedDay: null }]);
  assert(bd.ideal[0] === 10, `ideal[0] ${bd.ideal[0]}`);
  assert(bd.ideal[bd.totalDays] === 0, `ideal[last] ${bd.ideal[bd.totalDays]}`);
});
test('actual line steps down on my completions', () => {
  const myStories = [
    { points: 4, closedDay: 2, dueDate: null },  // done on day 2
    { points: 6, closedDay: null, dueDate: null }, // still open
  ];
  const bd = engineerSprintBurndown(sprint, myStories);
  assert(bd.hasActualData === true, 'should have actual data');
  // remaining at day 0 = 10, after day 2 completion = 6
  assert(bd.actual[0] === 10, `actual[0] ${bd.actual[0]}`);
  assert(bd.actual[2] === 6, `actual[2] ${bd.actual[2]}`);
});
test('no scope-change steps in personal view (scopeByDay empty)', () => {
  const bd = engineerSprintBurndown(sprint, [
    { points: 5, closedDay: 1 }, { points: 5, closedDay: null },
  ]);
  // perDayData scopeNet should be all zero
  assert(bd.perDayData.every(d => d.scopeNet === 0), 'no scope steps expected');
});
test('empty stories → zero series, no crash', () => {
  const bd = engineerSprintBurndown(sprint, []);
  assert(bd.totalPoints === 0, 'total 0');
  assert(bd.hasActualData === false, 'no actual data');
  assert(Array.isArray(bd.ideal), 'ideal is array');
});
test('missing sprint window falls back to 14 days', () => {
  const bd = engineerSprintBurndown({ startDate: '2026-06-01' }, [{ points: 3, closedDay: null }]);
  assert(bd.totalDays === 14, `fallback totalDays ${bd.totalDays}`);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
