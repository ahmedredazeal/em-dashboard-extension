/**
 * tests/support-board-svg.test.js — src/render/support-board-svg.js
 * Run: node tests/support-board-svg.test.js
 *
 * Covers board selection, status ordering, count bars, blocked-external
 * tracking + summary, and the empty/no-support-board guards.
 */
import { buildSupportBoardChart } from '../src/render/support-board-svg.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

const board = (stories) => [{ boardLabel: 'Support|176', stories }];

console.log('\nguards');
test('no boards → empty string', () => assert(buildSupportBoardChart([]) === ''));
test('no support board → empty string', () => {
  assert(buildSupportBoardChart([{ boardLabel: 'Dev Board', stories: [{ status: 'Open' }] }]) === '');
});
test('support board with no stories → empty string', () => {
  assert(buildSupportBoardChart([{ boardLabel: 'Support', stories: [] }]) === '');
});

console.log('\nstructure & counts');
test('renders the card header with open count', () => {
  const html = buildSupportBoardChart(board([{ status: 'Open' }, { status: 'Open' }, { status: 'In Progress' }]));
  assert(html.includes('SUPPORT BOARD BREAKDOWN'), 'header missing');
  assert(html.includes('>3 open<'), 'open count wrong');
});
test('one row per distinct status', () => {
  const html = buildSupportBoardChart(board([
    { status: 'Open' }, { status: 'In Progress' }, { status: 'QA Testing' },
  ]));
  // each status label appears in a row
  assert(html.includes('>Open<'), 'Open row');
  assert(html.includes('>In Progress<'), 'In Progress row');
  assert(html.includes('>QA Testing<'), 'QA Testing row');
});
test('in-progress statuses sort before Open', () => {
  const html = buildSupportBoardChart(board([{ status: 'Open' }, { status: 'In Progress' }]));
  assert(html.indexOf('>In Progress<') < html.indexOf('>Open<'), 'ordering wrong');
});
test('status colour applied (In Progress = blue)', () => {
  const html = buildSupportBoardChart(board([{ status: 'In Progress' }]));
  assert(html.includes('#3b82f6'), 'In Progress colour missing');
});
test('unknown status falls back to default colour', () => {
  const html = buildSupportBoardChart(board([{ status: 'Weird Status' }]));
  assert(html.includes('#6366f1'), 'fallback colour missing');
});

console.log('\nblocked-external');
test('per-status blocked badge shown', () => {
  const html = buildSupportBoardChart(board([
    { status: 'In Progress', labels: ['blocked-external'] },
    { status: 'In Progress', labels: [] },
  ]));
  assert(html.includes('⚠ 1 blocked'), 'per-status blocked badge missing');
});
test('blocked summary line aggregates across statuses', () => {
  const html = buildSupportBoardChart(board([
    { status: 'In Progress', labels: ['blocked-external'] },
    { status: 'QA Testing', labels: ['blocked-external'] },
  ]));
  assert(html.includes('2 tickets blocked-external across 2 statuses'), 'summary wrong: ' + (html.match(/\d+ tickets? blocked-external across[^<]*/)||['none'])[0]);
});
test('no blocked summary when none blocked', () => {
  const html = buildSupportBoardChart(board([{ status: 'Open' }]));
  assert(!html.includes('blocked-external across'), 'summary should be absent');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
