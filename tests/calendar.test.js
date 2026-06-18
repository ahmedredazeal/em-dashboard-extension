/**
 * tests/calendar.test.js — src/calendar.js (T-CAL-1)
 * Run: node tests/calendar.test.js
 */
import {
  parseIcsDate, parseICS, todaysMeetings, countdownState, formatCountdown,
  timeLabel, dayKey, ALERT_THRESHOLD_MIN,
} from '../src/calendar.js';

let pass = 0, fail = 0;
function test(n, fn){try{fn();pass++;console.log(`  ✓ ${n}`);}catch(e){fail++;console.log(`  ✗ ${n}\n    ${e.message}`);}}
function assert(c,m='fail'){if(!c)throw new Error(m);}

// Build an ICS string from VEVENT blocks.
function ics(...vevents) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...vevents, 'END:VCALENDAR'].join('\r\n');
}
function vevent(props) {
  return ['BEGIN:VEVENT', ...Object.entries(props).map(([k, v]) => `${k}:${v}`), 'END:VEVENT'].join('\r\n');
}

console.log('\nparseIcsDate');
test('all-day VALUE=DATE → local midnight, allDay', () => {
  const r = parseIcsDate('20260618', { VALUE: 'DATE' });
  assert(r.allDay === true, 'allDay');
  assert(r.date.getFullYear() === 2026 && r.date.getMonth() === 5 && r.date.getDate() === 18, r.date.toString());
});
test('8-digit bare date is treated as all-day', () => {
  assert(parseIcsDate('20260618').allDay === true);
});
test('UTC datetime parses with Z', () => {
  const r = parseIcsDate('20260618T093000Z');
  assert(r.allDay === false);
  assert(r.date.getTime() === Date.UTC(2026, 5, 18, 9, 30, 0), r.date.toISOString());
});
test('floating datetime → local', () => {
  const r = parseIcsDate('20260618T140000');
  assert(r.date.getHours() === 14 && r.date.getMinutes() === 0, r.date.toString());
});

console.log('\nparseICS basics');
test('parses a simple timed event', () => {
  const text = ics(vevent({ UID: 'a@x', SUMMARY: 'Standup', DTSTART: '20260618T090000Z', DTEND: '20260618T091500Z' }));
  const m = parseICS(text, new Date(2026, 5, 18, 8));
  assert(m.length === 1, `len ${m.length}`);
  assert(m[0].title === 'Standup' && m[0].id === 'a@x', JSON.stringify(m[0]));
  assert(m[0].allDay === false && m[0].attendeesCount === 0);
});
test('unescapes summary and counts attendees', () => {
  const text = ics(vevent({ UID: 'b', SUMMARY: 'Plan\\, review', DTSTART: '20260618T090000Z', ATTENDEE: 'mailto:a@x', ['ATTENDEE']: 'mailto:b@x' }));
  // note: object keys dedupe ATTENDEE; build manually instead
  const raw = ics(['BEGIN:VEVENT','UID:b','SUMMARY:Plan\\, review','DTSTART:20260618T090000Z','ATTENDEE:mailto:a@x','ATTENDEE:mailto:b@x','END:VEVENT'].join('\r\n'));
  const m = parseICS(raw, new Date(2026, 5, 18, 8));
  assert(m[0].title === 'Plan, review', m[0].title);
  assert(m[0].attendeesCount === 2, `attendees ${m[0].attendeesCount}`);
});
test('skips CANCELLED events', () => {
  const text = ics(vevent({ UID: 'c', SUMMARY: 'Dead', DTSTART: '20260618T090000Z', STATUS: 'CANCELLED' }));
  assert(parseICS(text, new Date(2026, 5, 18)).length === 0);
});
test('handles folded lines (RFC 5545 continuation)', () => {
  const folded = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:f\r\nSUMMARY:A very long title that has been\r\n  folded across lines\r\nDTSTART:20260618T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const m = parseICS(folded, new Date(2026, 5, 18));
  assert(m[0].title === 'A very long title that has been folded across lines', m[0].title);
});

console.log('\nrecurrence (minimal phase-1 expansion)');
test('DAILY rrule expands to today instance', () => {
  // DTSTART in the past, daily → should appear today
  const text = ics(vevent({ UID: 'd', SUMMARY: 'Daily sync', DTSTART: '20260601T100000', RRULE: 'FREQ=DAILY' }));
  const now = new Date(2026, 5, 18, 8);
  const m = parseICS(text, now);
  const todayInstance = m.find(x => dayKey(new Date(x.start)) === dayKey(now));
  assert(todayInstance, 'should have a today instance');
  assert(new Date(todayInstance.start).getHours() === 10, 'same wall-clock time');
});
test('WEEKLY rrule with BYDAY only expands on matching weekday', () => {
  // 2026-06-18 is a Thursday (TH)
  const now = new Date(2026, 5, 18, 8);
  assert(['TH'].includes(['SU','MO','TU','WE','TH','FR','SA'][now.getDay()]), 'sanity: is Thursday');
  const match = parseICS(ics(vevent({ UID: 'w1', SUMMARY: 'Thu mtg', DTSTART: '20260101T130000', RRULE: 'FREQ=WEEKLY;BYDAY=TH' })), now);
  assert(match.some(x => dayKey(new Date(x.start)) === dayKey(now)), 'TH should expand today');
  const noMatch = parseICS(ics(vevent({ UID: 'w2', SUMMARY: 'Mon mtg', DTSTART: '20260101T130000', RRULE: 'FREQ=WEEKLY;BYDAY=MO' })), now);
  assert(!noMatch.some(x => dayKey(new Date(x.start)) === dayKey(now)), 'MO should not expand on a Thursday');
});
test('UNTIL in the past stops expansion', () => {
  const now = new Date(2026, 5, 18, 8);
  const m = parseICS(ics(vevent({ UID: 'u', SUMMARY: 'Ended', DTSTART: '20260101T100000', RRULE: 'FREQ=DAILY;UNTIL=20260201T000000Z' })), now);
  assert(!m.some(x => dayKey(new Date(x.start)) === dayKey(now)), 'should not appear today');
});

