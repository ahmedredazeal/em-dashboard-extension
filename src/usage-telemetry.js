/**
 * src/usage-telemetry.js — Zealer Dashboard
 *
 * Sends usage + error + performance telemetry to Sentry via its HTTP envelope
 * endpoint — NO Sentry SDK (the MV3 service-worker + strict `script-src 'self'`
 * CSP make the browser SDK awkward/unsafe to bundle). We construct the envelope
 * ourselves and POST it from background.js, the same way we already POST to Jira.
 *
 * Replaces the old Google-Form/Sheet usage ping. Sentry gives proper querying,
 * grouping, retention and dashboards; identity (email) is attached the
 * sanctioned way via the event `user` field.
 *
 * This project (`zealer-dashboard`) holds BOTH usage and errors, so every event
 * carries an `event_type` tag (`usage` | `error`) to filter them apart in
 * Sentry (e.g. `event_type:usage`).
 *
 * The builders are PURE (data in → envelope string out, no network, no DOM) so
 * they unit-test cleanly. Only `send()` touches the network.
 */

/** Parse a Sentry DSN into the ingestion pieces we need. */
export function parseDsn(dsn) {
  // https://<publicKey>@<host>/<projectId>
  const m = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(dsn || '');
  if (!m) return null;
  const [, publicKey, host, projectId] = m;
  return {
    publicKey, host, projectId,
    storeUrl:    `https://${host}/api/${projectId}/store/`,
    envelopeUrl: `https://${host}/api/${projectId}/envelope/`,
  };
}

/** RFC4122-ish hex id (32 chars, no dashes — Sentry event_id format). */
export function makeEventId() {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** Lower-half (16-char) trace/span id. */
export function makeSpanId() {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** ISO timestamp for the event body. */
function nowIso() { return new Date().toISOString(); }

/**
 * Common event scaffold shared by usage + error events.
 * @param {Object} opts
 * @param {string} opts.eventType   'usage' | 'error'
 * @param {Object} [opts.user]      { email, id, username }
 * @param {Object} [opts.tags]      string→string tags
 * @param {Object} [opts.extra]     arbitrary context
 * @param {Object} [opts.measurements] { name: { value, unit } }
 * @param {string} [opts.release]   app version
 * @param {string} [opts.environment]
 */
function baseEvent({ eventType, user, tags = {}, extra = {}, measurements, release, environment = 'production' }) {
  const ev = {
    event_id: makeEventId(),
    timestamp: nowIso(),
    platform: 'javascript',
    logger: 'zealer-dashboard',
    environment,
    tags: { event_type: eventType, ...tags },
    extra,
  };
  if (release) ev.release = release;
  if (user && (user.email || user.id || user.username)) ev.user = user;
  if (measurements && Object.keys(measurements).length) ev.measurements = measurements;
  return ev;
}

/**
 * Build a Sentry ENVELOPE string for a usage event (app_opened, section_viewed…).
 * @param {string} name   event name → message + transaction tag
 * @param {Object} opts   see baseEvent (+ {dsn} not needed here)
 * @returns {string} newline-delimited envelope ready to POST
 */
export function buildUsageEnvelope(name, opts = {}) {
  const ev = baseEvent({ ...opts, eventType: 'usage' });
  ev.message = name;
  ev.tags.usage_event = name;
  ev.level = 'info';
  return envelopeFromItem(ev, 'event');
}

/**
 * Build a Sentry ENVELOPE string for an error/failure event.
 * @param {string} message  human-readable failure summary
 * @param {Object} opts      see baseEvent; optionally {level:'error'|'warning'}
 */
export function buildErrorEnvelope(message, opts = {}) {
  const ev = baseEvent({ ...opts, eventType: 'error' });
  ev.message = message;
  ev.level = opts.level || 'error';
  return envelopeFromItem(ev, 'event');
}

/**
 * Build a Sentry TRANSACTION envelope for performance timing.
 * Durations are derived from start/end epoch-millis; Sentry expects float
 * SECONDS for transaction start/end timestamps.
 * @param {string} name        transaction name (e.g. 'app.session', 'jira.fetch')
 * @param {Object} opts
 * @param {number} opts.startMs epoch ms at start
 * @param {number} opts.endMs   epoch ms at end
 * @param {Array}  [opts.spans] [{op, description, startMs, endMs}]
 * @param {Object} [opts.user] [opts.tags] [opts.extra] [opts.release]
 */
export function buildTransactionEnvelope(name, opts = {}) {
  const { startMs, endMs, spans = [], user, tags = {}, extra = {}, release, environment = 'production' } = opts;
  const traceId = makeEventId();
  const txnSpanId = makeSpanId();
  const startTs = startMs / 1000;
  const endTs   = endMs / 1000;

  const txn = {
    event_id: makeEventId(),
    type: 'transaction',
    transaction: name,
    platform: 'javascript',
    environment,
    start_timestamp: startTs,
    timestamp: endTs,
    tags: { event_type: 'usage', usage_event: name, ...tags },
    extra,
    contexts: {
      trace: { trace_id: traceId, span_id: txnSpanId, op: 'ui.action', status: 'ok' },
    },
    spans: spans.map(s => ({
      span_id: makeSpanId(),
      trace_id: traceId,
      parent_span_id: txnSpanId,
      op: s.op || 'task',
      description: s.description || '',
      start_timestamp: (s.startMs ?? startMs) / 1000,
      timestamp: (s.endMs ?? endMs) / 1000,
    })),
  };
  if (release) txn.release = release;
  if (user && (user.email || user.id || user.username)) txn.user = user;
  return envelopeFromItem(txn, 'transaction');
}

/**
 * Wrap an event/transaction body into Sentry's envelope format:
 *   {envelope header}\n{item header}\n{item payload}
 */
export function envelopeFromItem(item, itemType) {
  const header = JSON.stringify({ event_id: item.event_id, sent_at: nowIso() });
  const itemHeader = JSON.stringify({ type: itemType });
  const payload = JSON.stringify(item);
  return `${header}\n${itemHeader}\n${payload}`;
}

/**
 * POST an envelope string to Sentry. Thin network layer — the only un-unit
 * -tested part. Logs loudly on failure (a silently-dropped telemetry POST is
 * exactly the kind of failure that hid for weeks before).
 * @param {string} dsn
 * @param {string} envelope
 * @returns {Promise<boolean>} true on 2xx
 */
export async function sendEnvelope(dsn, envelope) {
  const parsed = parseDsn(dsn);
  if (!parsed) { console.warn('[telemetry] invalid DSN — skip'); return false; }
  try {
    const res = await fetch(parsed.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        // DSN public key auth (header form Sentry accepts on ingestion)
        'X-Sentry-Auth':
          `Sentry sentry_version=7, sentry_client=zealer-dashboard/telemetry, sentry_key=${parsed.publicKey}`,
      },
      body: envelope,
      credentials: 'omit',
    });
    if (!res.ok) {
      console.warn(`[telemetry] ingest returned ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[telemetry] send failed:', err?.message);
    return false;
  }
}
