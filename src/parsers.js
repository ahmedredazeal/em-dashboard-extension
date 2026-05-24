/**
 * src/parsers.js
 * Pure parsing functions — no side effects, no DOM, no chrome.*
 * Imported by background.js and exercised by tests/parsers.test.js
 */

/**
 * Parse one extra board spec into a normalized {label, id} pair.
 * Handles 3 input shapes (the same data has been stored 3 different ways
 * across versions, so we accept all of them):
 *   - {name: "Support", id: 123}     → modern object form
 *   - "Support|123"                  → user typed in textarea
 *   - "123"                          → bare ID
 * Returns { label, id } or null if id is not a valid number.
 */
export function parseExtraBoardSpec(spec) {
  if (spec == null) return null;
  
  // Object form (already parsed by settings.js)
  if (typeof spec === 'object' && !Array.isArray(spec)) {
    const id = Number(spec.id);
    if (!Number.isFinite(id)) return null;
    return { label: spec.name || `Board ${id}`, id };
  }
  
  // String form
  const s = String(spec).trim();
  if (!s) return null;
  
  if (s.includes('|')) {
    const [name, idStr] = s.split('|').map(p => p.trim());
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) return null;
    return { label: name || `Board ${id}`, id };
  }
  
  const id = parseInt(s, 10);
  if (!Number.isFinite(id)) return null;
  return { label: `Board ${id}`, id };
}

/**
 * Parse the raw textarea value from settings into an array of {name, id}
 * objects ready to be persisted to chrome.storage.
 */
export function parseExtraBoardsTextarea(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => parseExtraBoardSpec(line))
    .filter(b => b !== null)
    .map(b => ({ name: b.label, id: b.id }));
}

/**
 * Parse one Sentry view spec into { label, viewId, projectIds }.
 * Accepts:
 *   - {label, viewId, projectIds}              → modern object
 *   - "Label|viewId|p1,p2,p3"                  → textarea
 *   - "Label|viewId"                           → no project filter
 *   - "viewId"                                 → bare id, no label
 */
export function parseSentryViewSpec(spec) {
  if (spec == null) return null;
  
  if (typeof spec === 'object' && !Array.isArray(spec)) {
    if (!spec.viewId) return null;
    return {
      label: spec.label || `View ${spec.viewId}`,
      viewId: String(spec.viewId),
      projectIds: Array.isArray(spec.projectIds) ? spec.projectIds.map(String) : []
    };
  }
  
  const s = String(spec).trim();
  if (!s) return null;
  
  const parts = s.split('|').map(p => p.trim());
  if (parts.length === 1) {
    return { label: `View ${parts[0]}`, viewId: parts[0], projectIds: [] };
  }
  
  const [label, viewId, projectsCsv] = parts;
  if (!viewId) return null;
  
  const projectIds = projectsCsv
    ? projectsCsv.split(',').map(p => p.trim()).filter(Boolean)
    : [];
  
  return { label: label || `View ${viewId}`, viewId, projectIds };
}

/**
 * Get the first numeric story-points value from a Jira issue using a list
 * of candidate field names in priority order.
 */
export function getStoryPoints(issue, fieldCandidates) {
  if (!issue || !issue.fields) return 0;
  for (const field of fieldCandidates) {
    const v = issue.fields[field];
    if (typeof v === 'number' && v >= 0) return v;
  }
  return 0;
}

/**
 * Normalize a Jira issue into the trimmed story shape the popup renders.
 */
export function normalizeStory(issue, storyPointsField) {
  const fields = issue.fields || {};
  const fallbacks = [storyPointsField, 'customfield_10016', 'customfield_10026', 'customfield_10004'];
  const priority = fields.priority?.name || 'Medium';
  
  // Log unexpected priority names so we can add them to the mapping
  const knownPriorities = ['highest','critical','high','medium','low','lowest'];
  if (priority !== 'Medium' && !knownPriorities.includes(priority.toLowerCase())) {
    console.log(`[parsers] Unknown priority: "${priority}" on ${issue.key}`);
  }
  
  return {
    key: issue.key,
    summary: fields.summary || '',
    status: fields.status?.name || '',
    statusCategory: fields.status?.statusCategory?.key || '',
    assignee: fields.assignee?.displayName || null,
    assigneeAccountId: fields.assignee?.accountId || null,
    priority,
    points: getStoryPoints(issue, fallbacks),
    type: fields.issuetype?.name || 'Story',
    dueDate: fields.duedate || null,
    labels: Array.isArray(fields.labels) ? fields.labels : []
  };
}

/**
 * Determine if a story is "done" — covers multiple status conventions.
 */
export function isStoryDone(story) {
  const cat = story.fields?.status?.statusCategory?.key || '';
  const name = (story.fields?.status?.name || '').toLowerCase();
  return cat === 'done' || ['done', 'closed', 'resolved'].includes(name);
}

/**
 * Parse a Sentry view URL into its components.
 * Example URL:
 *   https://zeal.sentry.io/issues/views/205220/?environment=production
 *     &project=6042935&project=6163086&query=is%3Aunresolved&sort=date&statsPeriod=7d
 *
 * Returns null if the URL cannot be parsed as a Sentry view URL.
 * Otherwise returns:
 *   {
 *     baseUrl:     "https://zeal.sentry.io",
 *     orgSlug:     "zeal",
 *     viewId:      "205220",
 *     projectIds:  ["6042935", "6163086"],   // empty array if not specified
 *     environment: "production" | null,
 *     query:       "is:unresolved" | null,
 *     sort:        "date" | null,
 *     statsPeriod: "7d" | null
 *   }
 *
 * @param {string} url
 * @returns {Object | null}
 */
export function parseSentryUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  
  // Must be sentry.io domain (zeal.sentry.io, foo.sentry.io, or sentry.io directly)
  if (!u.hostname.endsWith('sentry.io')) return null;
  
  // Path must match /issues/views/<viewId>/?... — viewId is digits
  // Allow optional trailing slash; allow extra path segments after viewId
  const match = u.pathname.match(/^\/issues\/views\/(\d+)(?:\/|$)/);
  if (!match) return null;
  
  const viewId = match[1];
  
  // Extract repeated project= params
  const projectIds = u.searchParams.getAll('project');
  
  // Derive org slug from subdomain (zeal.sentry.io → "zeal", sentry.io → null)
  const hostParts = u.hostname.split('.');
  const orgSlug = hostParts.length >= 3 ? hostParts[0] : null;
  
  return {
    baseUrl:     `${u.protocol}//${u.hostname}`,
    orgSlug,
    viewId,
    projectIds,
    environment: u.searchParams.get('environment'),
    query:       u.searchParams.get('query'),
    sort:        u.searchParams.get('sort'),
    statsPeriod: u.searchParams.get('statsPeriod'),
  };
}
