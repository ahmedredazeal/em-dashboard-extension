/**
 * src/changelog-parser.js
 * Extracts "when was this ticket closed?" from Jira changelog histories.
 * Pure functions — no side effects, no Chrome APIs.
 *
 * Background: when searching with expand=changelog, each issue has:
 *   issue.changelog.histories = [{ created, items: [{ field, toString }] }]
 *
 * We walk backward to find the MOST RECENT transition to a done-category
 * status, so re-openings are accounted for correctly.
 */

/**
 * Status names that count as "done" across common Jira workflows.
 * Extend this if your team uses custom names.
 */
export const DONE_STATUS_NAMES = new Set([
  'done', 'closed', 'resolved', 'qa accepted',
  'complete', 'completed', 'released', 'won\'t fix', 'won\'t do'
]);

/**
 * Returns true if the given status name is a "done" status.
 * @param {string} statusName
 * @returns {boolean}
 */
export function isDoneStatus(statusName) {
  return DONE_STATUS_NAMES.has((statusName || '').toLowerCase().trim());
}

/**
 * Extracts the ISO timestamp at which a Jira issue most recently
 * transitioned into a done-category status.
 *
 * @param {Object} issue - Raw Jira issue with expand=changelog
 * @returns {string|null} ISO timestamp, or null if issue is not done
 *
 * @example
 * const ts = transitionToDoneTimestamp(issue);
 * // → "2026-05-12T14:30:22.000+0000" or null
 */
export function transitionToDoneTimestamp(issue, extraDoneNames = []) {
  const histories = issue.changelog?.histories;
  if (!Array.isArray(histories) || histories.length === 0) return null;

  // Teams often use custom done-category status names ("Deployed", "Merged",
  // "Live") that aren't in DONE_STATUS_NAMES. Callers can pass those names so a
  // transition into them is recognised as a close.
  const extra = new Set(
    (extraDoneNames || []).map(n => (n || '').toLowerCase().trim()).filter(Boolean)
  );

  // Walk backward: most recent transition wins (handles re-open → close cycles)
  for (let i = histories.length - 1; i >= 0; i--) {
    const h = histories[i];
    if (!h.created || !Array.isArray(h.items)) continue;
    for (const item of h.items) {
      if (item.field === 'status' &&
          (isDoneStatus(item.toString) || extra.has((item.toString || '').toLowerCase().trim()))) {
        return h.created;
      }
    }
  }
  return null;
}

/**
 * Returns how many calendar days after sprintStartDate the given timestamp
 * falls on. Days are 0-indexed (day 0 = sprint start day).
 *
 * @param {string} timestamp - ISO date string
 * @param {string} sprintStartDate - ISO date string
 * @returns {number} day index (0-based)
 */
export function dayIndex(timestamp, sprintStartDate) {
  const diff = new Date(timestamp) - new Date(sprintStartDate);
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * For a list of stories that have already been normalised with normalizeStory(),
 * attaches a `closedAt` (ISO string) and `closedDay` (0-based int from sprint start)
 * to each story that has a done-transition in its changelog.
 *
 * @param {Array} rawIssues - Raw Jira issues with expand=changelog
 * @param {Array} stories   - Already-normalised story objects (same order)
 * @param {string} sprintStartDate
 * @returns {Array} Augmented stories with closedAt + closedDay
 */
export function attachCloseTimestamps(rawIssues, stories, sprintStartDate) {
  return stories.map((story, i) => {
    const raw = rawIssues[i];
    // When the story is currently in a done-category status, also treat its
    // current status NAME as a done status. This lets teams with custom done
    // names get an accurate close time from the changelog (the transition into
    // that status) rather than relying on the last-edited date.
    const extraDone = (story.statusCategory === 'done' && story.status) ? [story.status] : [];
    const closedAt = raw ? transitionToDoneTimestamp(raw, extraDone) : null;
    return {
      ...story,
      closedAt: closedAt || null,
      closedDay: closedAt ? dayIndex(closedAt, sprintStartDate) : null
    };
  });
}
