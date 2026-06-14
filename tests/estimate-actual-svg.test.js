/**
 * tests/estimate-actual-svg.test.js — src/render/estimate-actual-svg.js
 * Run: node tests/estimate-actual-svg.test.js
 *
 * Covers the estimate-vs-actual card: title/date-range, per-member bars,
 * over/under ratio colours, the total>0 filter, and the estimate underbar.
 */
import { buildEstimateVsActualCard } from '../src/render/estimate-actual-svg.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

const members = () => ([
  { name: 'Ahmed Reda', total: 34, estimated: 30, estimateRatio: 1.13 },
  { name: 'Sara',       total: 42, estimated: 28, estimateRatio: 1.5  },
  { name: 'Omar',       total: 12, estimated: 20, estimateRatio: 0.6  },
]);

console.log('\nstructure');
test('renders the card with title', () => {
  const html = buildEstimateVsActualCard(members());
  assert(html.includes('ESTIMATE VS ACTUAL'), 'title missing');
  assert(html.includes('<svg'), 'svg missing');
});
test('date range shown when provided, omitted when not', () => {
  assert(buildEstimateVsActualCard(members(), 'This sprint').includes('This sprint'), 'range missing');
  const noRange = buildEstimateVsActualCard(members());
  // no stray date-range div text
  assert(!/margin-bottom:4px;">[A-Z]/.test(noRange), 'unexpected range div');
});

console.log('\nrows & filtering');
test('one set of bars per member with total > 0', () => {
  const html = buildEstimateVsActualCard(members());
  // 3 members, each has an actual <rect ... fill="#6366f1"
  assert((html.match(/fill="#6366f1"/g) || []).length === 3, 'actual bar count');
});
test('members with total = 0 are filtered out', () => {
  const html = buildEstimateVsActualCard([
    { name: 'Active', total: 10, estimated: 8, estimateRatio: 1.25 },
    { name: 'Idle',   total: 0,  estimated: 5, estimateRatio: 1 },
  ]);
  assert(html.includes('Active'), 'active member missing');
  assert(!html.includes('Idle'), 'zero-total member should be filtered');
});
test('estimate underbar only when estimated > 0', () => {
  const withEst = buildEstimateVsActualCard([{ name: 'A', total: 10, estimated: 8, estimateRatio: 1.25 }]);
  const noEst   = buildEstimateVsActualCard([{ name: 'B', total: 10, estimated: 0, estimateRatio: null }]);
  // underbar is the height=3 rect
  assert(withEst.includes('height="3"'), 'estimate underbar missing');
  assert(!noEst.includes('height="3"'), 'underbar should be absent when no estimate');
});

console.log('\nratio colours');
test('over (>1.3) → orange', () => {
  const html = buildEstimateVsActualCard([{ name: 'Over', total: 40, estimated: 20, estimateRatio: 2.0 }]);
  assert(html.includes('#f97316'), 'over colour missing');
  assert(html.includes('×2.0'), 'ratio text missing');
});
test('under (<0.7) → green', () => {
  const html = buildEstimateVsActualCard([{ name: 'Under', total: 10, estimated: 20, estimateRatio: 0.5 }]);
  assert(html.includes('#22c55e'), 'under colour missing');
  assert(html.includes('×0.5'), 'ratio text missing');
});
test('null ratio → muted, no ratio badge on the row', () => {
  const html = buildEstimateVsActualCard([{ name: 'NoEst', total: 10, estimated: 0, estimateRatio: null }]);
  // The legend always contains "×1.3+" / "×0.7−"; the ROW badge should be empty.
  // Strip the legend (everything from "■ Logged" onward) and check the row area.
  const rowArea = html.split('■ Logged')[0];
  assert(!rowArea.includes('×'), 'row should have no ratio badge when ratio is null');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
