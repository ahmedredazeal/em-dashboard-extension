/**
 * tests/personal-bars-svg.test.js — src/render/personal-bars-svg.js
 * Run: node tests/personal-bars-svg.test.js
 *
 * Covers the engineer personal hours bar chart: empty guard, actual bars,
 * optional estimate bars + legend, y-axis labels with unit, x-label thinning
 * when dense, and custom colours/unit.
 */
import { buildPersonalBarsSVG } from '../src/render/personal-bars-svg.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

const periods = (n, withEst = false) =>
  Array.from({ length: n }, (_, i) => ({
    label: `W${i + 1}`, actual: 5 + i * 2, estimate: withEst ? 4 + i * 2 : undefined,
  }));

console.log('\nguards');
test('empty / null → empty string', () => {
  assert(buildPersonalBarsSVG([]) === '');
  assert(buildPersonalBarsSVG(null) === '');
});

console.log('\nbars');
test('renders an svg with one actual bar per period (no estimate)', () => {
  const html = buildPersonalBarsSVG(periods(4), { showEstimate: false });
  assert(html.includes('<svg'), 'svg missing');
  // primary colour bars, one per period
  assert((html.match(/var\(--primary,#6366f1\)/g) || []).length === 4, 'expected 4 actual bars');
});
test('estimate mode adds estimate bars + legend', () => {
  const html = buildPersonalBarsSVG(periods(3, true), { showEstimate: true });
  assert(html.includes('>Est<'), 'Est legend missing');
  assert(html.includes('>Actual<'), 'Actual legend missing');
  // estimate colour appears for bars + legend swatch
  assert(html.includes('rgba(100,116,139,0.55)'), 'estimate colour missing');
});
test('no legend when showEstimate is false', () => {
  const html = buildPersonalBarsSVG(periods(3), { showEstimate: false });
  assert(!html.includes('>Est<'), 'legend should be absent');
});

console.log('\naxes & labels');
test('y-axis shows 0 and max with unit suffix', () => {
  const html = buildPersonalBarsSVG(periods(3), { showEstimate: false });
  assert(html.includes('>0<'), 'zero label missing');
  assert(html.includes('h<'), 'unit suffix missing'); // default unit 'h'
});
test('custom unit reflected in y labels', () => {
  const html = buildPersonalBarsSVG([{ label: 'Q1', actual: 10 }], { unit: 'pt' });
  assert(html.includes('pt<'), 'custom unit missing');
});
test('x-labels: all shown when sparse', () => {
  const html = buildPersonalBarsSVG(periods(4), {});
  ['W1', 'W2', 'W3', 'W4'].forEach(l => assert(html.includes(`>${l}<`), `${l} missing`));
});
test('x-labels thin out when dense (>10 periods) but keep last', () => {
  const html = buildPersonalBarsSVG(periods(24), {});
  const shown = ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12',
                 'W13','W14','W15','W16','W17','W18','W19','W20','W21','W22','W23','W24']
    .filter(l => html.includes(`>${l}<`));
  assert(shown.length < 24, 'labels should be thinned');
  assert(html.includes('>W24<'), 'last label must always show');
  assert(html.includes('>W1<'), 'first label should show');
});

console.log('\ncustom colours');
test('custom primary + estimate colours applied', () => {
  const html = buildPersonalBarsSVG(periods(2, true), {
    showEstimate: true, primaryColor: '#123456', estimateColor: '#abcdef',
  });
  assert(html.includes('#123456'), 'custom primary missing');
  assert(html.includes('#abcdef'), 'custom estimate missing');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
