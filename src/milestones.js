/**
 * src/milestones.js — Zealer Dashboard
 *
 * Milestone tracking for OKRs / Dev Plans.
 *
 * A "milestone" is a Jira LABEL applied to backlog tickets in the squad's own
 * project. Because the tickets live in the same project, they can be pulled
 * into the active sprint at any time — while progress is tracked on the
 * milestone (label) overall, by TICKET COUNT (most backlog tickets carry no
 * story points until they enter a sprint).
 *
 * Settings format (one milestone per line):
 *   label
 *   label | Display Name
 *   label | Display Name | https://…leapsome…   (renders "Open in Leapsome ↗")
 */

/**
 * Parse the settings textarea into milestone configs.
 * @param {string} text  raw textarea value, one milestone per line
 * @returns {Array<{label:string, name:string, leapsomeUrl:string|null}>}
 */
export function parseMilestoneLines(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [label = '', name = '', url = ''] = line.split('|').map(p => p.trim());
      if (!label) return null;
      return {
        label,
        name: name || label,
        leapsomeUrl: /^https?:\/\//i.test(url) ? url : null,
      };
    })
    .filter(Boolean);
}

/**
 * Group fetched tickets by milestone label (case-insensitive match against
 * each ticket's labels array). A ticket carrying two milestone labels counts
 * in both milestones.
 *
 * @param {Array<{label,name,leapsomeUrl}>} configs
 * @param {Object[]} tickets  normalizeStory output (must include .labels)
 * @returns {Array<{label,name,leapsomeUrl,tickets:Object[]}>}
 */
export function buildMilestoneData(configs, tickets) {
  return (configs || []).map(cfg => {
    const want = cfg.label.toLowerCase();
    const mine = (tickets || []).filter(t =>
      (t.labels || []).some(l => String(l).toLowerCase() === want)
    );
    return { label: cfg.label, name: cfg.name || cfg.label, leapsomeUrl: cfg.leapsomeUrl || null, tickets: mine };
  });
}

/**
 * Ticket-count progress for a milestone (or any ticket list).
 * @returns {{total:number, done:number, inProg:number, open:number, pct:number}}
 */
export function milestoneCounts(tickets) {
  const list   = tickets || [];
  const done   = list.filter(t => t.statusCategory === 'done').length;
  const inProg = list.filter(t => t.statusCategory === 'indeterminate').length;
  const open   = list.filter(t => t.statusCategory === 'new').length;
  const total  = list.length;
  return { total, done, inProg, open, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}
