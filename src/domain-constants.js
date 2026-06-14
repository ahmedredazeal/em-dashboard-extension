/**
 * src/domain-constants.js — Zealer Dashboard
 *
 * Single source of truth for Jira priority + status domain constants.
 * Previously these were duplicated across gantt.js (PORD, priorityBg/Fg),
 * popup.js (PRIORITY_DOT, TICKET_STATUS_COLORS) and parsers.js
 * (knownPriorities) — so adding a priority ("Urgent") meant editing 3 files,
 * and they drifted (popup's dot map was missing "urgent"). Import from here.
 */

/** Canonical priority names, highest urgency first. */
export const PRIORITY_NAMES = ['urgent', 'highest', 'critical', 'high', 'medium', 'low', 'lowest'];

/**
 * Sort rank per priority (lower = more urgent). Urgent/highest/critical share
 * the top tier; unknown priorities fall to medium.
 */
export const PRIORITY_ORDER = { urgent: 0, highest: 0, critical: 0, high: 1, medium: 2, low: 3, lowest: 4 };

/** 0-based sort index for a priority (defaults to medium). */
export function priorityIndex(p) {
  return PRIORITY_ORDER[(p || 'medium').toLowerCase()] ?? 2;
}

/** Is this a recognised priority name? (used for the unknown-priority warning) */
export function isKnownPriority(p) {
  return PRIORITY_NAMES.includes((p || '').toLowerCase());
}

/** Gantt bar background colour per priority (light chips). */
export const PRIORITY_BG = {
  urgent: '#FEE2E2', highest: '#FEE2E2', critical: '#FEE2E2',
  high: '#FEF3C7', medium: '#FEF9C3', low: '#DBEAFE', lowest: '#F3F4F6',
};
export function priorityBg(p) { return PRIORITY_BG[(p || 'medium').toLowerCase()] || '#FEF9C3'; }

/** Gantt bar foreground/text colour per priority. */
export const PRIORITY_FG = {
  urgent: '#991B1B', highest: '#991B1B', critical: '#991B1B',
  high: '#92400E', medium: '#854D0E', low: '#1E40AF', lowest: '#374151',
};
export function priorityFg(p) { return PRIORITY_FG[(p || 'medium').toLowerCase()] || '#854D0E'; }

/** Dot colour per priority (for the ticket-row priority dot). */
export const PRIORITY_DOT_COLOR = {
  urgent: '#ef4444', highest: '#ef4444', critical: '#ef4444',
  high: '#f97316', medium: '#f59e0b', low: '#60a5fa', lowest: '#94a3b8',
};

/** Status-name → colour (lowercased keys). */
export const STATUS_COLORS = {
  'done': '#22c55e', 'in progress': '#3b82f6', 'in review': '#8b5cf6',
  'blocked': '#ef4444', 'todo': 'var(--text-muted)', 'to do': 'var(--text-muted)',
  'qa rejected': '#f59e0b', 'open': 'var(--text-muted)',
};
export function statusColor(s) { return STATUS_COLORS[(s || '').toLowerCase()] || 'var(--text-muted)'; }

/** Status-category → glyph (Jira's three categories). */
export const STATUS_CATEGORY_ICON = { done: '✓', indeterminate: '●', new: '○' };
export function statusCategoryIcon(cat) { return STATUS_CATEGORY_ICON[cat] || '○'; }
