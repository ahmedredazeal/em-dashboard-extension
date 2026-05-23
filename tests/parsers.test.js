#!/usr/bin/env node
/**
 * tests/parsers.test.js
 * Runs with: node tests/parsers.test.js
 * No external deps. Exit code 0 = all pass, 1 = any fail.
 */

import {
  parseExtraBoardSpec,
  parseExtraBoardsTextarea,
  parseSentryViewSpec,
  parseSentryUrl,
  getStoryPoints,
  normalizeStory,
  isStoryDone
} from '../src/parsers.js';

let pass = 0, fail = 0;

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err.message}`);
    fail++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (!deepEqual(actual, expected)) {
    throw new Error(`${msg || 'not equal'}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

// ────────────────────────────────────────────────────────────
console.log('\nparseExtraBoardSpec — object input');
test('object with name + id', () => {
  assertEqual(parseExtraBoardSpec({ name: 'Support', id: 123 }), { label: 'Support', id: 123 });
});
test('object with id only → synthesizes label', () => {
  assertEqual(parseExtraBoardSpec({ id: 99 }), { label: 'Board 99', id: 99 });
});
test('object with NaN id → null', () => {
  assertEqual(parseExtraBoardSpec({ name: 'X', id: 'abc' }), null);
});

console.log('\nparseExtraBoardSpec — string input');
test('"Support|123" → name + id', () => {
  assertEqual(parseExtraBoardSpec('Support|123'), { label: 'Support', id: 123 });
});
test('"Support Board|123" → preserves spaces', () => {
  assertEqual(parseExtraBoardSpec('Support Board|123'), { label: 'Support Board', id: 123 });
});
test('"  Support  |  123  " → trims', () => {
  assertEqual(parseExtraBoardSpec('  Support  |  123  '), { label: 'Support', id: 123 });
});
test('"123" → bare id, synthesized label', () => {
  assertEqual(parseExtraBoardSpec('123'), { label: 'Board 123', id: 123 });
});
test('"abc" → null (not a number)', () => {
  assertEqual(parseExtraBoardSpec('abc'), null);
});
test('"" → null', () => {
  assertEqual(parseExtraBoardSpec(''), null);
});
test('null → null', () => {
  assertEqual(parseExtraBoardSpec(null), null);
});
test('undefined → null', () => {
  assertEqual(parseExtraBoardSpec(undefined), null);
});

console.log('\nparseExtraBoardsTextarea — multi-line');
test('two lines parsed correctly', () => {
  const raw = 'Support Board|123\nPOS Board|456';
  assertEqual(parseExtraBoardsTextarea(raw), [
    { name: 'Support Board', id: 123 },
    { name: 'POS Board', id: 456 }
  ]);
});
test('skips blank lines', () => {
  const raw = 'A|1\n\n\nB|2\n';
  assertEqual(parseExtraBoardsTextarea(raw), [
    { name: 'A', id: 1 },
    { name: 'B', id: 2 }
  ]);
});
test('skips invalid lines, keeps valid', () => {
  const raw = 'A|1\nbroken\nB|2';
  assertEqual(parseExtraBoardsTextarea(raw), [
    { name: 'A', id: 1 },
    { name: 'B', id: 2 }
  ]);
});
test('empty input → empty array', () => {
  assertEqual(parseExtraBoardsTextarea(''), []);
  assertEqual(parseExtraBoardsTextarea(null), []);
  assertEqual(parseExtraBoardsTextarea(undefined), []);
});
test('round-trip: textarea → parse → spec → parse', () => {
  const parsed = parseExtraBoardsTextarea('Support|123\nPOS|456');
  // background.js reads from storage as objects and parses again
  const reparsed = parsed.map(parseExtraBoardSpec);
  assertEqual(reparsed, [
    { label: 'Support', id: 123 },
    { label: 'POS', id: 456 }
  ]);
});

console.log('\nparseSentryViewSpec');
test('"Label|viewId|p1,p2,p3"', () => {
  assertEqual(parseSentryViewSpec('HRM|201661|5031746,5846291'), {
    label: 'HRM', viewId: '201661', projectIds: ['5031746', '5846291']
  });
});
test('"Label|viewId" — no projects', () => {
  assertEqual(parseSentryViewSpec('HRM|201661'), {
    label: 'HRM', viewId: '201661', projectIds: []
  });
});
test('"viewId" alone → label synthesized', () => {
  assertEqual(parseSentryViewSpec('201661'), {
    label: 'View 201661', viewId: '201661', projectIds: []
  });
});
test('object form preserved', () => {
  assertEqual(
    parseSentryViewSpec({ label: 'X', viewId: '1', projectIds: ['a','b'] }),
    { label: 'X', viewId: '1', projectIds: ['a','b'] }
  );
});

console.log('\ngetStoryPoints');
test('returns first matching field', () => {
  const issue = { fields: { customfield_10016: 5, customfield_10026: 99 } };
  assertEqual(getStoryPoints(issue, ['customfield_10016', 'customfield_10026']), 5);
});
test('falls back to second field if first missing', () => {
  const issue = { fields: { customfield_10026: 8 } };
  assertEqual(getStoryPoints(issue, ['customfield_10016', 'customfield_10026']), 8);
});
test('returns 0 if no field matches', () => {
  const issue = { fields: { other: 5 } };
  assertEqual(getStoryPoints(issue, ['customfield_10016']), 0);
});
test('returns 0 for null issue', () => {
  assertEqual(getStoryPoints(null, ['x']), 0);
});
test('ignores non-numeric values', () => {
  const issue = { fields: { x: 'abc' } };
  assertEqual(getStoryPoints(issue, ['x']), 0);
});
test('accepts 0 as a valid value', () => {
  const issue = { fields: { x: 0 } };
  assertEqual(getStoryPoints(issue, ['x']), 0);
});

