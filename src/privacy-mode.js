/**
 * privacy-mode.js
 * Utilities for screen-share privacy mode
 * Phase 1: toggle + state check
 * Phase 2+: will mask people log, 1:1 notes, promotion evidence
 */

/**
 * Check if privacy mode is currently ON
 * @returns {Promise<boolean>}
 */
export async function isPrivacyModeOn() {
  try {
    const result = await chrome.storage.local.get(['settings']);
    return result.settings?.ui?.privacyMode === true;
  } catch (error) {
    console.error('[privacy-mode] Failed to check privacy mode:', error);
    return false;
  }
}

/**
 * Toggle privacy mode ON/OFF
 * @returns {Promise<boolean>} new state
 */
export async function togglePrivacyMode() {
  try {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};
    
    if (!settings.ui) settings.ui = {};
    
    // Toggle
    settings.ui.privacyMode = !settings.ui.privacyMode;
    
    await chrome.storage.local.set({ settings });
    
    // Apply to body immediately
    if (settings.ui.privacyMode) {
      document.body.classList.add('privacy-on');
    } else {
      document.body.classList.remove('privacy-on');
    }
    
    return settings.ui.privacyMode;
  } catch (error) {
    console.error('[privacy-mode] Failed to toggle privacy mode:', error);
    return false;
  }
}

/**
 * Apply privacy mode state to current page (called on load)
 * @returns {Promise<void>}
 */
export async function applyPrivacyMode() {
  const isOn = await isPrivacyModeOn();
  
  if (isOn) {
    document.body.classList.add('privacy-on');
  } else {
    document.body.classList.remove('privacy-on');
  }
}

/**
 * Mark an element as privacy-maskable
 * (Phase 2+: will be used for people log entries, 1:1 notes, etc.)
 * @param {HTMLElement} element
 */
export function markAsMaskable(element) {
  if (!element) return;
  element.setAttribute('data-privacy-mask', 'true');
}

/**
 * Get count of masked elements (for UI feedback)
 * @returns {number}
 */
export function getMaskedCount() {
  return document.querySelectorAll('[data-privacy-mask]').length;
}
