#!/usr/bin/env node
/**
 * tests/utilization.test.js
 * Time Utilization: all-busy compute (src/utilization.js) + auth pure helpers
 * (src/gcal-auth.js). Uses the real freebusy.query response captured during the
 * feasibility check so the totals are anchored to real data.
 */
import { mergeIntervals, busyHours, busyHoursByEmail, attachBusyToMembers, meetingHoursAndDaysOff, attachUtilizationToMembers } from '../src/utilization.js';
import { buildFreeBusyBody } from '../src/gcal-auth.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const H = 3.6e6;
test('mergeIntervals merges overlaps so concurrent invites are not double-counted', () => {
  const merged = mergeIntervals([{ start: 0, end: 2 * H }, { start: 1 * H, end: 3 * H }]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].end - merged[0].start, 3 * H); // 3h, not 4h
});
test('mergeIntervals keeps disjoint blocks separate', () => {
  const merged = mergeIntervals([{ start: 0, end: 1 * H }, { start: 2 * H, end: 3 * H }]);
  assert.strictEqual(merged.length, 2);
});
test('busyHours sums merged durations', () => {
  assert.strictEqual(busyHours([
    { start: '2026-06-22T09:00:00Z', end: '2026-06-22T10:00:00Z' },
    { start: '2026-06-22T09:30:00Z', end: '2026-06-22T11:00:00Z' }, // overlaps → union 09:00-11:00
  ]), 2);
});

// Real freebusy.query response (subset of fields) captured during feasibility check
const REAL = { calendars: {
  'a.reda@getzeal.io': { busy: [
    ['2026-06-22T07:30','2026-06-22T08:30'],['2026-06-22T09:45','2026-06-22T10:40'],
    ['2026-06-22T10:45','2026-06-22T13:50'],['2026-06-22T14:15','2026-06-22T14:45'],
    ['2026-06-23T08:30','2026-06-23T09:00'],['2026-06-23T09:30','2026-06-23T11:30'],['2026-06-23T14:00','2026-06-23T14:15'],
    ['2026-06-24T06:00','2026-06-24T06:30'],['2026-06-24T08:30','2026-06-24T09:00'],['2026-06-24T10:15','2026-06-24T12:15'],['2026-06-24T13:00','2026-06-24T14:00'],
    ['2026-06-25T08:30','2026-06-25T09:00'],['2026-06-25T10:00','2026-06-25T11:00'],['2026-06-25T11:30','2026-06-25T13:00'],['2026-06-25T13:30','2026-06-25T14:00'],
  ].map(([start, end]) => ({ start: start + ':00Z', end: end + ':00Z' })) },
  'e.hamza@getzeal.io': { busy: [
    ['2026-06-22T07:30','2026-06-22T08:30'],['2026-06-22T09:45','2026-06-22T13:30'],
    ['2026-06-23T08:30','2026-06-23T11:00'],['2026-06-23T13:00','2026-06-23T13:30'],['2026-06-23T17:00','2026-06-23T18:00'],
    ['2026-06-24T06:00','2026-06-24T06:30'],['2026-06-24T08:30','2026-06-24T09:00'],['2026-06-24T10:15','2026-06-24T12:15'],['2026-06-24T13:00','2026-06-24T14:00'],
    ['2026-06-25T08:30','2026-06-25T09:30'],['2026-06-25T10:00','2026-06-25T10:45'],['2026-06-25T13:00','2026-06-25T13:30'],
  ].map(([start, end]) => ({ start: start + ':00Z', end: end + ':00Z' })) },
  'restricted@getzeal.io': { busy: [], errors: [{ domain: 'global', reason: 'notFound' }] },
}};

test('busyHoursByEmail totals match the real data and skip error calendars', () => {
  const by = busyHoursByEmail(REAL);
  assert.strictEqual(by['a.reda@getzeal.io'], 15.75);
  assert.strictEqual(by['e.hamza@getzeal.io'], 15);
  assert.ok(!('restricted@getzeal.io' in by), 'calendars with errors are skipped');
});

test('attachBusyToMembers maps member name → email → hours (0 when unmapped)', () => {
  const members = [{ name: 'Ahmed Reda', total: 22, byProject: {} }, { name: 'Nobody', total: 10, byProject: {} }];
  const out = attachBusyToMembers(members, { 'Ahmed Reda': 'a.reda@getzeal.io' }, busyHoursByEmail(REAL));
  assert.strictEqual(out[0].busyHours, 15.75);
  assert.strictEqual(out[1].busyHours, 0);
  assert.strictEqual(out[0].total, 22); // logged total untouched
});

// ── auth pure helpers ───────────────────────────────────────────────────────
test('buildFreeBusyBody shapes items as {id} and drops blanks', () => {
  const b = buildFreeBusyBody(['a@x.io', '', 'b@x.io'], '2026-06-22T00:00:00Z', '2026-06-26T00:00:00Z');
  assert.deepStrictEqual(b.items, [{ id: 'a@x.io' }, { id: 'b@x.io' }]);
  assert.strictEqual(b.timeMin, '2026-06-22T00:00:00Z');
});

test('attachBusyToMembers matches names case/space-insensitively', () => {
  const members = [{ name: ' Ahmed Reda ', total: 20, byProject: {} }];
  const out = attachBusyToMembers(members, { 'ahmed reda': 'A.Reda@GetZeal.io' }, { 'a.reda@getzeal.io': 15.75 });
  assert.strictEqual(out[0].busyHours, 15.75);
});

// ── OOO / vacation handling (meeting hours vs. days off) ────────────────────
test('meetingHoursAndDaysOff excludes full-day blocks and counts them as days off', () => {
  const resp = { calendars: { 'a@x.io': { busy: [
    // A full-day vacation block (24h) → 1 day off, NOT 24 busy hours
    { start: '2026-06-24T00:00:00Z', end: '2026-06-25T00:00:00Z' },
    // Two real meetings the next day → 2.5h meeting time
    { start: '2026-06-25T09:00:00Z', end: '2026-06-25T10:00:00Z' },
    { start: '2026-06-25T14:00:00Z', end: '2026-06-25T15:30:00Z' },
  ] } } };
  const out = meetingHoursAndDaysOff(resp, { tzOffsetMinutes: 0 });
  assert.strictEqual(out['a@x.io'].daysOff, 1);
  assert.strictEqual(out['a@x.io'].meetingHours, 2.5);
});

test('meetingHoursAndDaysOff: a multi-day vacation counts each day, adds no busy hours', () => {
  const resp = { calendars: { 'b@x.io': { busy: [
    { start: '2026-06-22T00:00:00Z', end: '2026-06-24T00:00:00Z' }, // 2 full days
  ] } } };
  const out = meetingHoursAndDaysOff(resp, { tzOffsetMinutes: 0 });
  assert.strictEqual(out['b@x.io'].daysOff, 2);
  assert.strictEqual(out['b@x.io'].meetingHours, 0);
});

test('attachUtilizationToMembers sets busyHours (=meeting) + daysOff; unmapped → 0/0', () => {
  const members = [{ name: 'Alice', total: 10, byProject: {} }, { name: 'Bob', total: 5, byProject: {} }];
  const out = attachUtilizationToMembers(
    members,
    { alice: 'a@x.io' },                                   // Bob unmapped
    { 'a@x.io': { meetingHours: 2.5, daysOff: 1 } }
  );
  assert.strictEqual(out[0].busyHours, 2.5);
  assert.strictEqual(out[0].daysOff, 1);
  assert.strictEqual(out[1].busyHours, 0);
  assert.strictEqual(out[1].daysOff, 0);
});

console.log(`\nutilization: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
