/**
 * tests/trend-colors.test.js
 * Tests for the shared multi-view color palette.
 */
import { TREND_COLORS, colorForIndex } from '../src/trend-colors.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('trend-colors');

test('palette has at least 6 distinct colors', () => {
  assert(TREND_COLORS.length >= 6, `only ${TREND_COLORS.length}`);
  assert(new Set(TREND_COLORS).size === TREND_COLORS.length, 'colors not distinct');
});

test('index 0 → first color', () => {
  assert(colorForIndex(0) === TREND_COLORS[0], colorForIndex(0));
});

test('index maps to matching slot', () => {
  assert(colorForIndex(2) === TREND_COLORS[2], colorForIndex(2));
});

test('cycles past palette length', () => {
  assert(colorForIndex(TREND_COLORS.length) === TREND_COLORS[0], 'should wrap to 0');
  assert(colorForIndex(TREND_COLORS.length + 1) === TREND_COLORS[1], 'should wrap to 1');
});

test('null / negative index falls back to first color', () => {
  assert(colorForIndex(null) === TREND_COLORS[0], 'null');
  assert(colorForIndex(-1) === TREND_COLORS[0], 'negative');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
