/**
 * worklog-aggregator.js
 * Pure functions for aggregating team worklog data fetched from Jira.
 *
 * Jira's /rest/api/3/search returns issues with embedded worklogs. Each
 * worklog has: author.accountId, author.displayName, timeSpentSeconds,
 * started (ISO date-time string).
 *
 * The issue provides: project.key, project.name, timeoriginalestimate,
 * issuetype.name, priority.name.
 *
 * All functions are pure (no I/O) for easy unit testing.
 */

// ── Project colour palette ─────────────────────────────────────────────────
// 8 colours assigned deterministically by project key (alphabetical order)
// so the same project always gets the same colour across sessions.
const PALETTE = [
  '#0ea5e9', // sky blue
  '#f97316', // orange
  '#ec4899', // pink
  '#22c55e', // green
  '#a855f7', // purple
  '#eab308', // yellow
  '#14b8a6', // teal
  '#ef4444', // red
];

/**
 * Assign a colour from the palette to each project key.
 * Keys are sorted alphabetically so assignment is stable.
 *
 * @param {string[]} projectKeys
 * @returns {Object}  { [projectKey]: hexColor }
 */
export function assignProjectColors(projectKeys) {
  const sorted = [...new Set(projectKeys)].sort();
  const map = {};
  sorted.forEach((key, i) => {
    map[key] = PALETTE[i % PALETTE.length];
  });
  return map;
}

// ── Quarter helpers ────────────────────────────────────────────────────────

/**
 * Return the quarters available for display given today's date.
 * A quarter is shown if its first month has already started.
 *
 * Q1 = Jan–Mar  (always shown once year starts)
 * Q2 = Apr–Jun  (shown from April onward)
 * Q3 = Jul–Sep  (shown from July onward)
 * Q4 = Oct–Dec  (shown from October onward)
 *
 * @param {number} year   full year (e.g. 2026)
 * @param {number} month  1-based current month (e.g. 5 for May)
 * @returns {Array<{label:string, q:number, year:number, start:string, end:string}>}
 */
export function currentQuarters(year, month) {
  const defs = [
    { q: 1, label: 'Q1', startMonth: 1,  endMonth: 3  },
    { q: 2, label: 'Q2', startMonth: 4,  endMonth: 6  },
    { q: 3, label: 'Q3', startMonth: 7,  endMonth: 9  },
    { q: 4, label: 'Q4', startMonth: 10, endMonth: 12 },
  ];
  
  return defs
    .filter(d => d.startMonth <= month)
    .map(d => {
      const endDay = new Date(year, d.endMonth, 0).getDate(); // last day of endMonth
      return {
        label: d.label,
        q: d.q,
        year,
        start: `${year}-${String(d.startMonth).padStart(2,'0')}-01`,
        end:   `${year}-${String(d.endMonth).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`,
      };
    });
}

/**
 * Get start/end dates for a specific quarter.
 * @param {number} q     1-4
 * @param {number} year
 * @returns {{start: string, end: string}}
 */
export function quarterRange(q, year) {
  const startMonth = (q - 1) * 3 + 1;
  const endMonth   = q * 3;
  const endDay     = new Date(year, endMonth, 0).getDate();
  return {
    start: `${year}-${String(startMonth).padStart(2,'0')}-01`,
    end:   `${year}-${String(endMonth).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`,
  };
}

// ── Worklog aggregation ────────────────────────────────────────────────────

/**
 * Aggregate raw worklog entries (extracted from Jira issue search results)
 * into per-author summaries with project breakdown.
 *
 * Each rawWorklog: {
 *   authorId, authorName, timeSpentSeconds, started,
 *   projectKey, projectName,
 *   estimateSeconds (from issue.timeoriginalestimate, may be 0),
 *   issueType (e.g. "Bug", "Story", "Task")
 * }
 *
 * Returns array sorted by total hours descending:
 * [{
 *   name, accountId, total (h, 1dp),
 *   byProject: { [key]: hours },
 *   projectNames: { [key]: name },
 *   estimated (h, 1dp),
 *   estimateRatio (actual/estimated, null if no estimate)
 * }]
 */
