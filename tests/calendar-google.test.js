#!/usr/bin/env node
/**
 * tests/calendar-google.test.js
 * googleEventsToMeetings maps events.list items into the internal meeting shape
 * so the same todaysMeetings()/countdown logic powers the Google-mode card.
 */
import { googleEventsToMeetings, todaysMeetings } from '../src/calendar.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
const test = (n, fn) => { try { fn(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fail++; console.log(`  ✗ ${n}\n    ${e.message}`); } };

const items = [
  { id: '1', summary: 'Standup', start: { dateTime: '2026-06-29T09:00:00Z' }, end: { dateTime: '2026-06-29T09:15:00Z' }, attendees: [{}, {}] },
  { id: '2', summary: 'All-hands', start: { date: '2026-06-29' }, end: { date: '2026-06-30' } },
  { id: '3', summary: 'Cancelled', status: 'cancelled', start: { dateTime: '2026-06-29T10:00:00Z' } },
  { id: '4', start: { dateTime: '2026-06-29T11:00:00Z' } }, // no summary → (no title)
];

test('drops cancelled events and keeps the rest', () => {
  const m = googleEventsToMeetings(items);
  assert.strictEqual(m.length, 3);
  assert.ok(!m.some(x => x.id === '3'));
});
test('maps title, all-day flag, and attendee count', () => {
  const m = googleEventsToMeetings(items);
  const standup = m.find(x => x.id === '1');
  const allhands = m.find(x => x.id === '2');
  assert.strictEqual(standup.title, 'Standup');
  assert.strictEqual(standup.attendeesCount, 2);
  assert.strictEqual(allhands.allDay, true);
  assert.strictEqual(m.find(x => x.id === '4').title, '(no title)');
});
test('result feeds todaysMeetings cleanly', () => {
  const now = new Date('2026-06-29T08:00:00Z');
  const view = todaysMeetings(googleEventsToMeetings(items), now);
  assert.ok(view.next && view.next.title === 'Standup'); // earliest upcoming
  assert.ok(view.timed.length >= 1 && view.allDay.length === 1);
});
test('empty / missing input is safe', () => {
  assert.deepStrictEqual(googleEventsToMeetings(null), []);
  assert.deepStrictEqual(googleEventsToMeetings([]), []);
});

console.log(`\ncalendar-google: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
