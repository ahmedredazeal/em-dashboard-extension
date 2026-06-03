/**
 * alerts.js — Pure alert rules engine (no DOM dependencies).
 *
 * Each rule is a function: (state) => Alert | null.
 * Rules are grounded in data the extension actually collects:
 *   state.currentSprint  — stories, committed/completed points, scope, metadata
 *   state.settings       — workingDays, sentry views
 *   state.sentryViews    — [{viewId, label, count}] current issue counts
 *   state.sentryTrendSamples — {viewId: [{date, count}]} last 7 days
 *   state.sprintHistory  — (when populated) for velocity rules
 *   state.supportTickets — (when populated) for SLA rule
 */

import * as metrics from './metrics.js';

function generateAlertId(ruleId) {
  return `${ruleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function mkAlert(ruleId, severity, message, evidenceLink = '#sprint-health') {
  return { id: generateAlertId(ruleId), ruleId, severity, message, evidenceLink,
           createdAt: Date.now(), acknowledged: false };
}

// ── RULE 1: sprint_goal_at_risk (enhanced) ────────────────────────────────
// Uses committed baseline + working-day velocity so the projection matches
// Jira and isn't thrown off by estimate edits or weekend days.
export function sprintGoalAtRisk(state) {
  const sp  = state.currentSprint;
  const wds = state.settings?.ui?.workingDays || [0, 1, 2, 3, 4];
  if (!sp?.committedPoints || !sp.startDate) return null;

  const pred = metrics.committedBurnPrediction(sp, wds);
  if (pred.risk === 'early' || pred.risk === 'no-data' || pred.risk === 'none') return null;

  const severity   = (pred.risk === 'high' || pred.risk === 'goal-missed') ? 'high' : 'medium';
  const riskLabel  = pred.risk === 'high' ? 'HIGH RISK' : 'at risk';
  const netAdded   = Object.values(sp.scopeByDay || {}).reduce((s,sc) => s+(sc.added||0), 0);
  const scopeNote  = netAdded > 0 ? ` (+${netAdded} pts added mid-sprint)` : '';

  return mkAlert('sprint_goal_at_risk', severity,
    `Sprint goal ${riskLabel}: ${sp.name}. Projected ${pred.predicted}/${sp.committedPoints} pts` +
    ` (${pred.shortfall} pt shortfall). Burn: ${pred.dailyVelocity} pts/day,` +
    ` need: ${pred.neededVelocity} pts/day over ${pred.wdRemaining} working days${scopeNote}.`
  );
}

// ── RULE 2: scope_creep ───────────────────────────────────────────────────
// Fires when story points added after sprint start exceed 10 % of commitment.
export function scopeCreep(state) {
  const sp = state.currentSprint;
  if (!sp?.committedPoints || !sp.scopeByDay) return null;

  const netAdded = Object.values(sp.scopeByDay).reduce((s, sc) => s + (sc.added || 0), 0);
  if (netAdded === 0) return null;
  const pct = Math.round(netAdded / sp.committedPoints * 100);
  if (pct < 10) return null;

  return mkAlert('scope_creep', pct >= 20 ? 'high' : 'medium',
    `Scope creep: +${netAdded} pts added to ${sp.name} after kickoff` +
    ` (${pct} % of ${sp.committedPoints} pt commitment). Review with the team.`
  );
}

// ── RULE 3: stalled_burndown ──────────────────────────────────────────────
// Fires when no points were completed on any of the last 2+ working days.
export function stalledBurndown(state) {
  const sp  = state.currentSprint;
  const wds = state.settings?.ui?.workingDays || [0, 1, 2, 3, 4];
  if (!sp?.stories || sp.todayIndex == null || sp.todayIndex < 3) return null;

  // Collect the last 3 working-day indices counting back from today
  const wdSet = new Set(wds);
  const start = new Date(sp.startDate); start.setHours(0, 0, 0, 0);
  const recentWds = [];
  for (let d = sp.todayIndex; d >= 0 && recentWds.length < 3; d--) {
    const date = new Date(start); date.setDate(start.getDate() + d);
    if (wdSet.has(date.getDay())) recentWds.push(d);
  }
  if (recentWds.length < 2) return null;

  const hadWork = sp.stories.some(s =>
    s.closedDay != null && (s.points || 0) > 0 && recentWds.includes(s.closedDay)
  );
  if (hadWork) return null;

  const open = (sp.committedPoints || sp.totalPoints || 0) - (sp.completedPoints || 0);
  return mkAlert('stalled_burndown', recentWds.length >= 3 ? 'high' : 'medium',
    `No points completed in the last ${recentWds.length} working days (${sp.name}).` +
    ` ${open} pts still open — check for blockers.`
  );
}

// ── RULE 4: due_date_risk ─────────────────────────────────────────────────
// Fires when undone stories with due dates on/before sprint end have open points.
export function dueDateRisk(state) {
  const sp = state.currentSprint;
  if (!sp?.stories || !sp.endDate) return null;

  const now       = new Date();
  const sprintEnd = new Date(sp.endDate);
  const atRisk    = sp.stories.filter(s =>
    s.dueDate && s.statusCategory !== 'done' &&
    (s.points || 0) > 0 && new Date(s.dueDate) <= sprintEnd
  );
  if (atRisk.length === 0) return null;

  const pts     = atRisk.reduce((sum, s) => sum + (s.points || 0), 0);
  const overdue = atRisk.filter(s => new Date(s.dueDate) < now);
  const keys    = atRisk.slice(0, 3).map(s => s.key).join(', ');
  const more    = atRisk.length > 3 ? ` +${atRisk.length - 3} more` : '';
  const ovNote  = overdue.length > 0 ? ` (${overdue.length} already past due)` : '';

  return mkAlert('due_date_risk', overdue.length > 0 ? 'high' : 'medium',
    `${atRisk.length} ticket${atRisk.length > 1 ? 's' : ''} (${pts} pts) due by sprint end` +
    ` not yet done${ovNote}: ${keys}${more}.`
  );
}

// ── RULE 5: unassigned_work ───────────────────────────────────────────────
// Fires when open, pointed tickets have no assignee.
export function unassignedWork(state) {
  const sp = state.currentSprint;
  if (!sp?.stories) return null;

  const unassigned = sp.stories.filter(s =>
    !s.assignee && s.statusCategory !== 'done' && (s.points || 0) > 0
  );
  if (unassigned.length === 0) return null;

  const pts  = unassigned.reduce((sum, s) => sum + (s.points || 0), 0);
  const keys = unassigned.slice(0, 3).map(s => s.key).join(', ');
  const more = unassigned.length > 3 ? ` +${unassigned.length - 3} more` : '';

  return mkAlert('unassigned_work', pts >= 8 ? 'high' : 'medium',
    `${unassigned.length} unassigned ticket${unassigned.length > 1 ? 's' : ''}` +
    ` (${pts} pts) in ${sp.name}: ${keys}${more}.`
  );
}

// ── RULE 6: reopened_tickets ──────────────────────────────────────────────
// Fires when tickets that previously reached Done are now open again (rework).
export function reopenedTickets(state) {
  const sp = state.currentSprint;
  if (!sp?.stories) return null;

  const reopened = sp.stories.filter(s =>
    s.closedAt != null && s.statusCategory !== 'done' && (s.points || 0) > 0
  );
  if (reopened.length === 0) return null;

  const pts  = reopened.reduce((sum, s) => sum + (s.points || 0), 0);
  const keys = reopened.slice(0, 3).map(s => `${s.key} (${s.points}pt)`).join(', ');
  const more = reopened.length > 3 ? ` +${reopened.length - 3} more` : '';

  return mkAlert('reopened_tickets', 'medium',
    `${reopened.length} ticket${reopened.length > 1 ? 's' : ''} reopened this sprint` +
    ` (${pts} pts of potential rework): ${keys}${more}. Check for quality or spec issues.`
  );
}

// ── RULE 7: sentry_trend_spike ────────────────────────────────────────────
// Grounded on the Sentry trend-sample data the extension actually collects
// (day-over-day count increase), not per-issue triage state.
export function sentryTrendSpike(state) {
  const views   = state.sentryViews;
  const samples = state.sentryTrendSamples;
  if (!views?.length || !samples) return null;

  const spikes = views
    .map(v => ({ v, spike: metrics.sentryDayOverDaySpike(v.count, samples[v.viewId] || []) }))
    .filter(x => x.spike);
  if (spikes.length === 0) return null;

  const worst   = spikes.reduce((a, b) => b.spike.delta > a.spike.delta ? b : a);
  const details = spikes.map(x => `${x.v.label} +${x.spike.delta}`).join(', ');
  const pctStr  = worst.spike.pctChange != null ? ` (+${worst.spike.pctChange} %)` : '';

  return mkAlert('sentry_trend_spike', worst.spike.delta >= 20 ? 'high' : 'medium',
    `Sentry spike: ${details}. ${worst.v.label} rose from ${worst.spike.prevCount}` +
    ` → ${worst.v.count}${pctStr}. Investigate error trends.`,
    '#reliability'
  );
}

// ── RULE 8: velocity_drop (gated — needs ≥3 sprints history) ─────────────
export function velocityDrop(state) {
  const { sprintHistory } = state;
  if (!sprintHistory || sprintHistory.length < 3) return null;
  if (!metrics.velocityDropped(sprintHistory)) return null;

  const [s1, s2, s3] = sprintHistory.slice(-3);
  return mkAlert('velocity_drop', 'medium',
    `Velocity dropped >15% for 2 consecutive sprints:` +
    ` ${s1.name} (${s1.velocity}) → ${s2.name} (${s2.velocity}) → ${s3.name} (${s3.velocity}).`
  );
}

// ── RULE 9: support_sla_breach (gated — needs supportTickets data) ────────
export function supportSLABreach(state) {
  const { supportTickets, slaHours = 48 } = state;
  if (!supportTickets?.length) return null;  // data not available — skip silently

  const breached = supportTickets.filter(t => {
    const ageH = (Date.now() - new Date(t.createdAt).getTime()) / 3600000;
    return ageH > slaHours && !t.resolved;
  });
  if (breached.length === 0) return null;

  const oldest  = breached.reduce((a, b) => new Date(a.createdAt) < new Date(b.createdAt) ? a : b);
  const ageH    = Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / 3600000);

  return mkAlert('support_sla_breach', 'high',
    `${breached.length} support ticket${breached.length > 1 ? 's' : ''} breached ${slaHours}h SLA.` +
    ` Oldest: "${oldest.summary}" (${ageH}h, ${Math.round(ageH/slaHours*100)}% over SLA).`,
    oldest.url || '#reliability'
  );
}

// ── Run all rules ─────────────────────────────────────────────────────────
export function checkAlerts(state) {
  const rules = [
    sprintGoalAtRisk,
    scopeCreep,
    stalledBurndown,
    dueDateRisk,
    unassignedWork,
    reopenedTickets,
    sentryTrendSpike,
    velocityDrop,
    supportSLABreach,
  ];
  return rules.reduce((acc, rule) => {
    try { const a = rule(state); if (a) acc.push(a); }
    catch (e) { console.warn(`[alerts] Rule ${rule.name} threw:`, e.message); }
    return acc;
  }, []);
}

// ── Merge (dedup by ruleId, newest wins) ─────────────────────────────────
export function mergeAlerts(existingAlerts, newAlerts) {
  const merged = [...existingAlerts];
  for (const a of newAlerts) {
    const idx = merged.findIndex(x => x.ruleId === a.ruleId && !x.acknowledged);
    if (idx !== -1) merged.splice(idx, 1);
    merged.unshift(a);
  }
  return merged.slice(0, 50);
}
