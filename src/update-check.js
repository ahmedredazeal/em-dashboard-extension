/**
 * src/update-check.js — Zealer Dashboard (T-DIST-1, phase 1)
 *
 * Pure logic for the "update available" nudge. The extension can't update itself
 * in MV3 (Chrome owns that), so this is an interim nudge: check GitHub Releases
 * for the newest *promoted* release and, if it's newer than the running version,
 * surface a banner linking to it. The network fetch lives in popup/background;
 * this module is pure (parse + compare + select), so it unit-tests cleanly.
 *
 * "Promoted" marker: a release whose tag_name or name contains the token
 * `promoted` (case-insensitive). The maintainer adds that to a release once
 * they've tried the build and want the team to get it; un-promoted builds are
 * simply ignored by the nudge.
 *
 * Phase 2 (deferred) is the Chrome Web Store, which replaces this with native
 * auto-update.
 */

export const GITHUB_RELEASES_API =
  'https://api.github.com/repos/ahmedredazeal/em-dashboard-extension/releases';

/** Token a release must carry (in tag or name) to count as promoted. */
export const PROMOTED_TOKEN = 'promoted';

/**
 * Parse a version string into comparable numeric parts.
 * Tolerates a leading 'v' and extra suffixes (e.g. 'v2.12.0', '2.12.0-promoted').
 * @param {string} v
 * @returns {number[]} e.g. [2, 12, 0]  (empty array if unparseable)
 */
export function parseVersion(v) {
  if (!v || typeof v !== 'string') return [];
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compare two semver-ish strings.
 * @returns {number} >0 if a>b, <0 if a<b, 0 if equal/unparseable-equal
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Is this release marked promoted (token in tag_name or name)? */
export function isPromoted(release) {
  if (!release) return false;
  const hay = `${release.tag_name || ''} ${release.name || ''}`.toLowerCase();
  return hay.includes(PROMOTED_TOKEN);
}

/**
 * From a list of GitHub release objects, pick the newest PROMOTED release that
 * is strictly newer than the running version.
 * @param {Array}  releases       GitHub /releases response
 * @param {string} currentVersion e.g. manifest.version
 * @returns {{version, tag, name, htmlUrl, body} | null}
 */
export function selectUpdate(releases, currentVersion) {
  if (!Array.isArray(releases)) return null;
  const promoted = releases
    .filter(r => r && !r.draft && isPromoted(r))
    .map(r => ({
      version: (parseVersion(r.tag_name || r.name).join('.')) || null,
      tag: r.tag_name || '',
      name: r.name || '',
      htmlUrl: r.html_url || '',
      body: r.body || '',
    }))
    .filter(r => r.version);

  if (promoted.length === 0) return null;

  // Newest by version
  promoted.sort((a, b) => compareVersions(b.version, a.version));
  const newest = promoted[0];

  return compareVersions(newest.version, currentVersion) > 0 ? newest : null;
}

/**
 * Minimum gap between live GitHub fetches. The check runs on every app open,
 * but to stay well within GitHub's unauthenticated rate limit (60 req/hour/IP —
 * shared across everyone behind the same office IP), we only hit the network at
 * most once per this interval. Between fetches, a still-valid cached pending
 * banner is re-shown instantly, so it feels like an every-open check without
 * the request volume.
 */
export const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/** Should we run a live network check now? (rate-limit: once per intervalMs) */
export function shouldCheck(lastCheckedAt, now = Date.now(), intervalMs = CHECK_INTERVAL_MS) {
  if (!lastCheckedAt) return true;
  return (now - lastCheckedAt) >= intervalMs;
}

/** Is this update currently snoozed by "remind me later"? */
export function isSnoozed(snoozedVersion, snoozedUntil, candidateVersion, now = Date.now()) {
  if (!snoozedVersion || snoozedVersion !== candidateVersion) return false;
  if (!snoozedUntil) return false;
  return now < snoozedUntil;
}
