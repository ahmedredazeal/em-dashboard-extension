/**
 * src/render-scheduler.js — Zealer Dashboard
 *
 * Pure core of the S-4 render scheduler (the timing decision, separated from the
 * DOM-touching render itself so it can be unit-tested). popup.js's
 * `requestRender()` uses these helpers to decide how a trigger should be handled.
 *
 * The actual setTimeout/render lives in popup.js (it touches live DOM); this
 * module only answers "given the current pending state + this request, what
 * should happen?" — which is the part worth testing.
 */

/**
 * Decide how to handle a render request.
 * @param {Object} req
 * @param {boolean} [req.immediate]      caller asked for a synchronous render
 * @param {boolean} [req.hasPending]     a coalesced render is already queued
 * @returns {{ action: 'render-now'|'queue'|'coalesce', clearPending: boolean }}
 *   - render-now : run the render synchronously (immediate mode)
 *   - queue      : start a new debounce timer
 *   - coalesce   : a timer is already pending; do nothing (the request folds in)
 *   clearPending : whether an existing pending timer must be cancelled first
 */
export function planRender({ immediate = false, hasPending = false } = {}) {
  if (immediate) {
    // Immediate wins: cancel any queued coalesced render and run now.
    return { action: 'render-now', clearPending: hasPending };
  }
  if (hasPending) {
    // Already queued — restart the debounce window so the burst keeps coalescing.
    return { action: 'queue', clearPending: true };
  }
  return { action: 'queue', clearPending: false };
}

/** Default debounce window (ms) for coalesced renders. */
export const RENDER_DEBOUNCE_MS = 250;

/**
 * Normalise a reason tag for the debug breadcrumb (keeps logs tidy/greppable).
 * @param {string} reason
 * @returns {string}
 */
export function renderReason(reason) {
  if (!reason || typeof reason !== 'string') return 'unspecified';
  return reason.trim().slice(0, 60) || 'unspecified';
}
