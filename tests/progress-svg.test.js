/**
 * tests/progress-svg.test.js — src/render/progress-svg.js
 * Run: node tests/progress-svg.test.js
 *
 * Covers buildDonut (segment arc math, empty-total guard, custom size) and
 * buildMiniProgressBar (point-vs-count mode, pill conditions, SLA/blocker
 * flags, empty guard).
 */
import { buildDonut, buildMiniProgressBar } from '../src/render/progress-svg.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

// ── buildDonut ────────────────────────────────────────────────────────────────
console.log('\nbuildDonut');
test('all-zero segments → empty string', () => {
  assert(buildDonut({ segments:[{value:0,color:'#34d399'}], centerMain:'0', centerSub:'pts' }) === '');
});
test('renders svg with arc for each non-zero segment', () => {
  const html = buildDonut({ segments:[{value:3,color:'#34d399'},{value:2,color:'#60a5fa'}], centerMain:'3/5', centerSub:'pts' });
  assert(html.includes('<svg'), 'no svg');
  // 1 track circle + 1 arc per segment = 3 total <circle> elements
  assert((html.match(/<circle/g)||[]).length === 3, `expected 3 circles, got ${(html.match(/<circle/g)||[]).length}`);
});
test('centre text rendered correctly', () => {
  const html = buildDonut({ segments:[{value:1,color:'#34d399'}], centerMain:'1/1', centerSub:'sprint' });
  assert(html.includes('>1/1<'), 'center main missing');
  assert(html.includes('>sprint<'), 'center sub missing');
});
test('custom size reflected in viewBox + width', () => {
  const html = buildDonut({ segments:[{value:1,color:'red'}], centerMain:'1', centerSub:'x', size:60, strokeW:10 });
  assert(html.includes('viewBox="0 0 60 60"'), 'size not in viewBox');
  assert(html.includes('width="60"'), 'width wrong');
});
test('single segment fills the whole ring (dasharray ≈ circ)', () => {
  const size=80, sw=14, r=(size-sw)/2, circ=2*Math.PI*r;
  const html = buildDonut({ segments:[{value:5,color:'#34d399'}], centerMain:'5', centerSub:'done' });
  // dash should equal circ (gap = 0 at 100%)
  assert(html.includes(circ.toFixed(2)), 'full-ring dasharray wrong');
});

// ── buildMiniProgressBar ──────────────────────────────────────────────────────
const mk = (cat, n, pts=0) => Array.from({length:n}, (_,i) => ({ statusCategory:cat, points:pts, assignee: i%2===0?'Ali':null }));
console.log('\nbuildMiniProgressBar');
test('empty → "No tickets" span', () => {
  assert(buildMiniProgressBar([]).includes('No tickets'));
  assert(buildMiniProgressBar(null).includes('No tickets'));
});
test('point mode: uses points when > 0', () => {
  const stories = [...mk('done',2,5), ...mk('new',1,3)];
  const html = buildMiniProgressBar(stories);
  // done = 10pts of 13pts total → 77%
  assert(html.includes('77%'), `expected 77%, got ${html.match(/\d+%/)?.[0]}`);
});
test('count mode: uses ticket count when all points = 0', () => {
  const stories = [...mk('done',3,0), ...mk('new',1,0)];
  const html = buildMiniProgressBar(stories);
  // done = 3 of 4 → 75%
  assert(html.includes('75%'), `expected 75%, got ${html.match(/\d+%/)?.[0]}`);
});
test('in-flight pill shown when indeterminate tickets exist', () => {
  const stories = [...mk('done',1,0), ...mk('indeterminate',2,0)];
  assert(buildMiniProgressBar(stories).includes('in flight'));
});
test('in-flight pill absent when no indeterminate', () => {
  assert(!buildMiniProgressBar([...mk('done',1,0), ...mk('new',1,0)]).includes('in flight'));
});
test('showUnassigned pill only shown when opted in and unassigned exist', () => {
  const stories = mk('new', 2, 0); // i=0 has assignee, i=1 has null → 1 unassigned
  assert(!buildMiniProgressBar(stories, {}).includes('unassigned'), 'should be hidden by default');
  assert(buildMiniProgressBar(stories, {showUnassigned:true}).includes('unassigned'), 'should show when opted in');
});
test('riskText, blockedCount, breachedCount pills', () => {
  const stories = mk('done', 1, 0);
  const html = buildMiniProgressBar(stories, { riskText:'behind pace', blockedCount:2, breachedCount:1 });
  assert(html.includes('behind pace'), 'riskText missing');
  assert(html.includes('2 blocked-external'), 'blockedCount missing');
  assert(html.includes('1 SLA'), 'breachedCount missing');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
