/**
 * tests/usage-telemetry.test.js — src/usage-telemetry.js
 * Run: node tests/usage-telemetry.test.js
 *
 * Covers the PURE envelope builders (event shape, tags, identity, measurements,
 * transaction timing, DSN parsing, id formats). The network send() is the only
 * un-unit-tested part by design.
 */
import {
  parseDsn, makeEventId, makeSpanId,
  buildUsageEnvelope, buildErrorEnvelope, buildTransactionEnvelope, envelopeFromItem,
} from '../src/usage-telemetry.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }

/** Parse the 3-line envelope into {header, itemHeader, body}. */
function parseEnvelope(env) {
  const [h, ih, body] = env.split('\n');
  return { header: JSON.parse(h), itemHeader: JSON.parse(ih), body: JSON.parse(body) };
}

console.log('\nparseDsn');
test('parses a US DSN into ingest pieces', () => {
  const p = parseDsn('https://abc123@o164516.ingest.us.sentry.io/4511565732773888');
  assert(p.publicKey === 'abc123', 'publicKey');
  assert(p.host === 'o164516.ingest.us.sentry.io', 'host');
  assert(p.projectId === '4511565732773888', 'projectId');
  assert(p.envelopeUrl === 'https://o164516.ingest.us.sentry.io/api/4511565732773888/envelope/', 'envelopeUrl');
});
test('returns null for malformed DSN', () => {
  assert(parseDsn('not-a-dsn') === null);
  assert(parseDsn('') === null);
  assert(parseDsn(null) === null);
});

console.log('\nid formats');
test('event id is 32 hex chars', () => assert(/^[0-9a-f]{32}$/.test(makeEventId())));
test('span id is 16 hex chars', () => assert(/^[0-9a-f]{16}$/.test(makeSpanId())));
test('ids are unique across calls', () => assert(makeEventId() !== makeEventId()));

console.log('\nbuildUsageEnvelope');
test('produces a 3-part envelope with event item', () => {
  const { header, itemHeader, body } = parseEnvelope(buildUsageEnvelope('app_opened', {}));
  assert(header.event_id && header.sent_at, 'envelope header fields');
  assert(itemHeader.type === 'event', 'item type');
  assert(body.message === 'app_opened', 'message');
  assert(body.event_id === header.event_id, 'event_id matches header');
});
test('tags usage events with event_type=usage and usage_event=name', () => {
  const { body } = parseEnvelope(buildUsageEnvelope('section_viewed', { tags: { section: 'gantt' } }));
  assert(body.tags.event_type === 'usage', 'event_type tag');
  assert(body.tags.usage_event === 'section_viewed', 'usage_event tag');
  assert(body.tags.section === 'gantt', 'custom tag preserved');
  assert(body.level === 'info', 'usage level info');
});
test('attaches user identity when present', () => {
  const { body } = parseEnvelope(buildUsageEnvelope('app_opened', {
    user: { email: 'a.reda@getzeal.io', id: 'acc1', username: 'Ahmed' },
  }));
  assert(body.user.email === 'a.reda@getzeal.io', 'email');
  assert(body.user.id === 'acc1', 'id');
});
test('omits user when empty', () => {
  const { body } = parseEnvelope(buildUsageEnvelope('app_opened', { user: {} }));
  assert(body.user === undefined, 'no empty user object');
});
test('carries release + measurements', () => {
  const { body } = parseEnvelope(buildUsageEnvelope('app_opened', {
    release: '2.10.0', measurements: { load_ms: { value: 820, unit: 'millisecond' } },
  }));
  assert(body.release === '2.10.0', 'release');
  assert(body.measurements.load_ms.value === 820, 'measurement');
});

console.log('\nbuildErrorEnvelope');
test('tags errors with event_type=error and level error', () => {
  const { body } = parseEnvelope(buildErrorEnvelope('Jira fetch failed', { extra: { status: 500 } }));
  assert(body.tags.event_type === 'error', 'event_type=error');
  assert(body.level === 'error', 'level error');
  assert(body.message === 'Jira fetch failed', 'message');
  assert(body.extra.status === 500, 'extra preserved');
});
test('honours custom level (warning)', () => {
  const { body } = parseEnvelope(buildErrorEnvelope('soft fail', { level: 'warning' }));
  assert(body.level === 'warning');
});

console.log('\nbuildTransactionEnvelope');
test('produces a transaction item with trace context + duration', () => {
  const start = 1_700_000_000_000, end = start + 1500;
  const { itemHeader, body } = parseEnvelope(buildTransactionEnvelope('jira.fetch', {
    startMs: start, endMs: end,
    spans: [{ op: 'http.client', description: 'fetchJiraData', startMs: start, endMs: end }],
  }));
  assert(itemHeader.type === 'transaction', 'item type transaction');
  assert(body.type === 'transaction', 'body type');
  assert(body.transaction === 'jira.fetch', 'name');
  assert(body.start_timestamp === start / 1000, 'start in float seconds');
  assert(body.timestamp === end / 1000, 'end in float seconds');
  assert(body.contexts.trace.trace_id && body.contexts.trace.span_id, 'trace context');
  assert(body.spans.length === 1, 'one span');
  assert(body.spans[0].parent_span_id === body.contexts.trace.span_id, 'span parented to txn');
  assert(body.spans[0].trace_id === body.contexts.trace.trace_id, 'span shares trace id');
});
test('transaction tagged event_type=usage', () => {
  const { body } = parseEnvelope(buildTransactionEnvelope('app.session', { startMs: 0, endMs: 100 }));
  assert(body.tags.event_type === 'usage', 'event_type');
  assert(body.tags.usage_event === 'app.session', 'usage_event');
});

console.log('\nenvelopeFromItem');
test('joins header/itemHeader/payload with newlines', () => {
  const env = envelopeFromItem({ event_id: 'x'.repeat(32) }, 'event');
  assert(env.split('\n').length === 3, 'three lines');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
