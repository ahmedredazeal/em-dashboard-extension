/**
 * jira-api.js
 * Jira REST API v3 + Agile API v1.0 client (read-only)
 * 
 * IMPORTANT: Boards and sprints are in the Agile API (/rest/agile/1.0/),
 * NOT the regular REST API (/rest/api/3/).
 */

export class JiraClient {
  constructor(baseUrl, email, apiToken) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.email = email;
    this.apiToken = apiToken;
    this.authHeader = 'Basic ' + btoa(`${email}:${apiToken}`);
    this.headers = {
      'Authorization': this.authHeader,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }

  /**
   * GET request to any Jira API path
   */
  async _get(path) {
    const url = `${this.baseUrl}${path}`;
    console.log(`[jira] GET ${path}`);
    
    const response = await fetch(url, { headers: this.headers });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Jira API ${response.status}: ${response.statusText} — ${path}${text ? ' — ' + text.slice(0, 200) : ''}`);
    }
    
    return response.json();
  }

  /**
   * Search using new JQL endpoint (POST /rest/api/3/search/jql)
   * NOTE: 'expand' must be a query-string param, NOT in the POST body.
   */
  async _search(body) {
    // Pull expand out of body and move to URL param (Jira ignores it in body)
    const { expand, ...cleanBody } = body;
    let url = `${this.baseUrl}/rest/api/3/search/jql`;
    if (expand && expand.length > 0) {
      url += `?expand=${Array.isArray(expand) ? expand.join(',') : expand}`;
    }
    console.log(`[jira] POST /rest/api/3/search/jql${expand ? '?expand=' + expand : ''}`, cleanBody.jql);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(cleanBody)
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Jira API ${response.status}: ${response.statusText} — /rest/api/3/search/jql${text ? ' — ' + text.slice(0, 200) : ''}`);
    }
    
    return response.json();
  }

  /**
   * Legacy request method - kept for backwards compatibility with testConnection
   */
  async request(endpoint, options = {}) {
    return this._get(`/rest/api/3/${endpoint}`);
  }

  /**
   * Test connection (GET /myself)
   */
  async testConnection() {
    return this._get('/rest/api/3/myself');
  }

  /**
   * Fetch the authenticated user's profile (accountId + displayName).
   * Used to seed the engineer "me" scope for role-based views.
   */
  async getCurrentUser() {
    const data = await this._get('/rest/api/3/myself');
    return {
      accountId:    data.accountId    || '',
      displayName:  data.displayName  || '',
      emailAddress: data.emailAddress || ''
    };
  }

  /**
   * Find the board for a project key
   * Returns the first scrum board found (prefers scrum over kanban)
   * @param {string} projectKey - e.g. 'HRM'
   * @returns {Promise<Object>} board info
   */
  async findBoardForProject(projectKey) {
    console.log(`[jira] Finding board for project: ${projectKey}`);
    
    const boardData = await this._get(
      `/rest/agile/1.0/board?projectKeyOrId=${projectKey}&maxResults=10`
    );
    
    const boards = boardData.values || [];
    if (!boards.length) {
      throw new Error(`No board found for project ${projectKey}. Make sure the project has a board in Jira.`);
    }
    
    // Prefer scrum boards (which have sprints)
    const board = boards.find(b => b.type === 'scrum') || boards[0];
    console.log(`[jira] Found board: ${board.name} (id=${board.id}, type=${board.type})`);
    
    return board;
  }

  /**
   * Get active sprint for a board
   * Uses the Agile API (NOT the regular REST API)
   * @param {string|number} boardId
   * @returns {Promise<Object>} sprint info
   */
  async getActiveSprint(boardId) {
    console.log(`[jira] Fetching active sprint for board ${boardId}`);
    
    const result = await this._get(
      `/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=10`
    );
    
    if (!result.values || result.values.length === 0) {
      throw new Error(`No active sprint found for board ${boardId}`);
    }
    
    console.log(`[jira] Found ${result.values.length} active sprint(s):`, result.values.map(s => s.name));
    return result.values[0];
  }

  /**
   * Get board configuration to find the story points field
   * Uses GET /rest/agile/1.0/board/{boardId}/configuration
   * The estimation field in board config tells us which custom field = story points
   */
  async getBoardConfiguration(boardId) {
    console.log(`[jira] Fetching board configuration for board ${boardId}`);
    const config = await this._get(`/rest/agile/1.0/board/${boardId}/configuration`);
    
    const estimationField = config.estimation?.field?.fieldId || null;
    console.log(`[jira] Board estimation field: ${estimationField}`);
    
    return { estimationField, config };
  }

  /**
   * Find the story points (estimation) field for a board
   * Returns the field ID (e.g. "customfield_10016")
   */
  async getStoryPointsField(boardId) {
    try {
      const { estimationField } = await this.getBoardConfiguration(boardId);
      if (estimationField) return estimationField;
    } catch (err) {
      console.warn('[jira] Could not get board config, trying common field names:', err.message);
    }
    
    // Fallback: search /rest/api/3/field for "story points" by name
    try {
      const fields = await this._get('/rest/api/3/field');
      const storyPointsField = fields.find(f => 
        f.name?.toLowerCase().includes('story point') ||
        f.name?.toLowerCase() === 'story points' ||
        f.clauseNames?.some(c => c.toLowerCase().includes('storypoints'))
      );
      if (storyPointsField) {
        console.log(`[jira] Found story points field: ${storyPointsField.id} (${storyPointsField.name})`);
        return storyPointsField.id;
      }
    } catch (err) {
      console.warn('[jira] Could not search fields:', err.message);
    }
    
    // Last resort: common defaults
    return 'customfield_10016';
  }

  /**
   * Get issues currently on a Kanban board.
   * Uses POST /rest/api/3/search/jql with board= JQL instead of the Agile
   * board issue endpoint, because the Agile endpoint doesn't reliably return
   * all fields (priority in particular is often missing).
   * @param {string|number} boardId
   * @param {string} storyPointsField
   * @returns {Promise<Array>}
   */
  /**
   * Get issues on a Kanban board using the board's own filter JQL.
   * This is the reliable approach for Jira Cloud — gets the board's filter,
   * then searches with full field list so priority is always returned.
   */
  /**
   * Fetch worklogs for a list of team members across ALL projects.
   * Uses a single POST search with embedded worklogs — no per-issue fetches.
   *
   * @param {string[]} accountIds  Jira account IDs of team members
   * @param {string}   startDate   "YYYY-MM-DD"
   * @param {string}   endDate     "YYYY-MM-DD"
   * @returns {Promise<Object[]>}  Raw Jira issue objects (with worklog embedded)
   */
  async getTeamWorklogs(accountIds, startDate, endDate) {
    if (!accountIds || accountIds.length === 0) {
      console.warn('[jira] getTeamWorklogs: no accountIds provided');
      return [];
    }
    
    const authorList = accountIds.map(id => `"${id}"`).join(',');
    const jql = `worklogAuthor in (${authorList}) AND worklogDate >= "${startDate}" AND worklogDate <= "${endDate}"`;
    console.log(`[jira] getTeamWorklogs ${startDate}→${endDate} for ${accountIds.length} members`);
    return this._fetchWorklogIssues(jql, startDate, endDate);
  }

  /**
   * Fetch ALL worklogs on a project's issues within a date range, for EVERY
   * author (no author restriction). Used by the quarter / team-time view so
   * engineers who logged time during the period show up even if they were not
   * part of the current sprint.
   * @param {string} projectKey e.g. 'HRM'
   * @param {string} startDate  YYYY-MM-DD
   * @param {string} endDate    YYYY-MM-DD
   */
  async getProjectWorklogs(projectKey, startDate, endDate) {
    if (!projectKey) {
      console.warn('[jira] getProjectWorklogs: no projectKey provided');
      return [];
    }
    const jql = `project = "${projectKey}" AND worklogDate >= "${startDate}" AND worklogDate <= "${endDate}"`;
    console.log(`[jira] getProjectWorklogs ${projectKey} ${startDate}→${endDate}`);
    return this._fetchWorklogIssues(jql, startDate, endDate);
  }

  /**
   * Shared worklog-issue fetch (used by getTeamWorklogs + getProjectWorklogs):
   * cursor pagination plus a backfill pass for issues whose embedded worklog
   * list Jira truncates to ≤20 (common over long date ranges like a quarter).
   */
  async _fetchWorklogIssues(jql, startDate, endDate) {
    const fields = ['worklog', 'project', 'issuetype', 'priority', 'timeoriginalestimate', 'summary'];

    // /rest/api/3/search/jql uses cursor-based pagination (nextPageToken), NOT startAt
    const allIssues = [];
    let nextPageToken = undefined;

    while (allIssues.length < 2000) {
      const body = { jql, fields, maxResults: 100 };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const result = await this._search(body);
      const issues = result.issues || [];
      allIssues.push(...issues);

      if (!result.nextPageToken || issues.length === 0) break;
      nextPageToken = result.nextPageToken;
    }
    console.log(`[jira] _fetchWorklogIssues: ${allIssues.length} issues fetched`);

    // Jira embeds only the most-recent worklogs per issue (≤20, date-descending).
    // For historical quarters, those top-20 are often post-range — fetch full list.
    const startMs = new Date(startDate).getTime();
    const endMs   = new Date(endDate).getTime() + 86400000; // +1 day inclusive
    const truncated = allIssues.filter(i => {
      const wl = i.fields?.worklog;
      return wl && wl.total > (wl.worklogs?.length || 0);
    });

    if (truncated.length > 0) {
      console.log(`[jira] Fetching full worklogs for ${truncated.length} truncated issues`);
      for (let i = 0; i < truncated.length; i += 10) {
        await Promise.all(truncated.slice(i, i + 10).map(async issue => {
          try {
            const full = await this._get(
              `/rest/api/3/issue/${issue.id}/worklog?startedAfter=${startMs}&startedBefore=${endMs}&maxResults=5000`
            );
            issue.fields.worklog.worklogs = full.worklogs || [];
          } catch (e) {
            console.warn(`[jira] Failed full worklog fetch for ${issue.id}:`, e.message);
          }
        }));
      }
    }

    return allIssues;
  }

  /**
   * Get Kanban board issues via the board's own filter
   * @param {number|string} boardId
   * @param {string} storyPointsField
   * @param {Object} opts
   * @param {boolean} opts.excludeClosed - if true, appends statusCategory != Done
   * @returns {Promise<Array>}
   */
  async getKanbanBoardIssues(boardId, storyPointsField = 'customfield_10016', opts = {}) {
    console.log(`[jira] Fetching Kanban board ${boardId} via board filter${opts.excludeClosed ? ' (excluding closed)' : ''}`);

    // Get board details including filter id
    const board = await this._get(`/rest/agile/1.0/board/${boardId}`);
    const filterId = board.filter?.id;

    let jql;
    if (filterId) {
      // Get the board's filter JQL — most accurate
      const filter = await this._get(`/rest/api/3/filter/${filterId}`);
      jql = filter.jql;
      console.log(`[jira] Board ${boardId} filter JQL: ${jql}`);
    } else {
      // Fallback: use board location project key
      const projectKey = board.location?.projectKey;
      if (!projectKey) throw new Error(`Board ${boardId} has no filter or project key`);
      jql = `project = ${projectKey}`;
    }

    // Append closed filter at API level for support boards.
    // We exclude only status = "Closed" (not the entire Done category) so that
    // QA Accepted tickets — which sit in statusCategory=done but are about
    // to ship — still appear in the support list and count toward progress.
    const finalJql = opts.excludeClosed
      ? `(${jql}) AND status != "Closed" ORDER BY created DESC`
      : `(${jql}) ORDER BY created DESC`;

    const result = await this._search({
      jql: finalJql,
      fields: [
        'summary', 'status', 'assignee', 'issuetype', 'priority',
        storyPointsField, 'customfield_10016', 'customfield_10026',
        'duedate', 'labels'
      ],
      maxResults: 100
    });

    console.log(`[jira] Kanban board ${boardId}: ${result.issues?.length || 0} issues`);
    return result.issues || [];
  }

  /**
   * Get active sprint by project key (auto-discovers board)
   * @param {string} projectKey
   * @returns {Promise<Object>} sprint with boardId/boardName attached
   */
  async getActiveSprintByProject(projectKey) {
    const board = await this.findBoardForProject(projectKey);
    const sprint = await this.getActiveSprint(board.id);
    sprint.boardId = board.id;
    sprint.boardName = board.name;
    return sprint;
  }

  /**
   * Get all stories in a sprint
   * @param {string|number} sprintId
   * @param {string} projectKey
   * @param {string} storyPointsField - detected field ID e.g. "customfield_10016"
   * @returns {Promise<Array>}
   */
  /**
   * Get all stories in a sprint.
   * @param {string|number} sprintId
   * @param {string} projectKey
   * @param {string} storyPointsField
   * @param {Object} options
   * @param {boolean} [options.withChangelog=false] - Include expand=changelog (for burndown actual)
   * @param {boolean} [options.withWorklogs=false]  - Include worklog field (for timesheet)
   * @returns {Promise<Array>}
   */
  async getSprintStories(sprintId, projectKey, storyPointsField = 'customfield_10016', options = {}) {
    const { withChangelog = false, withWorklogs = false } = options;
    const jql = `project = ${projectKey} AND sprint = ${sprintId} AND issuetype not in subTaskIssueTypes() ORDER BY rank ASC`;
    console.log(`[jira] Fetching stories: ${jql} (changelog=${withChangelog}, worklogs=${withWorklogs})`);
    
    const fields = [
      'summary', 'status', 'assignee', 'issuetype', 'priority',
      storyPointsField,
      'customfield_10016',
      'customfield_10026',
      'subtasks', 'created', 'updated',
      'duedate', 'startDate', 'customfield_10015', 'rank',
      'labels'
    ];
    if (withWorklogs) fields.push('worklog');
    
    const body = { jql, fields, maxResults: 100 };
    if (withChangelog) body.expand = ['changelog'];
    
    const result = await this._search(body);
    console.log(`[jira] Found ${result.issues?.length || 0} stories in sprint`);
    return result.issues || [];
  }

  /**
   * Get the SUBTASKS in a sprint — used by the Gantt only (kept separate from
   * getSprintStories so subtask points never double-count into the burndown).
   * @param {number} sprintId
   * @param {string} projectKey
   * @param {string} storyPointsField
   * @returns {Promise<Array>}
   */
  async getSprintSubtasks(sprintId, projectKey, storyPointsField = 'customfield_10016') {
    const jql = `project = ${projectKey} AND sprint = ${sprintId} AND issuetype in subTaskIssueTypes() ORDER BY rank ASC`;
    const fields = [
      'summary', 'status', 'assignee', 'issuetype', 'priority',
      storyPointsField, 'customfield_10016', 'customfield_10026',
      'parent', 'created', 'updated',
      'duedate', 'startDate', 'customfield_10015', 'rank',
      'labels'
    ];
    const result = await this._search({ jql, fields, maxResults: 100 });
    console.log(`[jira] Found ${result.issues?.length || 0} subtasks in sprint`);
    return result.issues || [];
  }

  /**
   * Get ALL worklogs logged during a sprint period — including subtasks.
   * Uses JQL worklogDate filter: one search call covers all issue types.
   *
   * This is the correct approach when team members log time on subtasks
   * (e.g. "[FE] Implementation") rather than parent stories, since
   * subtasks may not be directly assigned to the sprint.
   *
   * @param {string} projectKey
   * @param {string} sprintStartDate - ISO date string
   * @param {string} sprintEndDate   - ISO date string
   * @returns {Promise<Array>} flat array of worklog objects
   */
  async getSprintWorklogs(projectKey, sprintStartDate, sprintEndDate) {
    const start = new Date(sprintStartDate).toISOString().slice(0, 10);
    const end   = new Date(sprintEndDate).toISOString().slice(0, 10);
    const jql   = `project = ${projectKey} AND worklogDate >= "${start}" AND worklogDate <= "${end}"`;
    
    console.log(`[jira] Fetching sprint worklogs: ${jql}`);
    
    const result = await this._search({
      jql,
      fields: ['summary', 'worklog', 'issuetype'],
      maxResults: 200
    });
    
    const issues = result.issues || [];
    console.log(`[jira] ${issues.length} issues have worklogs in sprint period`);
    
    // Collect inline worklogs, flag issues needing a full fetch (>20 worklogs)
    const allWorklogs = [];
    const needsFullFetch = [];
    
    for (const issue of issues) {
      const wl = issue.fields?.worklog;
      if (!wl) continue;
      allWorklogs.push(...(wl.worklogs || []));
      if (wl.total > (wl.maxResults || 20)) {
        needsFullFetch.push(issue.key);
      }
    }
    
    // Rare: individual fetch only for issues with >20 worklogs
    if (needsFullFetch.length > 0) {
      console.log(`[jira] Full worklog fetch needed for ${needsFullFetch.length} issue(s)`);
      const extras = await Promise.allSettled(needsFullFetch.map(k => this.getIssueWorklogs(k)));
      for (const r of extras) {
        if (r.status === 'fulfilled') allWorklogs.push(...r.value);
      }
    }
    
    console.log(`[jira] Total worklogs collected: ${allWorklogs.length}`);
    return allWorklogs;
  }

  /**
   * Get full worklog list for a single issue (fallback for >20 worklogs).
   * @param {string} issueKey
   * @returns {Promise<Array>}
   */
  async getIssueWorklogs(issueKey) {
    console.log(`[jira] Fetching full worklogs for ${issueKey}`);
    const result = await this._get(`/rest/api/3/issue/${issueKey}/worklog`);
    return result.worklogs || [];
  }

  /**
   * Get sprint history (last N closed sprints)
   */
  async getSprintHistory(boardId, limit = 5) {
    console.log(`[jira] Fetching last ${limit} closed sprints for board ${boardId}`);
    
    const result = await this._get(
      `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=${limit}`
    );
    
    return (result.values || []).slice(-limit);
  }

  /**
   * Get the MOST RECENT N closed sprints, sorted ascending by start date.
   * The Agile sprint endpoint returns sprints oldest-first; a naive
   * maxResults=N grabs the EARLIEST closed sprints, not the latest. This pages
   * to the end (isLast) and returns the last N — used by the bug-reports trend,
   * which must bucket against recent sprint windows. (T-BR-1 fix.)
   * @param {number|string} boardId
   * @param {number} limit
   * @returns {Promise<Array>} recent closed sprints, oldest→newest among the N
   */
  async getRecentClosedSprints(boardId, limit = 6) {
    const PAGE = 50;
    let startAt = 0, all = [], isLast = false, guard = 0;
    while (!isLast && guard < 20) {
      const result = await this._get(
        `/rest/agile/1.0/board/${boardId}/sprint?state=closed&startAt=${startAt}&maxResults=${PAGE}`
      );
      const values = result.values || [];
      all = all.concat(values);
      isLast = result.isLast === true || values.length < PAGE;
      startAt += PAGE;
      guard++;
    }
    // Sort by startDate ascending; fall back to id for sprints missing a date.
    all.sort((a, b) => {
      const da = a.startDate ? new Date(a.startDate).getTime() : 0;
      const db = b.startDate ? new Date(b.startDate).getTime() : 0;
      if (da !== db) return da - db;
      return (a.id || 0) - (b.id || 0);
    });
    const recent = all.slice(-limit);
    console.log(`[jira] Recent closed sprints: ${all.length} total, returning last ${recent.length}`);
    return recent;
  }

  /**
   * Find a custom field's id by its display name (case-insensitive exact match,
   * then a contains fallback). Caches per client instance. Used to resolve
   * fields like "App Name" without hardcoding a customfield id. (T-BR-1 ph2.)
   * @param {string} name  e.g. "App Name"
   * @returns {Promise<string|null>} customfield id or null if not found
   */
  async findFieldIdByName(name) {
    this._fieldCache = this._fieldCache || null;
    const want = String(name || '').toLowerCase().trim();
    if (!want) return null;
    try {
      if (!this._fieldCache) this._fieldCache = await this._get('/rest/api/3/field');
      const fields = this._fieldCache || [];
      const exact = fields.find(f => (f.name || '').toLowerCase().trim() === want);
      const hit = exact || fields.find(f => (f.name || '').toLowerCase().includes(want));
      if (hit) {
        console.log(`[jira] Resolved field "${name}" → ${hit.id}`);
        return hit.id;
      }
      console.warn(`[jira] Field "${name}" not found among ${fields.length} fields`);
      return null;
    } catch (err) {
      console.warn(`[jira] Field lookup for "${name}" failed:`, err.message);
      return null;
    }
  }

  /**
   * Get bugs for a project (T-BR-1). Bug = issue type Bug or QA Bug.
   * @param {string} projectKey
   * @param {Object} [opts]
   * @param {string} [opts.assigneeAccountId]  if set, restrict to this assignee ("my bugs")
   * @param {string} [opts.createdAfter]  optional JQL date floor (e.g. '2026-01-01') to cap volume
   * @returns {Promise<Array>} raw Jira issues (fields: created, resolutiondate, status, priority, assignee, issuetype, summary)
   */
  async getBugs(projectKey, opts = {}) {
    let jql = `project = "${projectKey}" AND issuetype in ("Bug", "QA Bug")`;
    if (opts.assigneeAccountId) jql += ` AND assignee = "${opts.assigneeAccountId}"`;
    if (opts.createdAfter) jql += ` AND created >= "${opts.createdAfter}"`;
    jql += ' ORDER BY created DESC';
    console.log(`[jira] Fetching bugs: ${jql}`);
    const fields = ['summary', 'status', 'priority', 'assignee', 'issuetype', 'created', 'resolutiondate', 'components'];
    // App Name (or any extra grouping field) — resolved by name elsewhere and passed in.
    if (opts.appNameFieldId) fields.push(opts.appNameFieldId);
    try {
      const body = {
        jql,
        fields,
        maxResults: 200,
      };
      // changelog needed for reopen detection (Done → not-Done transitions).
      if (opts.withChangelog) body.expand = 'changelog';
      const result = await this._search(body);
      return result.issues || [];
    } catch (err) {
      console.warn('[jira] Bug fetch failed (non-fatal):', err.message);
      return [];
    }
  }

  /**
   * Get support tickets for a project
   */
  async getSupportTickets(projectKey) {
    const jql = `project = ${projectKey} AND type = "Support Ticket" AND status != Done`;
    console.log(`[jira] Fetching support tickets: ${jql}`);
    
    try {
      const result = await this._search({
        jql,
        fields: ['summary', 'status', 'priority', 'created', 'updated'],
        maxResults: 50
      });
      return result.issues || [];
    } catch (err) {
      console.warn(`[jira] No support tickets found (may not be configured):`, err.message);
      return [];
    }
  }
}

/**
 * Create a JiraClient from stored settings
 */
export async function createClient() {
  const result = await chrome.storage.local.get(['settings']);
  const jiraSettings = result.settings?.jira;
  
  if (!jiraSettings || !jiraSettings.baseUrl || !jiraSettings.email || !jiraSettings.token) {
    throw new Error('Jira credentials not configured');
  }
  
  return new JiraClient(jiraSettings.baseUrl, jiraSettings.email, jiraSettings.token);
}
