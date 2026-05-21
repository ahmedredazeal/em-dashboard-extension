#!/usr/bin/env node
/**
 * tests/timesheet.test.js
 * Sprint starts 2026-05-05 (Tuesday). UTC calendar for May 2026:
 *   May 3=Sun, 4=Mon, 5=Tue, 6=Wed, 7=Thu, 8=Fri, 9=Sat, 10=Sun,
 *   11=Mon, 12=Tue, 13=Wed, 14=Thu, 15=Fri, 16=Sat, 17=Sun, 18=Mon
 * Working days default: [0,1,2,3,4] = Sun,Mon,Tue,Wed,Thu
 */

import {
  classifyWorklogWeek,
  computeTimesheet,
  extractWorklogs,
  sortTimesheetMembers,
  DEFAULT_WORKING_DAYS
} from '../src/timesheet.js';

let pass = 0, fail = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
function assertEqual(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg || ''}\n      expected: ${sb}\n      actual:   ${sa}`);
}
function assertClose(a, b, msg, tol = 0.01) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg || ''}: expected ${b}, got ${a}`);
}

const SPRINT_START = '2026-05-05T00:00:00Z'; // Tuesday (UTC day 2)

console.log('\nDEFAULT_WORKING_DAYS');
test('contains Sun-Thu (0-4)', () => assertEqual(DEFAULT_WORKING_DAYS, [0,1,2,3,4]));

console.log('\nclassifyWorklogWeek — Sun-Thu working days (default)');
// Week 1 = day 0-6, Week 2 = day 7-13
// Working days in week1: Tue 5(d0), Wed 6(d1), Thu 7(d2), Sun 10(d5), Mon 11(d6)
// Non-working:           Fri 8(d3), Sat 9(d4)
// Working days in week2: Tue 12(d7), Wed 13(d8), Thu 14(d9), Sun 17(d12), Mon 18(d13)
// Non-working:           Fri 15(d10), Sat 16(d11)

test('Tue 5-May  (day 0, Tue=2) = week1',  () => assertEqual(classifyWorklogWeek('2026-05-05T09:00:00Z', SPRINT_START), 'week1'));
test('Thu 7-May  (day 2, Thu=4) = week1',  () => assertEqual(classifyWorklogWeek('2026-05-07T09:00:00Z', SPRINT_START), 'week1'));
test('Sun 10-May (day 5, Sun=0) = week1',  () => assertEqual(classifyWorklogWeek('2026-05-10T09:00:00Z', SPRINT_START), 'week1'));
test('Mon 11-May (day 6, Mon=1) = week1',  () => assertEqual(classifyWorklogWeek('2026-05-11T09:00:00Z', SPRINT_START), 'week1'));
test('Tue 12-May (day 7, Tue=2) = week2',  () => assertEqual(classifyWorklogWeek('2026-05-12T09:00:00Z', SPRINT_START), 'week2'));
test('Thu 14-May (day 9, Thu=4) = week2',  () => assertEqual(classifyWorklogWeek('2026-05-14T09:00:00Z', SPRINT_START), 'week2'));
test('Sun 17-May (day 12, Sun=0) = week2', () => assertEqual(classifyWorklogWeek('2026-05-17T09:00:00Z', SPRINT_START), 'week2'));
test('Mon 18-May (day 13, Mon=1) = week2', () => assertEqual(classifyWorklogWeek('2026-05-18T09:00:00Z', SPRINT_START), 'week2'));
test('Fri 8-May  (day 3, Fri=5) = null (non-working)', () => assertEqual(classifyWorklogWeek('2026-05-08T09:00:00Z', SPRINT_START), null));
test('Sat 9-May  (day 4, Sat=6) = null (non-working)', () => assertEqual(classifyWorklogWeek('2026-05-09T09:00:00Z', SPRINT_START), null));
test('Fri 15-May (day 10, Fri=5)= null (non-working)', () => assertEqual(classifyWorklogWeek('2026-05-15T09:00:00Z', SPRINT_START), null));
test('before sprint start = null', () => assertEqual(classifyWorklogWeek('2026-05-04T09:00:00Z', SPRINT_START), null));
test('after sprint end (day 14)= null', () => assertEqual(classifyWorklogWeek('2026-05-19T09:00:00Z', SPRINT_START), null));
test('null worklog = null', () => assertEqual(classifyWorklogWeek(null, SPRINT_START), null));

