/**
 * src/trend-colors.js
 * Shared color palette for multi-view Sentry trend tracking.
 *
 * Colors are assigned by a view's INDEX in settings.sentry.views, so a given
 * view always renders in the same color across the chart, legend, and settings
 * swatches — regardless of the order it was tracked in. Beyond the palette
 * length the colors cycle.
 */

export const TREND_COLORS = [
  '#6366f1', // indigo
  '#22c55e', // green
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#a855f7', // purple
  '#ef4444', // red
  '#14b8a6', // teal
];

/**
 * Color for a given view index (cycles past the palette length).
 * @param {number} index
 * @returns {string} hex color
 */
export function colorForIndex(index) {
  if (index == null || index < 0) return TREND_COLORS[0];
  return TREND_COLORS[index % TREND_COLORS.length];
}
