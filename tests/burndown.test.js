#!/usr/bin/env node
/**
 * tests/burndown.test.js
 * Tests for src/changelog-parser.js and src/burndown.js
 */

import { isDoneStatus, transitionToDoneTimestamp, dayIndex, attachCloseTimestamps } from '../src/changelog-parser.js';
import { computeBurndownSeries, sprintDayLabels } from '../src/burndown.js';

let pass = 0, fail = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); fail++; }
}

function assertEqual(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg || ''}\n      expected: ${sb}\n      actual:   ${sa}`);
}

function assertApprox(a, b, msg, tol = 0.1) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg || ''}: expected ~${b}, got ${a}`);
}

// ── isDoneStatus ───────────────────────────────────────────────────────────
console.log('\nisDoneStatus');
test('done',               () => assertEqual(isDoneStatus('Done'), true));
test('QA Accepted',        () => assertEqual(isDoneStatus('QA Accepted'), true));
test('closed',             () => assertEqual(isDoneStatus('CLOSED'), true));
test('resolved',           () => assertEqual(isDoneStatus('resolved'), true));
test('In Progress → false',() => assertEqual(isDoneStatus('In Progress'), false));
test('QA Rejected → false',() => assertEqual(isDoneStatus('QA Rejected'), false));
test('null → false',       () => assertEqual(isDoneStatus(null), false));
test('empty → false',      () => assertEqual(isDoneStatus(''), false));

// ── transitionToDoneTimestamp ──────────────────────────────────────────────
console.log('\ntransitionToDoneTimestamp');

const issueClosedOnce = {
  changelog: { histories: [
    { created: '2026-05-10T12:00:00Z', items: [{ field: 'status', toString: 'In Progress' }] },
    { created: '2026-05-12T14:00:00Z', items: [{ field: 'status', toString: 'QA Accepted' }] }
  ]}
};
test('returns close timestamp', () => assertEqual(
  transitionToDoneTimestamp(issueClosedOnce), '2026-05-12T14:00:00Z'
));

const issueReopenedThenClosed = {
  changelog: { histories: [
    { created: '2026-05-10T10:00:00Z', items: [{ field: 'status', toString: 'QA Accepted' }] },
    { created: '2026-05-11T09:00:00Z', items: [{ field: 'status', toString: 'QA Rejected' }] },
    { created: '2026-05-13T15:00:00Z', items: [{ field: 'status', toString: 'QA Accepted' }] }
  ]}
};
test('reopened + re-closed: uses LAST close', () => assertEqual(
  transitionToDoneTimestamp(issueReopenedThenClosed), '2026-05-13T15:00:00Z'
));

const issueNotDone = {
  changelog: { histories: [
    { created: '2026-05-10T10:00:00Z', items: [{ field: 'status', toString: 'In Progress' }] }
  ]}
};
test('in progress → null',      () => assertEqual(transitionToDoneTimestamp(issueNotDone), null));
test('no changelog → null',     () => assertEqual(transitionToDoneTimestamp({}), null));
test('empty histories → null',  () => assertEqual(transitionToDoneTimestamp({ changelog: { histories: [] } }), null));

// ── dayIndex ───────────────────────────────────────────────────────────────
console.log('\ndayIndex');
test('same day = 0',    () => assertEqual(dayIndex('2026-05-05T00:00:00Z', '2026-05-05T00:00:00Z'), 0));
test('next day = 1',    () => assertEqual(dayIndex('2026-05-06T00:00:00Z', '2026-05-05T00:00:00Z'), 1));
test('7 days later',    () => assertEqual(dayIndex('2026-05-12T00:00:00Z', '2026-05-05T00:00:00Z'), 7));
test('intra-day = 0',   () => assertEqual(dayIndex('2026-05-05T23:59:00Z', '2026-05-05T00:00:00Z'), 0));

// ── attachCloseTimestamps ──────────────────────────────────────────────────
console.log('\nattachCloseTimestamps');
const rawIssues = [issueClosedOnce, issueNotDone];
const stories = [
  { key: 'HRM-1', points: 5 },
  { key: 'HRM-2', points: 3 }
];
const augmented = attachCloseTimestamps(rawIssues, stories, '2026-05-05T00:00:00Z');
test('closed story has closedAt', () => assertEqual(augmented[0].closedAt, '2026-05-12T14:00:00Z'));
test('closed story has closedDay = 7', () => assertEqual(augmented[0].closedDay, 7));
test('open story closedAt = null',    () => assertEqual(augmented[1].closedAt, null));
test('open story closedDay = null',   () => assertEqual(augmented[1].closedDay, null));
test('original fields preserved',    () => assertEqual(augmented[0].key, 'HRM-1'));

