/**
 * sentry-trend.js
 * Stores and retrieves daily Sentry issue-count samples for the tracked view.
 *
 * Storage backend: chrome.storage.sync — persists across extension reinstall
 * and machine changes as long as the user is signed into Chrome.
 *
 * Key scheme:  "sentryTrend:{viewId}:{YYYY-MM}"
 * Value shape: { viewId, yearMonth, samples: [{day:"YYYY-MM-DD", count:N}] }
 *
 * One key per view per month. Up to 12 keys per view (rolling 365 days).
 * Each refresh overwrites today's entry for the traced view.
 */

const RETENTION_MONTHS = 12; // keep 12 full months (~365 days)

// ── Key helpers ────────────────────────────────────────────────────────────

function monthKey(viewId, yearMonth) {
  return `sentryTrend:${viewId}:${yearMonth}`;
}

/** "2026-05-23" → "2026-05" */
function toYearMonth(dateStr) {
  return dateStr.slice(0, 7);
}

/** Returns today's date string in UTC: "YYYY-MM-DD" */
export function todayUTC() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Returns "YYYY-MM" for N months ago from a given yearMonth string */
function monthsAgo(yearMonth, n) {
  const [y, m] = yearMonth.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** All yearMonth strings from cutoff to current (inclusive) */
function monthRange(fromYearMonth, toYearMonth) {
  const result = [];
  let current = fromYearMonth;
  while (current <= toYearMonth) {
    result.push(current);
    const [y, m] = current.split('-').map(Number);
    const next = new Date(Date.UTC(y, m, 1)); // first day of next month
    current = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return result;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Record today's unresolved count for a Sentry view.
 * Overwrites any existing entry for today in the current month bucket.
 * Prunes buckets older than RETENTION_MONTHS.
 *
 * @param {string} viewId
 * @param {number} count  — total unresolved issues at time of call
 */
export async function recordTrendSample(viewId, count) {
  if (!viewId || count == null) return;
  
  const today = todayUTC();
  const ym    = toYearMonth(today);
  const key   = monthKey(viewId, ym);
  
  // Load current month bucket (may not exist yet)
  let bucket;
  try {
    const result = await chrome.storage.sync.get(key);
    bucket = result[key] || { viewId, yearMonth: ym, samples: [] };
  } catch (e) {
    console.warn('[sentry-trend] Failed to read bucket:', e.message);
    bucket = { viewId, yearMonth: ym, samples: [] };
  }
  
  // Overwrite or insert today's sample
  const existing = bucket.samples.findIndex(s => s.day === today);
  if (existing >= 0) {
    bucket.samples[existing].count = count;
  } else {
    bucket.samples.push({ day: today, count });
  }
  
  // Persist
  try {
    await chrome.storage.sync.set({ [key]: bucket });
    console.log(`[sentry-trend] Recorded view ${viewId} on ${today}: ${count} issues`);
  } catch (e) {
    console.warn('[sentry-trend] Failed to write bucket:', e.message);
    return;
  }
  
  // Prune old months (fire-and-forget — don't block callers)
  pruneOldSamples(viewId, ym).catch(e =>
    console.warn('[sentry-trend] Prune error:', e.message)
  );
}

/**
 * Return the last 365 days of samples for a view, sorted oldest → newest.
 * Gaps (days when no data was recorded) are simply absent — callers handle them.
 *
 * @param {string} viewId
 * @returns {Promise<Array<{day:string, count:number}>>}
 */
export async function getTrendSamples(viewId) {
  if (!viewId) return [];
  
  const today   = todayUTC();
  const nowYM   = toYearMonth(today);
  const fromYM  = monthsAgo(nowYM, RETENTION_MONTHS - 1);
  const months  = monthRange(fromYM, nowYM);
  const keys    = months.map(ym => monthKey(viewId, ym));
  
  let result;
  try {
    result = await chrome.storage.sync.get(keys);
  } catch (e) {
    console.warn('[sentry-trend] Failed to read samples:', e.message);
    return [];
  }
  
  const cutoff = new Date(Date.UTC(...fromYM.split('-').map(Number)));
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 1); // include from month start
  
  const allSamples = [];
  for (const ym of months) {
    const bucket = result[monthKey(viewId, ym)];
    if (bucket?.samples) {
      allSamples.push(...bucket.samples);
    }
  }
  
  // Sort, deduplicate (keep last per day), and filter to window
  const byDay = new Map();
  for (const s of allSamples) {
    byDay.set(s.day, s.count);
  }
  
  const cutoffDay = monthsAgo(nowYM, RETENTION_MONTHS - 1) + '-01';
  return [...byDay.entries()]
    .filter(([day]) => day >= cutoffDay && day <= today)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, count]) => ({ day, count }));
}

/**
 * Remove month buckets for a view that are older than RETENTION_MONTHS.
 * Called automatically after each write.
 *
 * @param {string} viewId
 * @param {string} currentYM  — the current "YYYY-MM" (avoids re-computing)
 */
export async function pruneOldSamples(viewId, currentYM) {
  if (!viewId) return;
  
  const ym = currentYM || toYearMonth(todayUTC());
  
  // Find all keys for this viewId
  let allKeys;
  try {
    allKeys = await chrome.storage.sync.get(null);
  } catch (e) {
    return; // can't prune without list
  }
  
  const prefix  = `sentryTrend:${viewId}:`;
  const cutoff  = monthsAgo(ym, RETENTION_MONTHS - 1);
  const toDelete = Object.keys(allKeys)
    .filter(k => k.startsWith(prefix))
    .filter(k => {
      const bucketYM = k.replace(prefix, '');
      return bucketYM < cutoff;
    });
  
  if (toDelete.length > 0) {
    await chrome.storage.sync.remove(toDelete);
    console.log(`[sentry-trend] Pruned ${toDelete.length} old bucket(s) for view ${viewId}`);
  }
}
