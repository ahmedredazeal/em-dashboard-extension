/**
 * src/gcal-auth.js — em-dashboard
 *
 * Minimal Google Calendar auth for the Time Utilization overlay. Uses the OAuth
 * implicit flow via chrome.identity.launchWebAuthFlow, so:
 *   - the only credential is a CLIENT ID, supplied at runtime from Settings —
 *     never hardcoded in the repo, and not a secret (public by design);
 *   - there is NO client secret anywhere (implicit flow doesn't use one);
 *   - the only scope requested is calendar.freebusy (busy times, no details).
 *
 * The access token (~1h) is cached in chrome.storage.local. On expiry we try a
 * silent re-auth (interactive:false); if that fails the caller prompts the user
 * to reconnect. No refresh token is issued by the implicit flow — acceptable for
 * a periodically-refreshed dashboard. See docs/DECISIONS.md.
 */

const SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const FREEBUSY_ENDPOINT = 'https://www.googleapis.com/calendar/v3/freeBusy';
const TOKEN_KEY = 'gcalFreebusyToken';

/** Build the Google implicit-flow auth URL. Pure → unit-testable. */
export function buildAuthUrl(clientId, redirectUri, scope = SCOPE) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope,
    include_granted_scopes: 'true',
    prompt: 'consent',
  });
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

/**
 * Parse the access token + expiry from the redirect URL fragment. Pure.
 * @returns {{accessToken:string, expiresAt:number}|null}
 */
export function parseTokenFromRedirect(redirectUrl) {
  if (!redirectUrl) return null;
  const frag = redirectUrl.includes('#') ? redirectUrl.split('#')[1] : '';
  const q = new URLSearchParams(frag);
  const token = q.get('access_token');
  if (!token) return null;
  const expiresIn = parseInt(q.get('expires_in') || '3600', 10);
  // Refresh a minute early to avoid edge-of-expiry 401s.
  return { accessToken: token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
}

/** Build the freebusy.query request body. Pure. */
export function buildFreeBusyBody(emails, timeMinISO, timeMaxISO, timeZone = 'UTC') {
  return {
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    timeZone,
    items: (emails || []).filter(Boolean).map(id => ({ id })),
  };
}

const redirectUri = () =>
  (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getRedirectURL)
    ? chrome.identity.getRedirectURL()
    : '';

function readCached() {
  return new Promise(resolve => {
    chrome.storage.local.get(TOKEN_KEY, d => resolve(d[TOKEN_KEY] || null));
  });
}
function writeCached(tok) {
  return new Promise(resolve => chrome.storage.local.set({ [TOKEN_KEY]: tok }, resolve));
}

/** Run launchWebAuthFlow and cache the resulting token. */
async function runAuthFlow(clientId, interactive) {
  const url = buildAuthUrl(clientId, redirectUri());
  const redirect = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive }, r => {
      const err = chrome.runtime.lastError;
      if (err || !r) return reject(new Error(err ? err.message : 'auth_dismissed'));
      resolve(r);
    });
  });
  const tok = parseTokenFromRedirect(redirect);
  if (!tok) throw new Error('no_token_in_redirect');
  await writeCached(tok);
  return tok.accessToken;
}

/**
 * Get a valid access token: cached → silent re-auth → (if allowed) interactive.
 * @param {string} clientId
 * @param {boolean} [interactive=false]  prompt the user if needed
 * @returns {Promise<string>} access token
 */
export async function getToken(clientId, interactive = false) {
  if (!clientId) throw new Error('missing_client_id');
  const cached = await readCached();
  if (cached && cached.accessToken && cached.expiresAt > Date.now()) return cached.accessToken;
  try { return await runAuthFlow(clientId, false); }       // silent
  catch (e) {
    if (interactive) return await runAuthFlow(clientId, true);
    throw e;
  }
}

/** Clear the cached token (used by a "Disconnect" action). */
export async function disconnect() {
  await new Promise(resolve => chrome.storage.local.remove(TOKEN_KEY, resolve));
}

/**
 * Query free/busy for a set of emails. Returns the raw response body.
 * Throws {needsAuth:true} on 401 so the caller can prompt a reconnect.
 */
export async function fetchFreeBusy(token, emails, timeMinISO, timeMaxISO, timeZone = 'UTC') {
  const resp = await fetch(FREEBUSY_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildFreeBusyBody(emails, timeMinISO, timeMaxISO, timeZone)),
  });
  if (resp.status === 401) { const e = new Error('unauthorized'); e.needsAuth = true; throw e; }
  if (!resp.ok) throw new Error(`freebusy_http_${resp.status}`);
  return resp.json();
}