export function aggregateWorklogs(rawWorklogs) {
  if (!rawWorklogs || rawWorklogs.length === 0) return [];
  
  const byAuthor = new Map(); // accountId → accumulator
  
  for (const wl of rawWorklogs) {
    const id = wl.authorId || wl.authorName || 'unknown';
    if (!byAuthor.has(id)) {
      byAuthor.set(id, {
        name: wl.authorName || id,
        accountId: wl.authorId || id,
        totalSeconds: 0,
        estimateSeconds: 0,
        byProjectSeconds: {},
        projectNames: {},
        byDateSeconds: {},   // NEW: per-calendar-day seconds
      });
    }
    const acc = byAuthor.get(id);
    acc.totalSeconds += wl.timeSpentSeconds || 0;
    acc.estimateSeconds += wl.estimateSeconds || 0;
    
    const pk = wl.projectKey || 'Unknown';
    acc.byProjectSeconds[pk] = (acc.byProjectSeconds[pk] || 0) + (wl.timeSpentSeconds || 0);
    if (wl.projectName) acc.projectNames[pk] = wl.projectName;

    // Accumulate per calendar day
    const dk = (wl.started || '').slice(0, 10);
    if (dk) acc.byDateSeconds[dk] = (acc.byDateSeconds[dk] || 0) + (wl.timeSpentSeconds || 0);
  }
  
  const round1 = s => Math.round(s / 3600 * 10) / 10;
  
  return [...byAuthor.values()]
    .map(acc => ({
      name:      acc.name,
      accountId: acc.accountId,
      total:     round1(acc.totalSeconds),
      byProject: Object.fromEntries(
        Object.entries(acc.byProjectSeconds).map(([k, s]) => [k, round1(s)])
      ),
      projectNames: acc.projectNames,
      estimated:    round1(acc.estimateSeconds),
      estimateRatio: acc.estimateSeconds > 0
        ? Math.round(acc.totalSeconds / acc.estimateSeconds * 100) / 100
        : null,
      byDate: Object.fromEntries(
        Object.entries(acc.byDateSeconds).map(([d, s]) => [d, round1(s)])
      ),
    }))
    .filter(m => m.total > 0)
    .sort((a, b) => b.total - a.total);
}

/**
 * Compute team-level issue type breakdown from raw worklogs.
 * Returns { Bug: hours, Story: hours, Task: hours, ... } sorted by hours desc.
 */
export function aggregateByIssueType(rawWorklogs) {
  const byType = {};
  for (const wl of rawWorklogs) {
    const t = wl.issueType || 'Other';
    byType[t] = (byType[t] || 0) + (wl.timeSpentSeconds || 0);
  }
  const round1 = s => Math.round(s / 3600 * 10) / 10;
  return Object.entries(byType)
    .map(([type, s]) => ({ type, hours: round1(s) }))
    .sort((a, b) => b.hours - a.hours);
}

/**
 * Extract raw worklog entries from an array of Jira issue objects
 * (as returned by POST /rest/api/3/search/jql with embedded worklogs).
 *
 * @param {Object[]} issues   Raw Jira issue objects
 * @param {string[]} authorIds  Account IDs to filter by (include all if empty)
 * @param {string}  startDate   "YYYY-MM-DD" inclusive
 * @param {string}  endDate     "YYYY-MM-DD" inclusive
 * @returns {Object[]} rawWorklogs
 */
export function extractWorklogsFromIssues(issues, authorIds, startDate, endDate) {
  const filterByAuthor = authorIds && authorIds.length > 0;
  const authorSet = new Set(authorIds);
  const raw = [];
  
  for (const issue of issues) {
    const projectKey  = issue.fields?.project?.key   || 'Unknown';
    const projectName = issue.fields?.project?.name  || 'Unknown';
    const estimateSec = issue.fields?.timeoriginalestimate || 0;
    const issueType   = issue.fields?.issuetype?.name || 'Other';
    const worklogs    = issue.fields?.worklog?.worklogs || [];
    
    for (const wl of worklogs) {
      const authorId   = wl.author?.accountId   || '';
      const authorName = wl.author?.displayName || '';
      const started    = wl.started?.slice(0, 10) || ''; // "YYYY-MM-DD"
      
      if (filterByAuthor && !authorSet.has(authorId)) continue;
      if (started < startDate || started > endDate)   continue;
      
      raw.push({
        authorId,
        authorName,
        timeSpentSeconds: wl.timeSpentSeconds || 0,
        started,
        projectKey,
        projectName,
        estimateSeconds: estimateSec, // per-issue estimate attributed to each worklog
        issueType,
      });
    }
  }
  
  return raw;
}
