/**
 * tests/render-scheduler.test.js — src/render-scheduler.js
 * Run: node tests/render-scheduler.test.js
 *
 * Covers the pure timing-decision logic behind the S-4 render scheduler:
 * immediate vs coalesced, pending-timer handling, reason normalisation.
 */
import { planRender, renderReason, RENDER_DEBOUNCE_MS } from '../src/render-scheduler.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
const eq = (a, b) => assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

console.log('\nplanRender — immediate mode');
test('immediate with no pending → render-now, no clear', () => {
  eq(planRender({ immediate: true, hasPending: false }), { action: 'render-now', clearPending: false });
});
test('immediate with pending → render-now, clears the queued render', () => {
  eq(planRender({ immediate: true, hasPending: true }), { action: 'render-now', clearPending: true });
});

console.log('\nplanRender — coalesced mode');
test('first coalesced request → queue, nothing to clear', () => {
  eq(planRender({ immediate: false, hasPending: false }), { action: 'queue', clearPending: false });
});
test('coalesced request while one is pending → queue + clear (restart debounce)', () => {
  eq(planRender({ immediate: false, hasPending: true }), { action: 'queue', clearPending: true });
});
test('a burst of N coalesced requests only ever results in queue actions', () => {
  // simulate: first has no pending, rest have pending
  let pending = false;
  const actions = [];
  for (let i = 0; i < 5; i++) {
    const p = planRender({ immediate: false, hasPending: pending });
    actions.push(p.action);
    pending = true; // after the first queue, a timer exists
  }
  assert(actions.every(a => a === 'queue'), 'all queue');
  // Only one timer ends up live → one render. (clearPending restarts, never spawns a 2nd.)
});

console.log('\nplanRender — defaults');
test('no args → coalesced queue', () => {
  eq(planRender(), { action: 'queue', clearPending: false });
});

console.log('\nrenderReason');
test('passes through a normal tag', () => assert(renderReason('partial-update:jira') === 'partial-update:jira'));
test('empty / non-string → unspecified', () => {
  assert(renderReason('') === 'unspecified');
  assert(renderReason(null) === 'unspecified');
  assert(renderReason(42) === 'unspecified');
});
test('trims and caps length at 60', () => {
  assert(renderReason('   spaced   ') === 'spaced');
  assert(renderReason('x'.repeat(100)).length === 60);
});

console.log('\nconstants');
test('debounce window is a positive number', () => {
  assert(typeof RENDER_DEBOUNCE_MS === 'number' && RENDER_DEBOUNCE_MS > 0);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