console.log('\nnormalizeStory');
test('full Jira issue shape', () => {
  const issue = {
    key: 'HRM-100',
    fields: {
      summary: 'Build the thing',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'Ali' },
      priority: { name: 'High' },
      customfield_10016: 5,
      issuetype: { name: 'Story' },
      duedate: '2026-06-01'
    }
  };
  assertEqual(normalizeStory(issue, 'customfield_10016'), {
    key: 'HRM-100',
    summary: 'Build the thing',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    assignee: 'Ali',
    priority: 'High',
    points: 5,
    type: 'Story',
    dueDate: '2026-06-01',
    labels: []
  });
});
test('missing assignee → null', () => {
  const issue = { key: 'X-1', fields: { summary: 'a' } };
  const norm = normalizeStory(issue, 'customfield_10016');
  assert(norm.assignee === null);
});

console.log('\nisStoryDone');
test('statusCategory.key = done', () => {
  assert(isStoryDone({ fields: { status: { statusCategory: { key: 'done' } } } }));
});
test('status.name = "Done"', () => {
  assert(isStoryDone({ fields: { status: { name: 'Done' } } }));
});
test('status.name = "closed"', () => {
  assert(isStoryDone({ fields: { status: { name: 'closed' } } }));
});
test('status.name = "In Progress" → false', () => {
  assert(!isStoryDone({ fields: { status: { name: 'In Progress' } } }));
});

console.log('\nparseSentryUrl');

const FULL_URL = 'https://zeal.sentry.io/issues/views/205220/?environment=production&project=6042935&project=6163086&project=4508649352265728&query=is%3Aunresolved&sort=date&statsPeriod=7d';

test('full URL → all fields extracted', () => {
  const r = parseSentryUrl(FULL_URL);
  assert(r !== null, 'should not be null');
  assert(r.baseUrl === 'https://zeal.sentry.io', `baseUrl: ${r.baseUrl}`);
  assert(r.orgSlug === 'zeal', `orgSlug: ${r.orgSlug}`);
  assert(r.viewId === '205220', `viewId: ${r.viewId}`);
  assert(deepEqual(r.projectIds, ['6042935', '6163086', '4508649352265728']), `projectIds: ${JSON.stringify(r.projectIds)}`);
  assert(r.environment === 'production', `environment: ${r.environment}`);
  assert(r.query === 'is:unresolved', `query: ${r.query}`);
  assert(r.sort === 'date', `sort: ${r.sort}`);
  assert(r.statsPeriod === '7d', `statsPeriod: ${r.statsPeriod}`);
});

test('URL without projects → empty projectIds array', () => {
  const r = parseSentryUrl('https://zeal.sentry.io/issues/views/201661/?query=is%3Aunresolved');
  assert(r !== null);
  assert(deepEqual(r.projectIds, []));
  assert(r.viewId === '201661');
});

test('URL without optional params → null fields', () => {
  const r = parseSentryUrl('https://zeal.sentry.io/issues/views/123/');
  assert(r !== null);
  assert(r.viewId === '123');
  assert(r.environment === null);
  assert(r.query === null);
  assert(r.sort === null);
  assert(r.statsPeriod === null);
});

test('URL without trailing slash on viewId', () => {
  const r = parseSentryUrl('https://zeal.sentry.io/issues/views/999?project=42');
  assert(r !== null);
  assert(r.viewId === '999');
  assert(deepEqual(r.projectIds, ['42']));
});

test('URL with hash fragment → still parses', () => {
  const r = parseSentryUrl('https://zeal.sentry.io/issues/views/777/?query=is%3Aunresolved#section');
  assert(r !== null);
  assert(r.viewId === '777');
});

test('sentry.io without subdomain → orgSlug null', () => {
  const r = parseSentryUrl('https://sentry.io/issues/views/100/');
  assert(r !== null);
  assert(r.orgSlug === null);
  assert(r.baseUrl === 'https://sentry.io');
});

test('extra path after viewId → still parses viewId', () => {
  const r = parseSentryUrl('https://zeal.sentry.io/issues/views/555/something/');
  assert(r !== null);
  assert(r.viewId === '555');
});

test('non-Sentry URL → null', () => {
  assert(parseSentryUrl('https://example.com/issues/views/1/') === null);
});

test('Sentry issue detail page (not a view) → null', () => {
  assert(parseSentryUrl('https://zeal.sentry.io/issues/12345/') === null);
});

test('Sentry dashboard page → null', () => {
  assert(parseSentryUrl('https://zeal.sentry.io/dashboard/') === null);
});

test('viewId not numeric → null', () => {
  assert(parseSentryUrl('https://zeal.sentry.io/issues/views/abc/') === null);
});

test('empty string → null', () => {
  assert(parseSentryUrl('') === null);
});

test('null input → null', () => {
  assert(parseSentryUrl(null) === null);
});

test('undefined input → null', () => {
  assert(parseSentryUrl(undefined) === null);
});

test('non-string input → null', () => {
  assert(parseSentryUrl(12345) === null);
});

test('malformed URL → null', () => {
  assert(parseSentryUrl('not a url') === null);
});

test('URL with whitespace → trimmed and parsed', () => {
  const r = parseSentryUrl('   https://zeal.sentry.io/issues/views/42/   ');
  assert(r !== null);
  assert(r.viewId === '42');
});

// ────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