// ── sprintDayLabels ────────────────────────────────────────────────────────
console.log('\nsprintDayLabels');
const labels = sprintDayLabels('2026-05-05T00:00:00Z', 4);
test('returns totalDays+1 entries', () => assertEqual(labels.length, 5));
test('first label is start date',   () => assertEqual(typeof labels[0], 'string'));

// ── computeBurndownSeries ──────────────────────────────────────────────────
console.log('\ncomputeBurndownSeries');

const sprint14 = { startDate: '2026-05-05T00:00:00Z', totalDays: 14, totalPoints: 30 };
const stories14 = [
  { key: 'HRM-1', points: 5, dueDate: '2026-05-08', closedDay: 3 },  // closed day 3
  { key: 'HRM-2', points: 8, dueDate: '2026-05-12', closedDay: 8 },  // closed day 8
  { key: 'HRM-3', points: 3, dueDate: '2026-05-10', closedDay: null },// never closed
  { key: 'HRM-4', points: 14, dueDate: '2026-05-15', closedDay: null }// never closed
];

const result = computeBurndownSeries(sprint14, stories14);

test('ideal array length = totalDays+1', () => assertEqual(result.ideal.length, 15));
test('estimate array length = totalDays+1', () => assertEqual(result.estimate.length, 15));
test('actual array length = totalDays+1',   () => assertEqual(result.actual.length, 15));

test('ideal[0] = totalPoints', () => assertEqual(result.ideal[0], 30));
test('ideal[14] ≈ 0', () => assertApprox(result.ideal[14], 0, 'ideal[14]'));

// Estimate: HRM-1 (5pt, due day 3), HRM-3 (3pt, due day 5), HRM-2 (8pt, due day 7), HRM-4 (14pt, due day 10)
test('estimate[0] = 30 (nothing due yet)', () => assertEqual(result.estimate[0], 30));
test('estimate[3] = 25 (HRM-1 due)',       () => assertEqual(result.estimate[3], 25));
test('estimate[7] = 14 (HRM-1+3+2 due)',   () => assertEqual(result.estimate[7], 14));
test('estimate[10] = 0 (all due)',          () => assertEqual(result.estimate[10], 0));

// Actual: HRM-1 closed day 3 (5pt), HRM-2 closed day 8 (8pt), HRM-3+4 never closed
test('actual[0] = 30',  () => assertEqual(result.actual[0], 30));
test('actual[3] = 25 (HRM-1 closed)',  () => assertEqual(result.actual[3], 25));
test('actual[8] = 17 (HRM-2 closed)',  () => assertEqual(result.actual[8], 17));
test('actual[14] = 17 (HRM-3+4 open)',  () => assertEqual(result.actual[14], 17));

test('hasActualData = true',    () => assertEqual(result.hasActualData, true));
test('totalPoints = 30',        () => assertEqual(result.totalPoints, 30));

// todayIndex: defaults to totalDays when daysElapsed not supplied
test('todayIndex defaults to totalDays', () => assertEqual(result.todayIndex, 14));

// todayIndex: clamps to daysElapsed when supplied (for truncating the actual line)
const sprintMid = { startDate: '2026-05-05T00:00:00Z', totalDays: 14, totalPoints: 30, daysElapsed: 5 };
const resultMid = computeBurndownSeries(sprintMid, stories14);
test('todayIndex = daysElapsed when within sprint', () => assertEqual(resultMid.todayIndex, 5));

const sprintOver = { startDate: '2026-05-05T00:00:00Z', totalDays: 14, totalPoints: 30, daysElapsed: 99 };
const resultOver = computeBurndownSeries(sprintOver, stories14);
test('todayIndex clamps to totalDays when daysElapsed overshoots', () => assertEqual(resultOver.todayIndex, 14));

// Edge: no story points
const sprintEmpty = { startDate: '2026-05-05T00:00:00Z', totalDays: 5, totalPoints: 0 };
const resultEmpty = computeBurndownSeries(sprintEmpty, []);
test('zero points: returns zero-filled arrays', () =>
  assertEqual(resultEmpty.ideal.every(v => v === 0), true)
);

// Edge: stories without due dates don't affect estimate burn, stay in residual
const sprintNoDue = { startDate: '2026-05-05T00:00:00Z', totalDays: 5, totalPoints: 10 };
const storiesNoDue = [
  { key: 'A', points: 10, dueDate: null, closedDay: null }
];
const resultNoDue = computeBurndownSeries(sprintNoDue, storiesNoDue);
test('no due dates: estimate stays flat at total', () =>
  assertEqual(resultNoDue.estimate.every(v => v === 10), true)
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
