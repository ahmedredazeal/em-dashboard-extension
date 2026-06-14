/**
 * tests/burndown-svg.test.js — src/render/burndown-svg.js
 * Run: node tests/burndown-svg.test.js
 *
 * Covers the bug-prone parts of the burndown render: nice-step axis, scope-step
 * tooltips, the "no data yet" path, and the actual-line-stops-at-today rule.
 */
import { buildBurndownSVG, niceStep, BD_COLORS } from '../src/render/burndown-svg.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

const baseBd = () => ({
  ideal:    [54, 48, 42, 36, 30, 24, 18, 12, 6, 0],
  estimate: [54, 50, 45, 38, 30, 28, 20, 15, 8, 2],
  actual:   [54, 54, 57, 50, 44],
  labels:   ['08 Jun 2026','09 Jun 2026','10 Jun 2026','11 Jun 2026','12 Jun 2026','13 Jun 2026','14 Jun 2026','15 Jun 2026','16 Jun 2026','17 Jun 2026'],
  totalPoints: 57, committedPoints: 54, totalDays: 9, hasActualData: true, todayIndex: 4,
  perDayData: [{}, {completedDelta:0,scopeNet:0}, {completedDelta:0,scopeNet:3}, {completedDelta:7,scopeNet:0}, {completedDelta:6,scopeNet:0}],
});

console.log('\nniceStep');
test('0 → 1', () => assert(niceStep(0) === 1));
test('rounds to 1/2/5 × 10ⁿ', () => {
  assert(niceStep(57, 4) === 20, `got ${niceStep(57,4)}`);   // 57/4≈14 → 20
  assert(niceStep(40, 4) === 10, `got ${niceStep(40,4)}`);   // 40/4=10 → 10
  assert(niceStep(8, 4) === 2,  `got ${niceStep(8,4)}`);     // 8/4=2 → 2
});

console.log('\nbuildBurndownSVG — structure');
test('returns a bd-wrap with svg + tooltip div', () => {
  const html = buildBurndownSVG(baseBd());
  assert(html.includes('class="bd-wrap"'), 'no wrap');
  assert(html.includes('<svg'), 'no svg');
  assert(html.includes('class="bd-tooltip"'), 'no tooltip div');
});
test('renders committed + by-due-date polylines', () => {
  const html = buildBurndownSVG(baseBd());
  assert(html.includes('Committed'), 'no committed legend');
  assert(html.includes('By due date'), 'no estimate legend');
});

console.log('\nbuildBurndownSVG — scope & completion tooltips');
test('+3 scope-added day produces the scope tooltip + amber segment', () => {
  const html = buildBurndownSVG(baseBd());
  assert(html.includes('+3 scope added'), 'scope tooltip missing');
  assert(html.includes('#BA7517'), 'amber +scope colour missing');
});
test('completed days produce a "points completed" tooltip', () => {
  const html = buildBurndownSVG(baseBd());
  assert(html.includes('points completed') || html.includes('point completed'), 'completed tooltip missing');
});
test('day 0 tooltip says committed', () => {
  const html = buildBurndownSVG(baseBd());
  assert(html.includes('committed'), 'day-0 committed text missing');
});
test('one bd-point per day up to today (todayIndex 4 → 5 points)', () => {
  const html = buildBurndownSVG(baseBd());
  assert((html.match(/class="bd-point"/g) || []).length === 5, 'wrong hover-target count');
});

console.log('\nbuildBurndownSVG — no-actual-data path');
test('hasActualData=false shows the "no data yet" legend and no bd-points', () => {
  const bd = { ...baseBd(), hasActualData: false, actual: [54], todayIndex: 0, perDayData: [{}] };
  const html = buildBurndownSVG(bd);
  assert(html.includes('no data yet'), 'missing no-data legend');
  assert((html.match(/class="bd-point"/g) || []).length === 0, 'should have no hover targets');
});

console.log('\nBD_COLORS');
test('exposes the palette', () => assert(BD_COLORS.ideal && BD_COLORS.actual && BD_COLORS.grid));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
