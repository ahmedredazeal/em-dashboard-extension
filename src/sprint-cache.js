/**
 * src/sprint-cache.js
 * Chrome storage layer for sprint analytics data (burndown + timesheet).
 * Keyed by sprint name so historical data is preserved when sprints change.
 *
 * Storage shape:
 * {
 *   sprintAnalyticsCache: {
 *     "HRM Sprint 64": {
 *       burndown:  { ideal, estimate, actual, labels, totalPoints, totalDays, hasActualData },
 *       timesheet: { "Ahmed": { week1, week2 }, ... },
 *       sprintId:  64,
 *       cachedAt:  1747500000000
 *     },
 *     "HRM Sprint 63": { ... }
 *   }
 * }
 */

const CACHE_KEY = 'sprintAnalyticsCache';

/**
 * Read cached analytics for a specific sprint.
 * @param {string} sprintName
 * @returns {Promise<Object|null>}
 */
export async function getCachedSprintData(sprintName) {
  const result = await chrome.storage.local.get([CACHE_KEY]);
  const cache = result[CACHE_KEY] || {};
  return cache[sprintName] || null;
}

/**
 * Save computed analytics for a sprint.
 * @param {string} sprintName
 * @param {{ burndown, timesheet, sprintId }} data
 */
export async function setCachedSprintData(sprintName, data) {
  const result = await chrome.storage.local.get([CACHE_KEY]);
  const cache = result[CACHE_KEY] || {};
  cache[sprintName] = { ...data, cachedAt: Date.now() };
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
  console.log(`[sprint-cache] Saved analytics for "${sprintName}"`);
}

/**
 * Delete cached analytics for a single sprint.
 * @param {string} sprintName
 */
export async function deleteCachedSprintData(sprintName) {
  const result = await chrome.storage.local.get([CACHE_KEY]);
  const cache = result[CACHE_KEY] || {};
  delete cache[sprintName];
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
  console.log(`[sprint-cache] Deleted analytics for "${sprintName}"`);
}

/**
 * Delete all cached sprint analytics.
 */
export async function clearAllCachedSprints() {
  await chrome.storage.local.set({ [CACHE_KEY]: {} });
  console.log('[sprint-cache] Cleared all sprint analytics');
}

/**
 * List all cached sprints with metadata for settings UI.
 * @returns {Promise<Array<{ name, cachedAt, sprintId, sizeKb }>>}
 */
export async function getAllCachedSprints() {
  const result = await chrome.storage.local.get([CACHE_KEY]);
  const cache = result[CACHE_KEY] || {};
  return Object.entries(cache)
    .map(([name, data]) => ({
      name,
      sprintId: data.sprintId || null,
      cachedAt: data.cachedAt || 0,
      sizeKb: Math.round(JSON.stringify(data).length / 1024 * 10) / 10
    }))
    .sort((a, b) => b.cachedAt - a.cachedAt);
}

/**
 * Get names of cached sprints that are NOT the current active sprint.
 * These are candidates for deletion.
 * @param {string} activeSprintName
 * @returns {Promise<string[]>}
 */
export async function getInactiveSprintNames(activeSprintName) {
  const all = await getAllCachedSprints();
  return all.map(s => s.name).filter(n => n !== activeSprintName);
}

/**
 * Check if the active sprint has changed since last cache write.
 * Returns the OLD sprint name if changed, null otherwise.
 * @param {string} activeSprintName
 * @returns {Promise<string|null>}
 */
export async function detectSprintChange(activeSprintName) {
  const result = await chrome.storage.local.get(['lastActiveSprintName']);
  const last = result.lastActiveSprintName;
  if (last && last !== activeSprintName) {
    await chrome.storage.local.set({ lastActiveSprintName: activeSprintName });
    return last; // Return the old (now inactive) sprint name
  }
  if (!last) {
    await chrome.storage.local.set({ lastActiveSprintName: activeSprintName });
  }
  return null;
}
