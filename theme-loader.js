/**
 * theme-loader.js
 * Loads theme and version before page render to prevent flash
 * Used by all secondary pages (settings, docs, changelog)
 * Per GUIDELINES.md §1 and §6
 */

(async function() {
  try {
    // Load theme from storage
    const result = await chrome.storage.local.get(['settings']);
    const theme = result.settings?.ui?.theme || 'browser';
    
    // Apply theme to root
    document.documentElement.setAttribute('data-theme', theme);
    
    // Load version from manifest
    const manifest = chrome.runtime.getManifest();
    const version = manifest.version;
    
    // Set version on all matching elements
    // id="ver-display", class="app-version", or data-version attribute
    const versionElements = [
      ...document.querySelectorAll('#ver-display'),
      ...document.querySelectorAll('.app-version'),
      ...document.querySelectorAll('[data-version]')
    ];
    
    versionElements.forEach(el => {
      el.textContent = `v${version}`;
    });
    
  } catch (error) {
    console.error('[theme-loader] Failed to load theme or version:', error);
    // Fail gracefully — page still loads with default theme
  }
})();
