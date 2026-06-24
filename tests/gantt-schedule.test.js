// Tests for phase-sequenced subtask Gantt: phase/function detection + layout.
// Zealer naming convention: bracketed [BE] OR bare "BE", phases BE/BE Review/QA.
import { detectPhase, getFunctionPrefix, scheduleChildren, getWorkingDays } from '../src/gantt.js';
import assert from 'node:assert';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// ── getFunctionPrefix: bracketed AND bare prefixes ──────────────────────────
test('getFunctionPrefix: bracketed prefix, uppercased', () => {
  assert.strictEqual(getFunctionPrefix('[BE] fixes'), 'BE');
  assert.strictEqual(getFunctionPrefix('[fe] tweak'), 'FE');
  assert.strictEqual(getFunctionPrefix('  [POS] terminal flow'), 'POS');
});
test('getFunctionPrefix: BARE leading prefix (the team convention)', () => {
  assert.strictEqual(getFunctionPrefix('BE implementation'), 'BE');
  assert.strictEqual(getFunctionPrefix('BE Review'), 'BE');
  assert.strictEqual(getFunctionPrefix('FE login form'), 'FE');
  assert.strictEqual(getFunctionPrefix('POS Review'), 'POS');
});
test('getFunctionPrefix: no recognised prefix → empty', () => {
  assert.strictEqual(getFunctionPrefix('Refactor service'), '');
  assert.strictEqual(getFunctionPrefix('QA regression'), ''); // QA is a phase, not a function lane
});

// ── detectPhase: bracketed AND bare ─────────────────────────────────────────
test('detectPhase: [QA] / bare QA / "qa" word → qa', () => {
  assert.strictEqual(detectPhase('[QA] regression'), 'qa');
  assert.strictEqual(detectPhase('QA'), 'qa');
  assert.strictEqual(detectPhase('Manual qa on staging'), 'qa');
});
test('detectPhase: review keywords → review', () => {
  assert.strictEqual(detectPhase('BE Review'), 'review');
  assert.strictEqual(detectPhase('[FE] Review'), 'review');
  assert.strictEqual(detectPhase('POS cr'), 'review');
});
test('detectPhase: default → impl', () => {
  assert.strictEqual(detectPhase('BE implementation'), 'impl');
  assert.strictEqual(detectPhase('FE'), 'impl');
  assert.strictEqual(detectPhase('Build the thing'), 'impl');
});

// ── scheduleChildren ────────────────────────────────────────────────────────
const SPRINT = { startDate: '2026-06-14', endDate: '2026-06-27' };
const wdays = getWorkingDays(SPRINT.startDate, SPRINT.endDate, [0,1,2,3,4]);
const nDays = wdays.length;
const mk = (key, summary, estimateHours) => ({ key, summary, estimateHours, startDate: SPRINT.startDate, rank: key });

test('impl precedes its review on the same function lane (sequential)', () => {
  const { bars } = scheduleChildren([
    mk('S2', 'BE Review', 3),
    mk('S1', 'BE implementation', 6),
  ], SPRINT, wdays, nDays);
  const impl = bars.find(b => b.child.key === 'S1');
  const review = bars.find(b => b.child.key === 'S2');
  assert.strictEqual(impl.lane, review.lane, 'same function shares a lane');
  assert.ok(review.leftPct > impl.leftPct, 'review queued after impl');
});

test('different functions get parallel lanes (same start)', () => {
  const { bars, nLanes } = scheduleChildren([
    mk('B', 'BE service', 6),
    mk('F', 'FE screen', 6),
  ], SPRINT, wdays, nDays);
  const be = bars.find(b => b.child.key === 'B');
  const fe = bars.find(b => b.child.key === 'F');
  assert.notStrictEqual(be.lane, fe.lane, 'BE and FE on different lanes');
  assert.strictEqual(be.leftPct, fe.leftPct, 'both start at the row start');
  assert.ok(nLanes >= 2);
});

test('QA sits on its own lane after all function work', () => {
  const { bars } = scheduleChildren([
    mk('B', 'BE service', 6),
    mk('Q', 'QA pass', 4),
  ], SPRINT, wdays, nDays);
  const be = bars.find(b => b.child.key === 'B');
  const qa = bars.find(b => b.child.key === 'Q');
  assert.notStrictEqual(qa.lane, be.lane, 'QA on its own lane');
  assert.ok(qa.leftPct >= be.leftPct + be.widthPct - 0.001, 'QA starts at/after BE end');
});

test('bar width scales with estimate (more hours = wider)', () => {
  const { bars } = scheduleChildren([
    mk('S', 'BE big', 12),
    mk('T', 'FE small', 3),
  ], SPRINT, wdays, nDays);
  const big = bars.find(b => b.child.key === 'S');
  const small = bars.find(b => b.child.key === 'T');
  assert.ok(big.widthPct > small.widthPct, 'larger estimate → wider bar');
});

test('unestimated subtask falls back to a per-phase default width', () => {
  const { bars } = scheduleChildren([mk('S', 'BE thing', null)], SPRINT, wdays, nDays);
  assert.ok(bars[0].widthPct > 0, 'still draws a bar without an estimate');
});

test('empty children → one lane, no bars', () => {
  const { bars, nLanes } = scheduleChildren([], SPRINT, wdays, nDays);
  assert.strictEqual(bars.length, 0);
  assert.strictEqual(nLanes, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