console.log('\nclassifyWorklogWeek — Mon-Fri [1,2,3,4,5]');
test('Thu 7-May (Thu=4, in Mon-Fri) = week1', () => assertEqual(classifyWorklogWeek('2026-05-07T09:00:00Z', SPRINT_START, [1,2,3,4,5]), 'week1'));
test('Fri 8-May (Fri=5, in Mon-Fri) = week1', () => assertEqual(classifyWorklogWeek('2026-05-08T09:00:00Z', SPRINT_START, [1,2,3,4,5]), 'week1'));
test('Sun 10-May (Sun=0, not in Mon-Fri) = null', () => assertEqual(classifyWorklogWeek('2026-05-10T09:00:00Z', SPRINT_START, [1,2,3,4,5]), null));
test('Sat 9-May  (Sat=6, not in Mon-Fri) = null', () => assertEqual(classifyWorklogWeek('2026-05-09T09:00:00Z', SPRINT_START, [1,2,3,4,5]), null));

console.log('\ncomputeTimesheet');
const worklogs = [
  // Ahmed: 8h Tue 5-May(w1), 4h Thu 7-May(w1), 6h Tue 12-May(w2), 4h Fri 8-May(excluded)
  { author: { displayName: 'Ahmed' }, started: '2026-05-05T09:00:00Z', timeSpentSeconds: 28800 },
  { author: { displayName: 'Ahmed' }, started: '2026-05-07T10:00:00Z', timeSpentSeconds: 14400 },
  { author: { displayName: 'Ahmed' }, started: '2026-05-12T09:00:00Z', timeSpentSeconds: 21600 },
  { author: { displayName: 'Ahmed' }, started: '2026-05-08T09:00:00Z', timeSpentSeconds: 14400 }, // Fri excl
  // Khalid: 6h Wed 6-May(w1), 8h Thu 14-May(w2)
  { author: { displayName: 'Khalid' }, started: '2026-05-06T09:00:00Z', timeSpentSeconds: 21600 },
  { author: { displayName: 'Khalid' }, started: '2026-05-14T09:00:00Z', timeSpentSeconds: 28800 }
];

const ts = computeTimesheet(worklogs, SPRINT_START);
test('Ahmed week1 = 12h (8+4)',     () => assertClose(ts['Ahmed'].week1, 12, 'Ahmed week1'));
test('Ahmed week2 = 6h',            () => assertClose(ts['Ahmed'].week2, 6,  'Ahmed week2'));
test('Friday (8-May) excluded',     () => assertClose(ts['Ahmed'].week1, 12, 'Fri excluded'));
test('Khalid week1 = 6h',          () => assertClose(ts['Khalid'].week1, 6,  'Khalid week1'));
test('Khalid week2 = 8h',          () => assertClose(ts['Khalid'].week2, 8,  'Khalid week2'));
test('empty = {}',                  () => assertEqual(computeTimesheet([], SPRINT_START), {}));
test('null = {}',                   () => assertEqual(computeTimesheet(null, SPRINT_START), {}));

// Mon-Fri: Sun 10-May should be excluded
const tsMF = computeTimesheet([
  ...worklogs,
  { author: { displayName: 'Ahmed' }, started: '2026-05-10T09:00:00Z', timeSpentSeconds: 14400 } // Sun week1
], SPRINT_START, [1,2,3,4,5]);
test('Mon-Fri: Sun 10-May excluded → Ahmed week1 = 16h (Fri 8-May now included)', () => assertClose(tsMF['Ahmed'].week1, 16, 'Sun excluded'));

console.log('\nextractWorklogs');
const issueA = { key: 'HRM-1', fields: { worklog: { total: 2, maxResults: 20, worklogs: Array(2).fill({ author: { displayName: 'A' }, started: '2026-05-05T09:00:00Z', timeSpentSeconds: 3600 }) } } };
const issueB = { key: 'HRM-2', fields: { worklog: { total: 25, maxResults: 20, worklogs: Array(20).fill({ author: { displayName: 'B' }, started: '2026-05-05T09:00:00Z', timeSpentSeconds: 3600 }) } } };
const issueC = { key: 'HRM-3', fields: {} };
const { worklogs: wls, needsFullFetch } = extractWorklogs([issueA, issueB, issueC]);
test('extracts 22 inline worklogs', () => assertEqual(wls.length, 22));
test('HRM-1 no full fetch needed',  () => assertEqual(needsFullFetch.includes('HRM-1'), false));
test('HRM-2 needs full fetch',      () => assertEqual(needsFullFetch.includes('HRM-2'), true));
test('HRM-3 not in fullFetch',      () => assertEqual(needsFullFetch.includes('HRM-3'), false));

console.log('\nsortTimesheetMembers');
const sorted = sortTimesheetMembers({ Ahmed: { week1: 12, week2: 6 }, Khalid: { week1: 6, week2: 8 }, Mona: { week1: 0, week2: 2 } });
test('sorted desc by total', () => assertEqual(sorted.map(m => m.name), ['Ahmed', 'Khalid', 'Mona']));
test('totals correct', () => assertEqual(sorted.map(m => m.total), [18, 14, 2]));
test('week1 preserved', () => assertEqual(sorted[0].week1, 12));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
