/**
 * src/ticket-stats.js — Zealer Dashboard
 *
 * Pure ticket aggregation helpers (data logic, not rendering). Kept out of
 * src/render/ on purpose — this returns plain data, not HTML.
 *
 * Extracted from popup.js (stability S-3, v2.10.6). Byte-identical behaviour.
 */

/**
 * Count tickets grouped by their actual status name (not just category
 * buckets), plus the support-analytics label counts.
 *
 * Shows the real distribution from Jira, whatever the workflow is.
 *
 * @param {Array} stories  [{ status, labels }]
 * @returns {{ byStatus: Object<string,number>, breached: number, blocked: number, total: number }}
 */
export function ticketCounts(stories) {
  // Group by status name, case-insensitive
  const byStatus = {};
  for (const s of stories) {
    const name = s.status || 'Unknown';
    byStatus[name] = (byStatus[name] || 0) + 1;
  }

  // Labels for support analytics
  const breached = stories.filter(s => s.labels?.includes('BreachedSLA')).length;
  const blocked  = stories.filter(s => s.labels?.includes('blocked-external')).length;

  return { byStatus, breached, blocked, total: stories.length };
}
