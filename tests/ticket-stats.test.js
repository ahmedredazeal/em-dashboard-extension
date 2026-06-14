/**
 * tests/ticket-stats.test.js — src/ticket-stats.js
 * Run: node tests/ticket-stats.test.js
 */
import { ticketCounts } from '../src/ticket-stats.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
const eq = (a, b) => assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

console.log('\nticketCounts');
test('empty list → zeros', () => {
  eq(ticketCounts([]), { byStatus: {}, breached: 0, blocked: 0, total: 0 });
});
test('groups by status name', () => {
  const r = ticketCounts([{ status: 'Open' }, { status: 'Open' }, { status: 'In Progress' }]);
  eq(r.byStatus, { Open: 2, 'In Progress': 1 });
  assert(r.total === 3, 'total');
});
test('missing status → Unknown bucket', () => {
  const r = ticketCounts([{ status: null }, {}]);
  eq(r.byStatus, { Unknown: 2 });
});
test('counts BreachedSLA + blocked-external labels', () => {
  const r = ticketCounts([
    { status: 'Open', labels: ['BreachedSLA'] },
    { status: 'Open', labels: ['blocked-external'] },
    { status: 'Open', labels: ['BreachedSLA', 'blocked-external'] },
    { status: 'Open', labels: [] },
  ]);
  assert(r.breached === 2, `breached ${r.breached}`);
  assert(r.blocked === 2, `blocked ${r.blocked}`);
  assert(r.total === 4, 'total');
});
test('handles missing labels array safely', () => {
  const r = ticketCounts([{ status: 'Open' }]);
  assert(r.breached === 0 && r.blocked === 0, 'no labels → 0/0');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
