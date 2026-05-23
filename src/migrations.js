/**
 * migrations.js
 * Handles data model migrations between versions
 */

/**
 * Migrate settings from v1.0.0 to v1.1.0
 * Changes:
 * - squad → boards[] array
 * - sentry.project → sentry.views[] array
 */
async function migrateToV1_1_0(settings) {
  console.log('[migration] Checking if v1.0.0 → v1.1.0 migration needed...');
  
  let migrated = false;
  
  // Migrate squad → boards
  if (settings.squad && !settings.boards) {
    settings.boards = [{
      id: crypto.randomUUID(),
      key: settings.squad.key,
      customName: settings.squad.name,
      boardId: settings.squad.boardId,
      order: 0,
      visible: true
    }];
    delete settings.squad;
    migrated = true;
    console.log('[migration] Migrated squad → boards[]');
  }
  
  // Migrate sentry.project → sentry.views
  if (settings.sentry && settings.sentry.project && !settings.sentry.views) {
    // Default: create a single view for the old project
    settings.sentry.views = [{
      id: crypto.randomUUID(),
      viewId: '201661', // Default view ID (all projects)
      label: 'All Unresolved Issues',
      showTotal: true,
      showDetails: false
    }];
    delete settings.sentry.project;
    migrated = true;
    console.log('[migration] Migrated sentry.project → sentry.views[]');
  }
  
  // Add preferences if not exists
  if (!settings.preferences) {
    settings.preferences = {
      collapsedSections: [],
      defaultBoard: settings.boards?.[0]?.id || null
    };
    migrated = true;
    console.log('[migration] Added preferences object');
  }
  
  if (migrated) {
    await chrome.storage.local.set({ settings });
    console.log('[migration] v1.0.0 → v1.1.0 migration complete');
  } else {
    console.log('[migration] No migration needed, already v1.1.0 format');
  }
  
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
 * Run all necessary migrations
 */
export async function runMigrations() {
  const result = await chrome.storage.local.get(['settings']);
  if (!result.settings) {
    console.log('[migration] No settings found, skipping migrations');
    return null;
  }
  
  let settings = result.settings;
  
  // Run migrations in order
  settings = await migrateToV1_1_0(settings);
  settings = await migrateToV1_4_4(settings);
  
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
