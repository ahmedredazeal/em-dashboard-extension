/**
 * migrations.js
 * Handles data model migrations between versions
 */

/**
 * Rescue migration: restore settings.squad from settings.boards[0] if the
 * v1.0.0 → v1.1.0 migration ran and deleted squad. That migration was never
 * actually adopted by the rest of the app — the boards[] shape doesn't exist
 * elsewhere — so any user it ran for has a broken settings.squad. We rebuild
 * squad from the data that was preserved in boards[0].
 */
async function rescueSquadFromBoards(settings) {
  if (settings.squad) return settings; // squad is fine, nothing to rescue
  if (!Array.isArray(settings.boards) || settings.boards.length === 0) return settings;
  
  const board = settings.boards[0];
  if (!board.key) return settings; // can't rescue without a key
  
  settings.squad = {
    key:     board.key,
    name:    board.customName || board.name || '',
    boardId: board.boardId || null,
    extraBoards: settings.squad?.extraBoards || []
  };
  console.log(`[migration] RESCUED settings.squad from settings.boards[0] (key=${board.key})`);
  await chrome.storage.local.set({ settings });
  return settings;
}

/**
 * Migrate settings from v1.0.0 to v1.1.0 — DISABLED.
 * The v1.1.0 → boards[]/sentry.views[] shape was never adopted by app code
 * (popup.js, background.js, settings.js all still read settings.squad and
 * settings.sentry.views in the pipe-format). Originally this function was
 * never called (runMigrations was orphaned). When v1.4.4 wired up
 * runMigrations, this migration started running and broke users by
 * deleting settings.squad. Kept as a no-op for safety; rescue logic above
 * recovers users it already damaged.
 */
async function migrateToV1_1_0(settings) {
  return settings;
}

/**
 * Migrate to v1.4.4 — Sentry views change from pipe-format string array
 * to {label, url}[] objects. Per user decision: clear old entries entirely
 * and require fresh entry. Sets a flag so the settings page can show a
 * one-time banner explaining the reset.
 */
async function migrateToV1_4_4(settings) {
  settings.migrationsApplied = settings.migrationsApplied || {};
  
  // Already ran — bail
  if (settings.migrationsApplied['v1_4_4_sentry_url_format']) {
    return settings;
  }
  
  const views = settings.sentry?.views;
  if (!Array.isArray(views)) {
    // No existing views to clear — still mark migration applied so we don't
    // re-check forever and so the banner doesn't appear for fresh installs
    settings.migrationsApplied['v1_4_4_sentry_url_format'] = true;
    settings.migrationsApplied['v1_4_4_sentry_url_format_dismissed'] = true;
    await chrome.storage.local.set({ settings });
    return settings;
  }
  
  // Detect legacy formats: either a pipe-format string, or an object with
  // viewId/projectIds but no url field
  const isLegacy = views.some(v =>
    typeof v === 'string' ||
    (v && typeof v === 'object' && !v.url && (v.viewId || v.projectIds))
  );
  
  if (isLegacy) {
    console.log(`[migration] v1.4.4: clearing ${views.length} legacy Sentry view entries`);
    settings.sentry.views = [];
    settings.migrationsApplied['v1_4_4_sentry_url_format'] = true;
    // banner_dismissed deliberately NOT set — settings page will show the
    // one-time banner until user dismisses it
  } else {
    // Already in new format — mark migration applied so we don't run again,
    // and mark banner dismissed so fresh-install users never see it
    settings.migrationsApplied['v1_4_4_sentry_url_format'] = true;
    settings.migrationsApplied['v1_4_4_sentry_url_format_dismissed'] = true;
  }
  
  await chrome.storage.local.set({ settings });
  return settings;
}

/**
 * Migrate to v1.8.0 — multi-view Sentry tracking.
 * The single `settings.sentry.trackedViewId` (string) becomes
 * `settings.sentry.trackedViewIds` (string[]). Any existing tracked view is
 * wrapped into a one-element array so current tracking is preserved.
 * The old key is left in place (harmless) for one version in case of rollback.
 */
async function migrateToV1_8_0(settings) {
  settings.migrationsApplied = settings.migrationsApplied || {};
  if (settings.migrationsApplied['v1_8_0_multi_view_tracking']) {
    return settings;
  }

  settings.sentry = settings.sentry || {};

  // Only seed the array if it doesn't already exist
  if (!Array.isArray(settings.sentry.trackedViewIds)) {
    const old = settings.sentry.trackedViewId;
    settings.sentry.trackedViewIds = (old && typeof old === 'string') ? [old] : [];
    console.log(`[migration] v1.8.0: trackedViewId "${old || '(none)'}" → trackedViewIds [${settings.sentry.trackedViewIds.join(', ')}]`);
  }

  settings.migrationsApplied['v1_8_0_multi_view_tracking'] = true;
  await chrome.storage.local.set({ settings });
  return settings;
}

/**
 * Run all necessary migrations
 */
export async function runMigrations() {
  const result = await chrome.storage.local.get(['settings']);
  if (!result.settings) {
    console.log('[migration] No settings found, skipping migrations');
    return null;
  }
  
  let settings = result.settings;
  
  // Rescue must run FIRST — restores settings.squad if a previous run of
  // the (now-disabled) v1.1.0 migration deleted it
  settings = await rescueSquadFromBoards(settings);
  
  // Run migrations in order
  settings = await migrateToV1_1_0(settings);    // no-op (disabled)
  settings = await migrateToV1_4_4(settings);
  settings = await migrateToV1_8_0(settings);
  
  return settings;
}

/**
 * Get current settings (with migrations applied)
 */
export async function getSettings() {
  await runMigrations();
  const result = await chrome.storage.local.get(['settings']);
  return result.settings || null;
}
