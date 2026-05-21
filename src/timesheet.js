/**
 * src/timesheet.js
 * Computes per-member time logged in Week 1 and Week 2 of a sprint.
 * Pure functions — no side effects.
 *
 * INPUT (worklogs):
 *   Array of Jira worklog entries (from issue.fields.worklog.worklogs):
 *   {
 *     author: { displayName: "Ahmed Reda" },
 *     started: "2026-05-06T09:00:00.000+0000",
 *     timeSpentSeconds: 28800
 *   }
 *
 * OUTPUT:
 *   {
 *     "Ahmed Reda": { week1: 18.5, week2: 14.0 },
 *     "Khalid Hassan": { week1: 12.0, week2: 20.5 }
 *   }
 *   All values in hours (rounded to 1dp).
 *
 * WEEK DEFINITION:
 *   Week 1 = sprint day 0–6 (same calendar week as sprint start).
 *   Week 2 = sprint day 7–13.
 *   Worklogs on non-working days are excluded.
 *
 * WORKING DAYS:
 *   Represented as an array of day-of-week integers (0=Sun, 6=Sat).
 *   Default: [0, 1, 2, 3, 4] = Sunday through Thursday (Middle East week).
 *   Pass any combination, e.g. [1,2,3,4,5] for Mon–Fri.
 */

export const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4]; // Sun-Thu

/**
 * Classify a single worklog entry as 'week1', 'week2', or null.
 *
 * @param {string} worklogStarted  - ISO date string from worklog.started
 * @param {string} sprintStartDate - ISO date string (sprint start)
 * @param {number[]} workingDays   - Day-of-week indices to count (0=Sun)
 * @returns {'week1'|'week2'|null}
 */
export function classifyWorklogWeek(worklogStarted, sprintStartDate, workingDays = DEFAULT_WORKING_DAYS) {
  if (!worklogStarted || !sprintStartDate) return null;

  const logged = new Date(worklogStarted);
  const start  = new Date(sprintStartDate);

  // Use UTC day to avoid timezone issues with ISO date strings
  const dayOfWeek = logged.getUTCDay(); // 0=Sun … 6=Sat
  if (!workingDays.includes(dayOfWeek)) return null;

  const dayOffset = Math.floor((logged - start) / (1000 * 60 * 60 * 24));
  if (dayOffset < 0 || dayOffset > 13) return null;
  return dayOffset <= 6 ? 'week1' : 'week2';
}

/**
 * Compute the timesheet from a flat array of worklog objects.
 *
 * @param {Array}    worklogs       - Flat array of Jira worklog entries
 * @param {string}   sprintStartDate
 * @param {number[]} workingDays
 * @returns {Object} { "displayName": { week1: hours, week2: hours } }
 */
export function computeTimesheet(worklogs, sprintStartDate, workingDays = DEFAULT_WORKING_DAYS) {
  if (!Array.isArray(worklogs) || !sprintStartDate) return {};

  const members = {};

  for (const wl of worklogs) {
    const author = wl.author?.displayName || wl.author?.name || 'Unknown';
    const week = classifyWorklogWeek(wl.started, sprintStartDate, workingDays);
    if (!week) continue;

    if (!members[author]) members[author] = { week1: 0, week2: 0 };
    const hours = (wl.timeSpentSeconds || 0) / 3600;
    members[author][week] = Math.round((members[author][week] + hours) * 10) / 10;
  }

  return members;
}

/**
 * Extract all worklogs from a list of raw Jira issues.
 * Works with issues fetched with `fields: ['worklog']`.
 *
 * Jira returns inline worklogs in issue.fields.worklog.worklogs[] when
 * total <= maxResults. For issues where total > maxResults (>20 worklogs),
 * the caller must fetch full worklogs separately and merge before calling
 * this function.
 *
 * @param {Array} rawIssues - Raw Jira issues with worklog field
 * @returns {{ worklogs: Array, needsFullFetch: string[] }}
 *   worklogs        - All inline worklogs ready to pass to computeTimesheet
 *   needsFullFetch  - Issue keys where inline worklogs are incomplete (total > maxResults)
 */
export function extractWorklogs(rawIssues) {
  const worklogs = [];
  const needsFullFetch = [];

  for (const issue of rawIssues) {
    const wlField = issue.fields?.worklog;
    if (!wlField) continue;

    const { total = 0, maxResults = 20, worklogs: wls = [] } = wlField;

    worklogs.push(...wls);

    if (total > maxResults) {
      needsFullFetch.push(issue.key);
    }
  }

  return { worklogs, needsFullFetch };
}

/**
 * Sort timesheet members by total hours (most active first).
 * Useful for chart rendering.
 *
 * @param {Object} timesheet - { "name": { week1, week2 } }
 * @returns {Array} [{ name, week1, week2, total }] sorted desc
 */
export function sortTimesheetMembers(timesheet) {
  return Object.entries(timesheet)
    .map(([name, { week1, week2 }]) => ({ name, week1, week2, total: week1 + week2 }))
    .sort((a, b) => b.total - a.total);
}