console.log('\ntodaysMeetings');
test('filters to today, separates all-day, sorts timed', () => {
  const now = new Date(2026, 5, 18, 8);
  const text = ics(
    vevent({ UID: '1', SUMMARY: 'Late', DTSTART: '20260618T140000Z' }),
    vevent({ UID: '2', SUMMARY: 'Early', DTSTART: '20260618T090000Z' }),
    vevent({ UID: '3', SUMMARY: 'AllDayThing', DTSTART: '20260618' }),
    vevent({ UID: '4', SUMMARY: 'Tomorrow', DTSTART: '20260619T090000Z' }),
  );
  const { timed, allDay } = todaysMeetings(parseICS(text, now), now);
  assert(timed.length === 2, `timed ${timed.length}`);
  assert(timed[0].title === 'Early' && timed[1].title === 'Late', 'sorted by start');
  assert(allDay.length === 1 && allDay[0].title === 'AllDayThing', 'all-day separated');
});

console.log('\ncountdownState + alert');
test('upcoming beyond threshold → no alert', () => {
  const now = new Date(2026, 5, 18, 8, 0, 0);
  const next = { start: new Date(2026, 5, 18, 10, 0, 0).toISOString() }; // 120 min away
  const s = countdownState(next, now);
  assert(s.status === 'upcoming' && s.alert === false, JSON.stringify(s));
  assert(s.minutesUntil === 120, `mins ${s.minutesUntil}`);
});
test('within 30 min → alert true', () => {
  const now = new Date(2026, 5, 18, 8, 0, 0);
  const next = { start: new Date(2026, 5, 18, 8, 25, 0).toISOString() }; // 25 min
  const s = countdownState(next, now);
  assert(s.alert === true && s.minutesUntil === 25, JSON.stringify(s));
});
test('exactly at threshold (30) → alert true (inclusive)', () => {
  const now = new Date(2026, 5, 18, 8, 0, 0);
  const next = { start: new Date(2026, 5, 18, 8, 30, 0).toISOString() };
  assert(countdownState(next, now).alert === true);
});
test('just over threshold (31) → no alert', () => {
  const now = new Date(2026, 5, 18, 8, 0, 0);
  const next = { start: new Date(2026, 5, 18, 8, 31, 0).toISOString() };
  assert(countdownState(next, now).alert === false);
});
test('in-progress meeting → status in_progress, no alert', () => {
  const now = new Date(2026, 5, 18, 9, 5, 0);
  const next = { start: new Date(2026, 5, 18, 9, 0, 0).toISOString(), end: new Date(2026, 5, 18, 9, 30, 0).toISOString() };
  const s = countdownState(next, now);
  assert(s.status === 'in_progress' && s.alert === false, JSON.stringify(s));
});
test('no next meeting → status none', () => {
  assert(countdownState(null, new Date()).status === 'none');
});
test('todaysMeetings picks in-progress as next when nothing upcoming', () => {
  const now = new Date(2026, 5, 18, 9, 5, 0);
  const text = ics(vevent({ UID: 'p', SUMMARY: 'Now', DTSTART: '20260618T090000Z', DTEND: '20260618T093000Z' }));
  // Build with local-time so the in-progress window holds (use floating times)
  const local = ics(['BEGIN:VEVENT','UID:p','SUMMARY:Now','DTSTART:20260618T090000','DTEND:20260618T093000','END:VEVENT'].join('\r\n'));
  const { next } = todaysMeetings(parseICS(local, now), now);
  assert(next && next.title === 'Now', JSON.stringify(next));
});

console.log('\nformatters');
test('formatCountdown', () => {
  assert(formatCountdown(5) === 'in 5m', formatCountdown(5));
  assert(formatCountdown(80) === 'in 1h 20m', formatCountdown(80));
  assert(formatCountdown(120) === 'in 2h', formatCountdown(120));
  assert(formatCountdown(0) === 'now');
});
test('timeLabel formats local 12h', () => {
  const iso = new Date(2026, 5, 18, 14, 5, 0).toISOString();
  assert(timeLabel(iso) === '2:05 PM', timeLabel(iso));
});
test('ALERT_THRESHOLD_MIN is 30', () => assert(ALERT_THRESHOLD_MIN === 30));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
