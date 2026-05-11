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
   * The old GET /rest/api/3/search is deprecated.
   */
  async _search(body) {
    const url = `${this.baseUrl}/rest/api/3/search/jql`;
    console.log(`[jira] POST /rest/api/3/search/jql`, body.jql);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body)
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
  async getSprintStories(sprintId, projectKey, storyPointsField = 'customfield_10016') {
    const jql = `project = ${projectKey} AND sprint = ${sprintId} AND issuetype not in subTaskIssueTypes() ORDER BY rank ASC`;
    console.log(`[jira] Fetching stories: ${jql}`);
    
    const result = await this._search({
      jql,
      fields: [
        'summary', 'status', 'assignee', 'issuetype', 'priority',
        storyPointsField,
        'customfield_10016', // Always include common defaults too
        'customfield_10026',
        'subtasks', 'created', 'updated'
      ],
      maxResults: 100
    });
    
    console.log(`[jira] Found ${result.issues?.length || 0} stories in sprint`);
    return result.issues || [];
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
