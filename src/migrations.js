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
