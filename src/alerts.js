/**
 * alerts.js
 * Pure alert rules engine (no DOM dependencies)
 * Each rule is a function: (state) => Alert | null
 * Phase 1: 4 highest-value rules
 */

import * as metrics from './metrics.js';

/**
 * Alert object structure
 * @typedef {Object} Alert
 * @property {string} id - unique alert ID
 * @property {string} ruleId - rule that fired
 * @property {string} severity - 'high' | 'medium' | 'low'
 * @property {string} message - human-readable message
 * @property {string} evidenceLink - URL or internal path to evidence
 * @property {number} createdAt - timestamp
 * @property {boolean} acknowledged - user dismissed
 */

/**
 * Generate unique alert ID
 */
function generateAlertId(ruleId) {
  return `${ruleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * RULE: velocity_drop
 * Severity: medium
 * Trigger: Velocity drops >15% for 2 consecutive sprints
 */
export function velocityDrop(state) {
  const { sprintHistory } = state;
  
  if (!sprintHistory || sprintHistory.length < 3) return null;
  
  const dropped = metrics.velocityDropped(sprintHistory);
  
  if (dropped) {
    const recent = sprintHistory.slice(-3);
    const [s1, s2, s3] = recent;
    
    return {
      id: generateAlertId('velocity_drop'),
      ruleId: 'velocity_drop',
      severity: 'medium',
      message: `Velocity dropped >15% for 2 consecutive sprints: ${s1.name} (${s1.velocity}) → ${s2.name} (${s2.velocity}) → ${s3.name} (${s3.velocity}). Root cause analysis required.`,
      evidenceLink: '#sprint-health',
      createdAt: Date.now(),
      acknowledged: false
    };
  }
  
  return null;
}

/**
 * RULE: sprint_goal_at_risk
 * Severity: high
 * Trigger: Mid-sprint burndown trajectory predicts goal miss
 */
export function sprintGoalAtRisk(state) {
  const { currentSprint } = state;
  
  if (!currentSprint || !currentSprint.totalPoints) return null;
  
  const prediction = metrics.sprintBurndownPrediction(currentSprint);
  
  if (prediction.risk === 'high' || prediction.risk === 'medium') {
    const riskLabel = prediction.risk === 'high' ? 'HIGH RISK' : 'at risk';
    
    return {
      id: generateAlertId('sprint_goal_at_risk'),
      ruleId: 'sprint_goal_at_risk',
      severity: prediction.risk === 'high' ? 'high' : 'medium',
      message: `Sprint goal ${riskLabel}: ${currentSprint.name}. Predicted ${prediction.predicted}/${currentSprint.totalPoints} points. Current velocity: ${Math.round(currentSprint.completedPoints / currentSprint.daysElapsed * 10) / 10} pts/day.`,
      evidenceLink: '#sprint-health',
      createdAt: Date.now(),
      acknowledged: false
    };
  }
  
  return null;
}

/**
 * RULE: sentry_spike_untriaged
 * Severity: high
 * Trigger: New Sentry issue, age >24h, no triage
 */
export function sentrySpikeUntriaged(state) {
  const { sentryIssues } = state;
  
  if (!sentryIssues || sentryIssues.length === 0) return null;
  
  // Find all untriaged spikes >24h old
  const untriaged = sentryIssues.filter(issue => metrics.sentryUntriaged(issue));
  
  if (untriaged.length > 0) {
    const oldest = untriaged.reduce((a, b) => 
      new Date(a.createdAt) < new Date(b.createdAt) ? a : b
    );
    
    const ageHours = Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / (60 * 60 * 1000));
    
    return {
      id: generateAlertId('sentry_spike_untriaged'),
      ruleId: 'sentry_spike_untriaged',
      severity: 'high',
      message: `${untriaged.length} Sentry ${untriaged.length === 1 ? 'spike' : 'spikes'} untriaged for >24h. Oldest: "${oldest.title}" (${ageHours}h old). Triage SLA breached.`,
      evidenceLink: oldest.url || '#reliability',
      createdAt: Date.now(),
      acknowledged: false
    };
  }
  
  return null;
}

/**
 * RULE: support_sla_breach
 * Severity: high
 * Trigger: Support ticket aged past agreed SLA
 */
export function supportSLABreach(state) {
  const { supportTickets, slaHours = 48 } = state; // default SLA 48h
  
  if (!supportTickets || supportTickets.length === 0) return null;
  
  const breached = supportTickets.filter(ticket => {
    const ageMs = Date.now() - new Date(ticket.createdAt).getTime();
    const ageHours = ageMs / (60 * 60 * 1000);
    return ageHours > slaHours && !ticket.resolved;
  });
  
  if (breached.length > 0) {
    const oldest = breached.reduce((a, b) => 
      new Date(a.createdAt) < new Date(b.createdAt) ? a : b
    );
    
    const ageHours = Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / (60 * 60 * 1000));
    
    return {
      id: generateAlertId('support_sla_breach'),
      ruleId: 'support_sla_breach',
      severity: 'high',
      message: `${breached.length} support ${breached.length === 1 ? 'ticket' : 'tickets'} breached SLA (${slaHours}h). Oldest: "${oldest.summary}" (${ageHours}h old, ${Math.round(ageHours / slaHours * 100)}% over SLA).`,
      evidenceLink: oldest.url || '#reliability',
      createdAt: Date.now(),
      acknowledged: false
    };
  }
  
  return null;
}

/**
 * Run all Phase 1 alert rules
 * @param {Object} state - current dashboard state
 * @returns {Array<Alert>} array of fired alerts
 */
export function checkAlerts(state) {
  const rules = [
    velocityDrop,
    sprintGoalAtRisk,
    sentrySpikeUntriaged,
    supportSLABreach
  ];
  
  const alerts = [];
  
  for (const rule of rules) {
    const alert = rule(state);
    if (alert) {
      alerts.push(alert);
    }
  }
  
  return alerts;
}

/**
 * Merge new alerts with existing, deduplicating by ruleId
 * (only keep the most recent firing of each rule)
 * @param {Array<Alert>} existingAlerts
 * @param {Array<Alert>} newAlerts
 * @returns {Array<Alert>} merged and deduplicated
 */
export function mergeAlerts(existingAlerts, newAlerts) {
  const merged = [...existingAlerts];
  
  for (const newAlert of newAlerts) {
    // Remove any existing alert with the same ruleId (keep newest)
    const index = merged.findIndex(a => a.ruleId === newAlert.ruleId && !a.acknowledged);
    if (index !== -1) {
      merged.splice(index, 1);
    }
    merged.unshift(newAlert); // newest first
  }
  
  // Limit to 50 alerts total (oldest dropped)
  return merged.slice(0, 50);
}
