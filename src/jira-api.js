/**
 * jira-api.js
 * Jira REST API v3 client (read-only)
 * Atlassian Cloud API: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 */

export class JiraClient {
  constructor(baseUrl, email, apiToken) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // remove trailing slash
    this.email = email;
    this.apiToken = apiToken;
    this.authHeader = 'Basic ' + btoa(`${email}:${apiToken}`);
  }

  /**
   * Make authenticated request to Jira API
   * @private
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/rest/api/3/${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jira API error (${response.status}): ${error}`);
    }
    
    return response.json();
  }

  /**
   * Test connection (GET /myself)
   * @returns {Promise<Object>} user info
   */
  async testConnection() {
    return this.request('myself');
  }

  /**
   * Get active sprint for a project
   * @param {string} boardId - Jira board ID
   * @returns {Promise<Object>} sprint info
   */
  async getActiveSprint(boardId) {
    const endpoint = `board/${boardId}/sprint?state=active`;
    const result = await this.request(endpoint);
    
    if (!result.values || result.values.length === 0) {
      throw new Error('No active sprint found');
    }
    
    return result.values[0];
  }

  /**
   * Get all stories in a sprint
   * @param {string} sprintId
   * @param {string} projectKey - e.g. 'ATH'
   * @returns {Promise<Array>} issues
   */
  async getSprintStories(sprintId, projectKey) {
    const jql = `project=${projectKey} AND sprint=${sprintId} AND type in (Story, Task, Bug)`;
    const endpoint = `search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,status,assignee,customfield_10016,subtasks,created,updated`;
    
    const result = await this.request(endpoint);
    return result.issues || [];
  }

  /**
   * Get subtasks for a list of parent issues
   * @param {Array<string>} parentKeys - e.g. ['ATH-123', 'ATH-124']
   * @returns {Promise<Array>} subtask issues
   */
  async getSubtasks(parentKeys) {
    if (!parentKeys || parentKeys.length === 0) return [];
    
    const jql = `parent in (${parentKeys.join(',')})`;
    const endpoint = `search?jql=${encodeURIComponent(jql)}&maxResults=500&fields=summary,status,assignee,timetracking,parent`;
    
    const result = await this.request(endpoint);
    return result.issues || [];
  }

  /**
   * Get worklogs for an engineer in a date range
   * @param {string} accountId - Jira account ID
   * @param {Date} from
   * @param {Date} to
   * @returns {Promise<Array>} worklogs
   */
  async getWorklogs(accountId, from, to) {
    // Note: Jira worklog API is paginated and doesn't have a direct date filter
    // This is a simplified implementation for Phase 1
    // Production would need to fetch worklogs per issue and aggregate
    
    const jql = `worklogAuthor=${accountId} AND worklogDate >= "${from.toISOString().split('T')[0]}"`;
    const endpoint = `search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=worklog`;
    
    const result = await this.request(endpoint);
    
    // Flatten worklogs from all issues
    const worklogs = [];
    for (const issue of result.issues || []) {
      if (issue.fields.worklog?.worklogs) {
        worklogs.push(...issue.fields.worklog.worklogs);
      }
    }
    
    return worklogs.filter(log => {
      const logDate = new Date(log.started);
      return logDate >= from && logDate <= to;
    });
  }

  /**
   * Get sprint history (last N sprints)
   * @param {string} boardId
   * @param {number} count - how many sprints to fetch
   * @returns {Promise<Array>} sprint objects
   */
  async getSprintHistory(boardId, count = 5) {
    const endpoint = `board/${boardId}/sprint?state=closed&maxResults=${count}`;
    const result = await this.request(endpoint);
    
    return (result.values || []).reverse(); // oldest first
  }

  /**
   * Get support tickets (issues with specific labels or custom field)
   * @param {string} projectKey
   * @param {string} labelOrField - e.g. 'support' or custom field query
   * @returns {Promise<Array>}
   */
  async getSupportTickets(projectKey, labelOrField = 'support') {
    const jql = `project=${projectKey} AND labels=${labelOrField} AND resolution=Unresolved`;
    const endpoint = `search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,created,updated,assignee,priority`;
    
    const result = await this.request(endpoint);
    return result.issues || [];
  }

  /**
   * Get security tickets (issues with security label)
   * @param {string} projectKey
   * @returns {Promise<Array>}
   */
  async getSecurityTickets(projectKey) {
    const jql = `project=${projectKey} AND labels=security AND resolution=Unresolved`;
    const endpoint = `search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,created,duedate,assignee,priority`;
    
    const result = await this.request(endpoint);
    return result.issues || [];
  }

  /**
   * Check if a ticket is stale (no update in 2+ days)
   * @param {Object} issue - Jira issue object
   * @returns {boolean}
   */
  static isTicketStale(issue) {
    if (!issue.fields.updated) return false;
    
    const lastUpdate = new Date(issue.fields.updated);
    const ageMs = Date.now() - lastUpdate.getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    
    return ageDays > 2;
  }
}

/**
 * Create a JiraClient from stored settings
 * @returns {Promise<JiraClient>}
 */
export async function createClient() {
  const result = await chrome.storage.local.get(['settings']);
  const jiraSettings = result.settings?.jira;
  
  if (!jiraSettings || !jiraSettings.baseUrl || !jiraSettings.email || !jiraSettings.token) {
    throw new Error('Jira credentials not configured');
  }
  
  return new JiraClient(jiraSettings.baseUrl, jiraSettings.email, jiraSettings.token);
}
