/**
 * src/gcal-auth.js — em-dashboard
 *
 * Google Calendar free/busy auth via chrome.identity.getAuthToken.
 *
 * Why getAuthToken (not launchWebAuthFlow): Google disabled the implicit grant
 * for "Web application" OAuth clients, and a no-secret auth-code flow for a web
 * client isn't possible without a backend. The Chrome-native path uses a
 * **Chrome Extension** OAuth client (created with the extension's ID — no Web
 * Store URL needed) plus the `oauth2` block in manifest.json. Chrome then:
 *   - manages the access-token cache and refresh for us;
 *   - needs no client secret and no redirect URI;
 *   - reads the client ID + scopes from manifest.oauth2.
 *
 * Trade-offs (accepted for the internal dashboard): the client ID lives in the
 * manifest (it's public, not a secret), and getAuthToken is Chrome-only (not
 * Brave). A stable extension ID is pinned via manifest.key so the OAuth client
 * keeps matching across reloads/machines. The public DevPulse fork ships no
 * client ID (forkers add their own). See docs/DECISIONS.md.
 *
 * Only the calendar.freebusy scope is used — busy times only, never details.
 */

const FREEBUSY_ENDPOINT = 'https://www.googleapis.com/calendar/v3/freeBusy';
const EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Build the freebusy.query request body. Pure → unit-testable. */
export function buildFreeBusyBody(emails, timeMinISO, timeMaxISO, timeZone = 'UTC') {
  return {
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    timeZone,
    items: (emails || []).filter(Boolean).map(id => ({ id })),
  };
}

/** Normalize getAuthToken's result (string in callback form, object in promise form). */
function tokenOf(result) {
  if (!result) return null;
  return typeof result === 'string' ? result : (result.token || null);
}

/**
 * Get an access token. interactive:true prompts the user (consent / account
 * picker) and MUST be triggered by a user gesture (the Settings "Connect"
 * button). interactive:false returns a cached/refreshed token or null.
 * @returns {Promise<string|null>}
 */
export async function getToken(interactive = false) {
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    return tokenOf(result);
  } catch (e) {
    if (interactive) throw e;   // surface real errors to the Connect button
    return null;                // silent path: just report "not connected"
  }
}

/** Cached/refreshed token without prompting (for the background worker). */
export async function getCachedToken() {
  return getToken(false);
}

/** Drop a token Chrome has cached (used after a 401, or to "Disconnect"). */
export async function removeCachedToken(token) {
  if (!token) return;
  try { await chrome.identity.removeCachedAuthToken({ token }); } catch { /* noop */ }
}

/** Fully disconnect: clear the cached token so the next Connect re-prompts. */
export async function disconnect() {
  const token = await getToken(false);
  if (token) await removeCachedToken(token);
}

/**
 * Query free/busy for a set of emails. Returns the raw response body.
 * On 401 the stale token is dropped and the call retried once with a fresh one;
 * if that still fails it throws {needsAuth:true} so the caller can prompt.
 */
export async function fetchFreeBusy(token, emails, timeMinISO, timeMaxISO, timeZone = 'UTC') {
  const body = JSON.stringify(buildFreeBusyBody(emails, timeMinISO, timeMaxISO, timeZone));
  const call = (tok) => fetch(FREEBUSY_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body,
  });

  let resp = await call(token);
  if (resp.status === 401) {
    await removeCachedToken(token);
    const fresh = await getToken(false);
    if (!fresh) { const e = new Error('unauthorized'); e.needsAuth = true; throw e; }
    resp = await call(fresh);
    if (resp.status === 401) { const e = new Error('unauthorized'); e.needsAuth = true; throw e; }
  }
  if (!resp.ok) throw new Error(`freebusy_http_${resp.status}`);
  return resp.json();
}

/**
 * List the user's own (primary) calendar events in [timeMin,timeMax]. Returns
 * the raw events.list body ({ items:[...] }). Requires the calendar.readonly
 * scope (gives real titles, unlike free/busy). Same 401 drop-and-retry as above.
 * Powers the "Today's Meetings" card in Google mode (Chrome only).
 */
export async function fetchEvents(token, timeMinISO, timeMaxISO) {
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: 'true',        // expand recurring events → concrete instances
    orderBy: 'startTime',
    maxResults: '50',
  });
  const url = `${EVENTS_ENDPOINT}?${params.toString()}`;
  const call = (tok) => fetch(url, { headers: { Authorization: `Bearer ${tok}` } });

  let resp = await call(token);
  if (resp.status === 401) {
    await removeCachedToken(token);
    const fresh = await getToken(false);
    if (!fresh) { const e = new Error('unauthorized'); e.needsAuth = true; throw e; }
    resp = await call(fresh);
    if (resp.status === 401) { const e = new Error('unauthorized'); e.needsAuth = true; throw e; }
  }
  if (!resp.ok) throw new Error(`events_http_${resp.status}`);
  return resp.json();
}
