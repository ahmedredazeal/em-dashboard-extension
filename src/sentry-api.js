/**
 * sentry-api.js
 * Sentry REST API client (read-only)
 * API docs: https://docs.sentry.io/api/
 */

export class SentryClient {
  constructor(baseUrl, orgSlug, projectSlug, token) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // remove trailing slash
    this.orgSlug = orgSlug;
    this.projectSlug = projectSlug;
    this.token = token;
  }

  /**
   * Make authenticated request to Sentry API
   * @private
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/api/0/${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Sentry API error (${response.status}): ${error}`);
    }
    
    return response.json();
  }

  /**
   * Test connection (GET /organizations/{org}/)
   * @returns {Promise<Object>} org info
   */
  async testConnection() {
    return this.request(`organizations/${this.orgSlug}/`);
  }

  /**
   * Get unresolved issues for the project
   * @param {number} limit - max results (default 100)
   * @returns {Promise<Array>} issues
   */
  async getUnresolvedIssues(limit = 100) {
    const endpoint = `projects/${this.orgSlug}/${this.projectSlug}/issues/?query=is:unresolved&limit=${limit}`;
    return this.request(endpoint);
  }

  /**
   * Get issues from the last N days
   * @param {number} days - rolling window
   * @returns {Promise<Array>} issues
   */
  async getRecentIssues(days = 7) {
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceStr = sinceDate.toISOString();
    
    const endpoint = `projects/${this.orgSlug}/${this.projectSlug}/issues/?query=firstSeen:>=${sinceStr}&limit=100`;
    return this.request(endpoint);
  }

  /**
   * Get issue statistics
   * @returns {Promise<Object>} stats
   */
  async getIssueStats() {
    const endpoint = `projects/${this.orgSlug}/${this.projectSlug}/stats/`;
    return this.request(endpoint);
  }

  /**
   * Check if an issue is triaged
   * In Sentry, "triaged" means it has been assigned or has activity
   * @param {Object} issue - Sentry issue object
   * @returns {boolean}
   */
  static isTriaged(issue) {
    // Consider triaged if:
    // - Assigned to someone
    // - Has a status set (e.g., 'resolved', 'ignored')
    // - Has comments/activity
    return !!(
      issue.assignedTo ||
      issue.status !== 'unresolved' ||
      (issue.numComments && issue.numComments > 0)
    );
  }

  /**
   * Check if issue is a recent spike (created <24h ago, not triaged)
   * @param {Object} issue
   * @returns {boolean}
   */
  static isRecentSpike(issue) {
    const createdAt = new Date(issue.firstSeen);
    const ageHours = (Date.now() - createdAt.getTime()) / (60 * 60 * 1000);
    
    return ageHours < 24 && !SentryClient.isTriaged(issue);
  }

  /**
   * Get untriaged spikes older than 24h
   * @returns {Promise<Array>}
   */
  async getUntriagedSpikes() {
    const issues = await this.getUnresolvedIssues();
    
    return issues.filter(issue => {
      const createdAt = new Date(issue.firstSeen);
      const ageHours = (Date.now() - createdAt.getTime()) / (60 * 60 * 1000);
      
      return ageHours > 24 && !SentryClient.isTriaged(issue);
    });
  }

  /**
   * Get 7-day error trend (count of unresolved issues)
   * @returns {Promise<number>}
   */
  async getSevenDayErrorCount() {
    const issues = await this.getRecentIssues(7);
    return issues.filter(issue => issue.status === 'unresolved').length;
  }
}

/**
 * Create a SentryClient from stored settings
 * @returns {Promise<SentryClient>}
 */
export async function createClient() {
  const result = await chrome.storage.local.get(['settings']);
  const sentrySettings = result.settings?.sentry;
  
  if (!sentrySettings || !sentrySettings.baseUrl || !sentrySettings.org || !sentrySettings.project || !sentrySettings.token) {
    throw new Error('Sentry credentials not configured');
  }
  
  return new SentryClient(
    sentrySettings.baseUrl,
    sentrySettings.org,
    sentrySettings.project,
    sentrySettings.token
  );
}
