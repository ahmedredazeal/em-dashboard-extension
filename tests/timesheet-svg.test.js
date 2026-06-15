/**
 * tests/timesheet-svg.test.js — src/render/timesheet-svg.js
 * Run: node tests/timesheet-svg.test.js
 *
 * Covers the bug-prone parts of the Time Logged render: empty guard, stacked
 * segments + per-segment hover data, the capacity line, and over-capacity
 * flagging.
 *
 * Note: this module uses a pure HTML-escape that ALSO escapes quotes, whereas
 * popup's old DOM-based escapeHtml did not. For all realistic inputs (engineer
 * names, Jira project keys — no quotes) the output is byte-identical; where a
 * value contains a quote the pure version is strictly safer (the DOM version
 * produced broken attribute markup). Verified byte-identical vs HEAD on
 * realistic data before shipping.
 */
import { buildTimesheetSVG } from '../src/render/timesheet-svg.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

const members = () => ([
  { name: 'Ahmed Reda', total: 34, byProject: { HRM: 20, ATH: 14 } },
  { name: 'Sara',       total: 41, byProject: { HRM: 30, HRMSP: 11 } },
]);

console.log('\nempty guard');
test('no members → empty string', () => assert(buildTimesheetSVG([]) === ''));
test('null members → empty string', () => assert(buildTimesheetSVG(null) === ''));

console.log('\nstructure & segments');
test('renders ts-wrap + tooltip + svg', () => {
  const html = buildTimesheetSVG(members());
  assert(html.includes('class="ts-wrap"'), 'no wrap');
  assert(html.includes('class="ts-tooltip"'), 'no tooltip');
  assert(html.includes('<svg'), 'no svg');
});
test('one ts-seg per (member,project) with hover data attrs', () => {
  const html = buildTimesheetSVG(members());
  // 2 + 2 = 4 segments
  assert((html.match(/class="ts-seg"/g) || []).length === 4, 'wrong segment count');
  assert(html.includes('data-ts-proj="HRM"'), 'missing project attr');
  assert(html.includes('data-ts-hrs="20"'), 'missing hours attr');
  assert(html.includes('data-ts-name="Ahmed Reda"'), 'missing name attr');
});
test('total label rendered per member', () => {
  const html = buildTimesheetSVG(members());
  assert(html.includes('>34h<'), 'missing 34h total');
  assert(html.includes('>41h<'), 'missing 41h total');
});

console.log('\ncapacity line & over-capacity flag');
test('no capacity → no cap line, no warning', () => {
  const html = buildTimesheetSVG(members(), 0);
  assert(!html.includes('cap '), 'cap line should be absent');
  assert(!html.includes('⚠'), 'no warning expected');
});
test('capacity line drawn with label', () => {
  const html = buildTimesheetSVG(members(), 35);
  assert(html.includes('cap 35h'), 'missing capacity label');
  assert(html.includes('stroke-dasharray="4,3"'), 'missing dashed cap line');
});
test('member over capacity is flagged ⚠ + amber', () => {
  // Sara logs 41h > 35h capacity
  const html = buildTimesheetSVG(members(), 35);
  assert(html.includes('⚠ Sara'), 'Sara should be flagged');
  assert(html.includes('#f59e0b'), 'amber colour missing');
});
test('member under capacity is NOT flagged', () => {
  // Both under a high capacity
  const html = buildTimesheetSVG(members(), 100);
  assert(!html.includes('⚠'), 'nobody should be flagged under high capacity');
});

console.log('\ndual lines: fixed cap + pace marker (T-CAP-1 v2.12.2)');
test('object {fixed, pace} draws both lines with distinct labels', () => {
  const html = buildTimesheetSVG(members(), { fixed: 60, pace: 30 });
  assert(html.includes('cap 60h'), 'missing fixed cap label');
  assert(html.includes('pace 30h'), 'missing pace label');
  assert(html.includes('stroke-dasharray="4,3"'), 'missing cap dash style');
  assert(html.includes('stroke-dasharray="2,2"'), 'missing pace dot style');
});
test('over-capacity ⚠ keys off the FIXED cap, not pace', () => {
  // Sara=41h. Fixed cap 35 → flagged. Pace 10 is irrelevant to the flag.
  const html = buildTimesheetSVG(members(), { fixed: 35, pace: 10 });
  assert(html.includes('⚠ Sara'), 'Sara should be flagged vs fixed cap');
});
test('pace omitted/zero → only the cap line', () => {
  const html = buildTimesheetSVG(members(), { fixed: 60, pace: 0 });
  assert(html.includes('cap 60h'), 'cap present');
  assert(!html.includes('pace '), 'no pace line when pace=0');
});
test('pace == fixed → pace line suppressed (no duplicate)', () => {
  const html = buildTimesheetSVG(members(), { fixed: 60, pace: 60 });
  assert(html.includes('cap 60h'), 'cap present');
  assert(!html.includes('pace 60h'), 'pace suppressed when equal to cap');
});
test('legacy number form still = fixed cap only', () => {
  const html = buildTimesheetSVG(members(), 35);
  assert(html.includes('cap 35h'), 'number form still draws cap');
  assert(!html.includes('pace '), 'number form draws no pace line');
});

console.log('\nescaping');
test('ampersand in name/key is escaped (matches old behaviour)', () => {
  const html = buildTimesheetSVG([{ name: 'A & B', total: 5, byProject: { 'X&Y': 5 } }], 0);
  assert(html.includes('A &amp; B'), 'name ampersand not escaped');
  assert(html.includes('X&amp;Y'), 'project ampersand not escaped');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
