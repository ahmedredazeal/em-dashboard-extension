/**
 * tests/sentry-trend-svg.test.js — src/render/sentry-trend-svg.js
 * Run: node tests/sentry-trend-svg.test.js
 *
 * Covers the multi-view trend card: legend + deltas, hidden-view filtering,
 * no-data prompt, trend points, gap shading (single line), and export menu.
 */
import { buildMultiTrendCardHTML } from '../src/render/sentry-trend-svg.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

const series = () => ([
  { viewId: '201', label: 'BE Issues', color: '#6366f1', samples: [
    { day: '2026-06-01', count: 42 }, { day: '2026-06-02', count: 45 }, { day: '2026-06-03', count: 40 } ] },
  { viewId: '202', label: 'FE Issues', color: '#a78bfa', samples: [
    { day: '2026-06-01', count: 10 }, { day: '2026-06-02', count: 12 } ] },
]);

console.log('\nstructure');
test('renders the trend card wrap + header', () => {
  const html = buildMultiTrendCardHTML(series());
  assert(html.includes('class="sentry-trend-wrap"'), 'wrap missing');
  assert(html.includes('Sentry Trend · last 30 days'), 'header missing');
});
test('renders an svg with trend points', () => {
  const html = buildMultiTrendCardHTML(series());
  assert(html.includes('<svg'), 'no svg');
  assert(html.includes('class="trend-point"'), 'no hover points');
});
test('legend item per series with latest count', () => {
  const html = buildMultiTrendCardHTML(series());
  assert((html.match(/class="trend-legend-item"/g) || []).length === 2, 'legend count');
  assert(html.includes('>40<'), 'BE latest (40) missing');
  assert(html.includes('>12<'), 'FE latest (12) missing');
});
test('day-over-day delta shown (BE 45→40 = ↓5)', () => {
  const html = buildMultiTrendCardHTML(series());
  assert(html.includes('↓5'), 'down delta missing');
});

console.log('\nhidden views');
test('hidden view is greyed + struck through but still in legend', () => {
  const html = buildMultiTrendCardHTML(series(), new Set(['202']));
  assert(html.includes('line-through'), 'hidden styling missing');
  // still listed in legend
  assert((html.match(/class="trend-legend-item"/g) || []).length === 2, 'hidden view dropped from legend');
});
test('hiding the only data view → no-data prompt', () => {
  const html = buildMultiTrendCardHTML([series()[0]], new Set(['201']));
  assert(html.includes('Open the panel daily'), 'no-data prompt missing');
  assert(html.includes('some lines hidden'), 'hidden-note missing');
});

console.log('\nno data');
test('series with empty samples → prompt, no svg points', () => {
  const html = buildMultiTrendCardHTML([{ viewId: 'x', label: 'Empty', color: '#fff', samples: [] }]);
  assert(html.includes('Open the panel daily'), 'prompt missing');
  assert(!html.includes('class="trend-point"'), 'should have no points');
});

console.log('\ngap shading (single line)');
test('single line with a gap renders gap shading', () => {
  const gapped = [{ viewId: '201', label: 'BE', color: '#6366f1', samples: [
    { day: '2026-06-01', count: 10 }, { day: '2026-06-05', count: 20 } ] }]; // 3-day gap
  const html = buildMultiTrendCardHTML(gapped);
  assert(html.includes('no data ·'), 'gap label missing');
});
test('multi-line does NOT gap-shade (keeps it readable)', () => {
  const html = buildMultiTrendCardHTML(series());
  assert(!html.includes('no data ·'), 'multi-line should not gap-shade');
});

console.log('\nexport menu');
test('export item per view + "All views" when >1', () => {
  const html = buildMultiTrendCardHTML(series());
  assert((html.match(/class="sentry-export-item"/g) || []).length === 3, 'expected 2 views + All');
  assert(html.includes('All views (separate files)'), 'All-views item missing');
});
test('no "All views" item with a single view', () => {
  const html = buildMultiTrendCardHTML([series()[0]]);
  assert(!html.includes('All views'), 'should not show All for single view');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
