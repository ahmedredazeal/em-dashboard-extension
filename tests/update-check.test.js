/**
 * tests/update-check.test.js — src/update-check.js (T-DIST-1)
 * Run: node tests/update-check.test.js
 */
import {
  parseVersion, compareVersions, isPromoted, selectUpdate, shouldCheck, isSnoozed,
} from '../src/update-check.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

console.log('\nparseVersion / compareVersions');
test('parses with and without leading v + suffix', () => {
  assert(JSON.stringify(parseVersion('v2.12.0')) === '[2,12,0]');
  assert(JSON.stringify(parseVersion('2.12.0-promoted')) === '[2,12,0]');
  assert(JSON.stringify(parseVersion('garbage')) === '[]');
});
test('compares correctly across all positions', () => {
  assert(compareVersions('2.12.0', '2.11.4') > 0, 'minor');
  assert(compareVersions('2.11.4', '2.12.0') < 0, 'minor rev');
  assert(compareVersions('3.0.0', '2.99.99') > 0, 'major');
  assert(compareVersions('2.12.1', '2.12.0') > 0, 'patch');
  assert(compareVersions('2.12.0', '2.12.0') === 0, 'equal');
});

console.log('\nisPromoted');
test('detects promoted token in tag or name (case-insensitive)', () => {
  assert(isPromoted({ tag_name: 'v2.13.0-promoted' }), 'tag');
  assert(isPromoted({ name: 'v2.13.0 (Promoted)' }), 'name');
  assert(!isPromoted({ tag_name: 'v2.13.0', name: 'v2.13.0' }), 'not promoted');
  assert(!isPromoted(null), 'null safe');
});

console.log('\nselectUpdate');
const releases = [
  { tag_name: 'v2.13.0-promoted', name: 'Promoted release', html_url: 'u13', body: 'notes', draft: false },
  { tag_name: 'v2.14.0', name: 'v2.14.0', html_url: 'u14', draft: false },         // newer but NOT promoted
  { tag_name: 'v2.12.5-promoted', name: 'older promoted', html_url: 'u125', draft: false },
];
test('picks newest PROMOTED release newer than current', () => {
  const u = selectUpdate(releases, '2.12.0');
  assert(u && u.version === '2.13.0', `got ${u && u.version}`);
  assert(u.htmlUrl === 'u13', 'url');
});
test('ignores newer non-promoted releases', () => {
  // 2.14.0 exists but isn't promoted → must not be selected
  const u = selectUpdate(releases, '2.13.0');
  assert(u === null, `should be null, got ${u && u.version}`);
});
test('returns null when current is newest promoted', () => {
  assert(selectUpdate(releases, '2.13.0') === null);
});
test('returns null when up to date / no promoted', () => {
  assert(selectUpdate([{ tag_name: 'v2.14.0', draft: false }], '2.12.0') === null);
  assert(selectUpdate([], '2.12.0') === null);
  assert(selectUpdate(null, '2.12.0') === null);
});
test('skips drafts', () => {
  const u = selectUpdate([{ tag_name: 'v3.0.0-promoted', draft: true, html_url: 'd' }], '2.12.0');
  assert(u === null, 'draft must be skipped');
});

console.log('\nshouldCheck');
test('checks when never checked', () => assert(shouldCheck(null) === true));
test('skips within interval, checks after', () => {
  const now = 1_000_000_000_000;
  assert(shouldCheck(now - 1000, now) === false, 'too soon');
  assert(shouldCheck(now - 25 * 3600 * 1000, now) === true, 'after 25h');
});

console.log('\nisSnoozed');
test('snoozed only for the matching version + within window', () => {
  const now = 1_000_000_000_000;
  assert(isSnoozed('2.13.0', now + 1000, '2.13.0', now) === true, 'matching + future');
  assert(isSnoozed('2.13.0', now - 1000, '2.13.0', now) === false, 'expired');
  assert(isSnoozed('2.13.0', now + 1000, '2.14.0', now) === false, 'different version');
  assert(isSnoozed(null, null, '2.13.0', now) === false, 'nothing snoozed');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
