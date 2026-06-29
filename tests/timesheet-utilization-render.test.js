#!/usr/bin/env node
/**
 * tests/timesheet-utilization-render.test.js
 * The Time Utilization overlay must be additive: with no busyHours the chart is
 * byte-identical to before; with busyHours it adds the hatch pattern, busy
 * sub-bars, a busy legend entry, and the busy total label.
 */
import { buildTimesheetSVG } from '../src/render/timesheet-svg.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
const test = (n, fn) => { try { fn(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fail++; console.log(`  ✗ ${n}\n    ${e.message}`); } };

const members = [
  { name: 'Ahmed', total: 22, byProject: { HRM: 14, POS: 8 } },
  { name: 'Hamza', total: 18, byProject: { HRM: 18 } },
];
const cap = { fixed: 36, pace: 18 };

test('overlay OFF (no busyHours) — no hatch, no busy bars, no defs', () => {
  const off = buildTimesheetSVG(members, cap);
  assert.ok(!off.includes('tsBusyHatch'), 'no hatch pattern');
  assert.ok(!off.includes('ts-busy'), 'no busy sub-bars');
  assert.ok(!off.includes('<defs>'), 'no defs block');
  assert.ok(!off.includes('>busy<'), 'no busy legend');
});

test('overlay ON (busyHours present) — hatch, busy bars, legend, busy label', () => {
  const withBusy = members.map((m, i) => ({ ...m, busyHours: [15.75, 15][i] }));
  const on = buildTimesheetSVG(withBusy, cap);
  assert.ok(on.includes('tsBusyHatch'), 'hatch pattern present');
  assert.ok(on.includes('ts-busy'), 'busy sub-bars present');
  assert.ok(on.includes('>busy<'), 'busy legend present');
  assert.ok(on.includes('>15.75h<'), 'busy total label present');
  // Logged totals + names are still there (overlay is additive).
  assert.ok(on.includes('>22h<') && on.includes('Ahmed'), 'logged data intact');
});

test('busyHours of 0 on a member draws no busy bar for that member', () => {
  const mixed = [{ ...members[0], busyHours: 0 }, { ...members[1], busyHours: 8 }];
  const on = buildTimesheetSVG(mixed, cap);
  // Exactly one busy sub-bar (Hamza), one busy label.
  assert.strictEqual((on.match(/class="ts-busy"/g) || []).length, 1);
});

test('legend shows the biggest projects by hours (incl. HRM) even with >4 projects', () => {
  const many = [{
    name: 'Ahmed', total: 40,
    byProject: { ALPHA: 1, BETA: 1, CARE: 1, DEV: 1, HRM: 36 }, // HRM dominant, alphabetically last
  }];
  const svg = buildTimesheetSVG(many, { fixed: 36 });
  assert.ok(svg.includes('>HRM<'), 'HRM (largest) appears in the legend');
});

console.log(`\ntimesheet-utilization-render: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
