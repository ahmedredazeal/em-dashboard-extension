/**
 * tests/changelog-parser.test.js — sprintAddDay + scope-step regression
 * Run: node tests/changelog-parser.test.js
 *
 * Regression for the "+3 points added today invisible on burndown" bug:
 * addScope referenced totalDays before its const declaration (TDZ), so the
 * first real scope change killed the sprint fetch; and mid-sprint additions
 * were dated by estimate-change day instead of sprint-add day.
 */
import { sprintAddDay, wasAddedAfterSprintStart, estimateAtSprintStart, createdDayAfterStart } from '../src/changelog-parser.js';
import { computeBurndownSeries } from '../src/burndown.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
function assertEqual(a, b) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`expected ${jb}, got ${ja}`);
}

const SPRINT_START = '2026-06-08T09:00:00.000+0300';
const SPRINT_ID = 2382;

const issueWith = (histories) => ({ changelog: { histories } });
const sprintChange = (created, from, to) => ({
  created,
  items: [{ field: 'Sprint', from, to }],
});
const estimateChange = (created, fieldId, from, to) => ({
  created,
  items: [{ fieldId, field: 'Story point estimate', from: String(from), fromString: String(from), to: String(to), toString: String(to) }],
});

console.log('\nsprintAddDay');
test('added 2 days after start → day 2', () => {
  const issue = issueWith([sprintChange('2026-06-10T11:00:00.000+0300', '', '2382')]);
  assertEqual(sprintAddDay(issue, SPRINT_START, SPRINT_ID), 2);
});
test('in sprint from the beginning (no Sprint changes after start) → null', () => {
  const issue = issueWith([sprintChange('2026-06-01T11:00:00.000+0300', '', '2382')]);
  assertEqual(sprintAddDay(issue, SPRINT_START, SPRINT_ID), null);
});
test('moved from another sprint counts as added', () => {
  const issue = issueWith([sprintChange('2026-06-09T11:00:00.000+0300', '2300', '2382')]);
  assertEqual(sprintAddDay(issue, SPRINT_START, SPRINT_ID), 1);
});
test('already contained sprint id in from → not an addition', () => {
  const issue = issueWith([sprintChange('2026-06-10T11:00:00.000+0300', '2382', '2382, 2400')]);
  assertEqual(sprintAddDay(issue, SPRINT_START, SPRINT_ID), null);
});
test('no changelog → null', () => {
  assertEqual(sprintAddDay({}, SPRINT_START, SPRINT_ID), null);
});
test('wasAddedAfterSprintStart delegates correctly', () => {
  const added = issueWith([sprintChange('2026-06-10T11:00:00.000+0300', '', '2382')]);
  assert(wasAddedAfterSprintStart(added, SPRINT_START, SPRINT_ID) === true);
  assert(wasAddedAfterSprintStart({}, SPRINT_START, SPRINT_ID) === false);
});

console.log('\nestimateAtSprintStart (sanity for estimateDelta scope path)');
test('estimate edited mid-sprint → startEst is pre-change value + change day', () => {
  const issue = issueWith([estimateChange('2026-06-10T14:00:00.000+0300', 'customfield_10039', 5, 8)]);
  const { startEst, changeDayAfterStart } = estimateAtSprintStart(issue, SPRINT_START, 'customfield_10039');
  assertEqual(startEst, 5);
  assertEqual(changeDayAfterStart, 2);
});
test('ticket estimated from null/unestimated → startEst is 0 (not null)', () => {
  // This is the actual bug: Jira changelog "from" is null when a ticket goes
  // from unestimated to estimated. The old code returned startEst: null, so
  // the delta block never fired and the points silently absorbed into baseline.
  const issue = issueWith([{
    created: '2026-06-10T14:00:00.000+0300',
    items: [{ fieldId: 'customfield_10039', field: 'Story point estimate',
              from: null, fromString: null, to: '3', toString: '3' }],
  }]);
  const { startEst, changeDayAfterStart } = estimateAtSprintStart(issue, SPRINT_START, 'customfield_10039');
  assertEqual(startEst, 0);  // was null → bug; now 0 → delta fires
  assertEqual(changeDayAfterStart, 2);
});
test('ticket estimated from empty string → startEst is 0', () => {
  const issue = issueWith([{
    created: '2026-06-09T10:00:00.000+0300',
    items: [{ fieldId: 'customfield_10039', field: 'Story point estimate',
              from: '', fromString: '', to: '5', toString: '5' }],
  }]);
  const { startEst } = estimateAtSprintStart(issue, SPRINT_START, 'customfield_10039');
  assertEqual(startEst, 0);
});

console.log('\ncomputeBurndownSeries — scope steps land on the right day');
test('+3 estimateDelta on day 2 raises the actual line and tooltip data', () => {
  const bd = computeBurndownSeries(
    { startDate: SPRINT_START, totalDays: 13, totalPoints: 57, committedPoints: 54,
      todayIndex: 2, scopeByDay: { 2: { added: 0, removed: 0, estimateDelta: 3 } } },
    [] // no completions — isolate the scope step
  );
  assertEqual(bd.actual[1], 54);
  assertEqual(bd.actual[2], 57);              // +3 lands ON day 2
  assertEqual(bd.perDayData[2].scopeNet, 3);  // hover tooltip sees it
  assert(bd.hasActualData === true, 'scope change alone must mark hasActualData');
});
test('+5 added ticket on day 1 steps the line up', () => {
  const bd = computeBurndownSeries(
    { startDate: SPRINT_START, totalDays: 13, totalPoints: 59, committedPoints: 54,
      todayIndex: 3, scopeByDay: { 1: { added: 5, removed: 0, estimateDelta: 0 } } },
    []
  );
  assertEqual(bd.actual[0], 54);
  assertEqual(bd.actual[1], 59);
  assertEqual(bd.perDayData[1].scopeNet, 5);
});
test('non-finite day key is ignored, not silently corrupting (NaN guard)', () => {
  const bd = computeBurndownSeries(
    { startDate: SPRINT_START, totalDays: 13, totalPoints: 57, committedPoints: 54,
      todayIndex: 2, scopeByDay: { 'NaN': { added: 3, removed: 0, estimateDelta: 0 },
                                   2:     { added: 0, removed: 0, estimateDelta: 3 } } },
    []
  );
  assertEqual(bd.actual[2], 57);                       // valid key still applied
  assert(bd.actual.every(v => Number.isFinite(v)), 'no NaN leaks into the series');
});

console.log('\ncreatedDayAfterStart (tickets created directly inside the sprint)');
test('created 2 days after sprint start → day 2 (scope addition)', () => {
  const issue = { fields: { created: '2026-06-10T11:30:00.000+0300' } };
  assertEqual(createdDayAfterStart(issue, SPRINT_START), 2);
});
test('created before sprint start → null (part of commitment)', () => {
  const issue = { fields: { created: '2026-06-04T10:00:00.000+0300' } };
  assertEqual(createdDayAfterStart(issue, SPRINT_START), null);
});
test('created same day but AFTER start time → day 0 addition', () => {
  const issue = { fields: { created: '2026-06-08T15:00:00.000+0300' } }; // start is 09:00
  assertEqual(createdDayAfterStart(issue, SPRINT_START), 0);
});
test('created same day but BEFORE start time (during planning) → null', () => {
  const issue = { fields: { created: '2026-06-08T08:00:00.000+0300' } };
  assertEqual(createdDayAfterStart(issue, SPRINT_START), null);
});
test('no created field → null', () => {
  assertEqual(createdDayAfterStart({}, SPRINT_START), null);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
