/**
 * tests/milestones.test.js — parseMilestoneLines, buildMilestoneData, milestoneCounts
 * Run: node tests/milestones.test.js
 */
import { parseMilestoneLines, buildMilestoneData, milestoneCounts } from '../src/milestones.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
function assertEqual(a, b) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`expected ${jb}, got ${ja}`);
}

console.log('\nparseMilestoneLines');
test('label only', () => {
  assertEqual(parseMilestoneLines('okr-q2'), [{ label: 'okr-q2', name: 'okr-q2', leapsomeUrl: null }]);
});
test('label + display name', () => {
  assertEqual(parseMilestoneLines('okr-q2|Q2 OKR'), [{ label: 'okr-q2', name: 'Q2 OKR', leapsomeUrl: null }]);
});
test('label + name + leapsome url', () => {
  assertEqual(parseMilestoneLines('okr-q2|Q2 OKR|https://app.leapsome.com/goals/1'),
    [{ label: 'okr-q2', name: 'Q2 OKR', leapsomeUrl: 'https://app.leapsome.com/goals/1' }]);
});
test('non-http third part is not treated as a url', () => {
  assert(parseMilestoneLines('okr|OKR|not-a-url')[0].leapsomeUrl === null);
});
test('multiple lines, blanks skipped, whitespace trimmed', () => {
  const out = parseMilestoneLines('  okr-q2 | Q2 OKR \n\n dev-plan \n   ');
  assertEqual(out.map(m => m.label), ['okr-q2', 'dev-plan']);
  assertEqual(out[0].name, 'Q2 OKR');
});
test('empty input → empty array', () => {
  assertEqual(parseMilestoneLines(''), []);
  assertEqual(parseMilestoneLines(null), []);
});

console.log('\nbuildMilestoneData');
const T = (key, labels, cat = 'new') => ({ key, labels, statusCategory: cat });
test('groups tickets by label, case-insensitive', () => {
  const out = buildMilestoneData(
    [{ label: 'OKR-Q2', name: 'Q2', leapsomeUrl: null }],
    [T('A-1', ['okr-q2']), T('A-2', ['other'])]
  );
  assertEqual(out[0].tickets.map(t => t.key), ['A-1']);
});
test('one ticket can belong to two milestones', () => {
  const out = buildMilestoneData(
    [{ label: 'okr', name: 'okr' }, { label: 'dev', name: 'dev' }],
    [T('A-1', ['okr', 'dev'])]
  );
  assert(out[0].tickets.length === 1 && out[1].tickets.length === 1);
});
test('milestone with no matching tickets has empty list', () => {
  const out = buildMilestoneData([{ label: 'ghost', name: 'ghost' }], [T('A-1', ['okr'])]);
  assertEqual(out[0].tickets, []);
});
test('carries name and leapsomeUrl through', () => {
  const out = buildMilestoneData([{ label: 'okr', name: 'Q2', leapsomeUrl: 'https://x.y' }], []);
  assert(out[0].name === 'Q2' && out[0].leapsomeUrl === 'https://x.y');
});

console.log('\nmilestoneCounts');
test('counts by status category with pct', () => {
  const { total, done, inProg, open, pct } = milestoneCounts([
    T('1', [], 'done'), T('2', [], 'done'), T('3', [], 'indeterminate'), T('4', [], 'new'),
  ]);
  assertEqual([total, done, inProg, open, pct], [4, 2, 1, 1, 50]);
});
test('empty list → zeros, pct 0', () => {
  assertEqual(milestoneCounts([]), { total: 0, done: 0, inProg: 0, open: 0, pct: 0 });
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
