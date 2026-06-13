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
import { isEarlySprint } from './metrics.js';

function generateAlertId(ruleId) {
  return `${ruleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Build an alert.
 * @param {string} ruleId
 * @param {string} severity   'high' | 'medium' | 'low'
 * @param {string} message    one-line summary shown in the compact header
 * @param {Object} [extra]
 * @param {string} [extra.evidenceLink]  in-app anchor (default #sprint-health)
 * @param {string} [extra.detail]        longer description shown when expanded
 * @param {string[]} [extra.bullets]     bullet lines shown when expanded
 * @param {string[]} [extra.tickets]     Jira keys → rendered as clickable links
 */
function mkAlert(ruleId, severity, message, extra = {}) {
  const {
    evidenceLink = '#sprint-health',
    detail  = '',
    bullets = [],
    tickets = [],
  } = extra;
  return {
    id: generateAlertId(ruleId), ruleId, severity, message,
    evidenceLink, detail, bullets, tickets,
    createdAt: Date.now(), acknowledged: false,
  };
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

  const thresholdPct = state.settings?.alerts?.rules?.scope_creep?.thresholdPct ?? 10;
  const netAdded = Object.values(sp.scopeByDay).reduce((s, sc) => s + (sc.added || 0), 0);
  if (netAdded === 0) return null;
  const pct = Math.round(netAdded / sp.committedPoints * 100);
  if (pct < thresholdPct) return null;

  return mkAlert('scope_creep', pct >= 20 ? 'high' : 'medium',
    `Scope creep: +${netAdded} pts added to ${sp.name} after kickoff` +
    ` (${pct} % of ${sp.committedPoints} pt commitment). Review with the team.`
  );
}

// ── RULE 3: stalled_burndown ──────────────────────────────────────────────
// Fires when no points were completed on any of the last 2+ working days.
// Guarded: skips the early-sprint ramp-up window (first ~20 % of working days,
// min 2) so day-2 silence doesn't trigger a false alarm.
export function stalledBurndown(state) {
  const sp  = state.currentSprint;
  const wds = state.settings?.ui?.workingDays || [0, 1, 2, 3, 4];
  const stalledDays = state.settings?.alerts?.rules?.stalled_burndown?.stalledDays ?? 2;
  if (!sp?.stories || sp.todayIndex == null || sp.todayIndex < stalledDays) return null;
  if (isEarlySprint(sp, wds)) return null; // too early — normal ramp-up, not a stall

  const wdSet = new Set(wds);
  const start = new Date(sp.startDate); start.setHours(0, 0, 0, 0);
  const recentWds = [];
  for (let d = sp.todayIndex; d >= 0 && recentWds.length < stalledDays; d--) {
    const date = new Date(start); date.setDate(start.getDate() + d);
    if (wdSet.has(date.getDay())) recentWds.push(d);
  }
  if (recentWds.length < stalledDays) return null;

  const hadWork = sp.stories.some(s =>
    s.closedDay != null && (s.points || 0) > 0 && recentWds.includes(s.closedDay)
  );
  if (hadWork) return null;

  const open = (sp.committedPoints || sp.totalPoints || 0) - (sp.completedPoints || 0);
  return mkAlert('stalled_burndown', stalledDays >= 3 ? 'high' : 'medium',
    `No points completed in the last ${stalledDays} working days (${sp.name}).` +
    ` ${open} pts still open — check for blockers.`
  );
}

// ── RULE 4: due_date_risk ─────────────────────────────────────────────────
// Fires when tickets are genuinely overdue (dueDate < today) or due very soon
// (within the next 2 working days). "Due by sprint end" is intentionally NOT
// the threshold here — that just means "in this sprint" and is meaningless on
// day 1 when nothing is done yet.
export function dueDateRisk(state) {
  const sp  = state.currentSprint;
  const wds = state.settings?.ui?.workingDays || [0, 1, 2, 3, 4];
  if (!sp?.stories) return null;

  const today  = new Date(); today.setHours(0, 0, 0, 0);
  const wdSet  = new Set(wds);

  // Compute "2 working days from today" as the imminent window
  let imminentEnd = new Date(today);
  let wd = 0;
  while (wd < 2) {
    imminentEnd.setDate(imminentEnd.getDate() + 1);
    if (wdSet.has(imminentEnd.getDay())) wd++;
  }

  const overdue  = sp.stories.filter(s =>
    s.dueDate && s.statusCategory !== 'done' &&
    (s.points || 0) > 0 && new Date(s.dueDate) < today
  );
  const imminent = sp.stories.filter(s =>
    s.dueDate && s.statusCategory !== 'done' &&
    (s.points || 0) > 0 &&
    new Date(s.dueDate) >= today && new Date(s.dueDate) <= imminentEnd
  );

  const atRisk = [...overdue, ...imminent];
  if (atRisk.length === 0) return null;

  const pts  = atRisk.reduce((sum, s) => sum + (s.points || 0), 0);
  const keys = atRisk.slice(0, 3).map(s => s.key).join(', ');
  const more = atRisk.length > 3 ? ` +${atRisk.length - 3} more` : '';

  let msg;
  if (overdue.length > 0 && imminent.length > 0) {
    msg = `${overdue.length} ticket${overdue.length > 1 ? 's' : ''} overdue, ` +
          `${imminent.length} due within 2 working days — ${pts} pts at risk: ${keys}${more}.`;
  } else if (overdue.length > 0) {
    const p = overdue.reduce((sum, s) => sum + (s.points || 0), 0);
    msg = `${overdue.length} ticket${overdue.length > 1 ? 's' : ''} overdue ` +
          `(${p} pts, not yet done): ${keys}${more}.`;
  } else {
    msg = `${imminent.length} ticket${imminent.length > 1 ? 's' : ''} due within ` +
          `2 working days (${pts} pts) not yet done: ${keys}${more}.`;
  }

  const bullets = atRisk.map(s => {
    const od = new Date(s.dueDate) < today;
    return `${s.key} · ${s.points || 0}pt · ${od ? 'overdue' : 'due'} ${s.dueDate}${s.assignee ? ' · ' + s.assignee : ' · unassigned'}`;
  });
  return mkAlert('due_date_risk', overdue.length > 0 ? 'high' : 'medium', msg, {
    detail: `${atRisk.length} ticket${atRisk.length > 1 ? 's' : ''} at risk (${pts} pts total). Overdue items have a due date before today; imminent items are due within the next 2 working days.`,
    bullets,
    tickets: atRisk.map(s => s.key),
  });
}

// ── RULE 5: unassigned_work ───────────────────────────────────────────────
// Fires when open, pointed tickets have no assignee.
// Severity is capped at medium during the early-sprint ramp-up window (teams
// often assign as they pick up work, so HIGH on day 1 would be premature).
export function unassignedWork(state) {
  const sp  = state.currentSprint;
  const wds = state.settings?.ui?.workingDays || [0, 1, 2, 3, 4];
  if (!sp?.stories) return null;

  const unassigned = sp.stories.filter(s =>
    !s.assignee && s.statusCategory !== 'done' && (s.points || 0) > 0
  );
  if (unassigned.length === 0) return null;

  const pts  = unassigned.reduce((sum, s) => sum + (s.points || 0), 0);
  const keys = unassigned.slice(0, 3).map(s => s.key).join(', ');
  const more = unassigned.length > 3 ? ` +${unassigned.length - 3} more` : '';

  const earlyFlag = isEarlySprint(sp, wds);
  const severity  = (!earlyFlag && pts >= 8) ? 'high' : 'medium';

  return mkAlert('unassigned_work', severity,
    `${unassigned.length} unassigned ticket${unassigned.length > 1 ? 's' : ''}` +
    ` (${pts} pts) in ${sp.name}: ${keys}${more}.`,
    {
      detail: `Open, pointed tickets with no assignee (${pts} pts). Assigning early keeps the burndown attributable and avoids work falling through the cracks.`,
      bullets: unassigned.map(s => `${s.key} · ${s.points || 0}pt · ${s.status || 'open'}`),
      tickets: unassigned.map(s => s.key),
    }
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
    ` (${pts} pts of potential rework): ${keys}${more}.`,
    {
      detail: `These tickets reached Done earlier this sprint but are open again — usually a sign of quality or spec issues. ${pts} pts of potential rework.`,
      bullets: reopened.map(s => `${s.key} · ${s.points || 0}pt · now ${s.status || 'reopened'}${s.assignee ? ' · ' + s.assignee : ''}`),
      tickets: reopened.map(s => s.key),
    }
  );
}

// ── RULE 7: sentry_trend_spike ────────────────────────────────────────────
// Grounded on the Sentry trend-sample data the extension actually collects
// (day-over-day count increase), not per-issue triage state.
export function sentryTrendSpike(state) {
  const views   = state.sentryViews;
  const samples = state.sentryTrendSamples;
  if (!views?.length || !samples) return null;

  const spikeDelta = state.settings?.alerts?.rules?.sentry_trend_spike?.spikeDelta ?? 10;
  const spikePct   = state.settings?.alerts?.rules?.sentry_trend_spike?.spikePct   ?? 25;

  const spikes = views
    .map(v => ({ v, spike: metrics.sentryDayOverDaySpike(v.count, samples[v.viewId] || [], spikeDelta, spikePct) }))
    .filter(x => x.spike);
  if (spikes.length === 0) return null;

  const worst   = spikes.reduce((a, b) => b.spike.delta > a.spike.delta ? b : a);
  const details = spikes.map(x => `${x.v.label} +${x.spike.delta}`).join(', ');
  const pctStr  = worst.spike.pctChange != null ? ` (+${worst.spike.pctChange} %)` : '';

  return mkAlert('sentry_trend_spike', worst.spike.delta >= 20 ? 'high' : 'medium',
    `Sentry spike: ${details}. ${worst.v.label} rose from ${worst.spike.prevCount}` +
    ` → ${worst.v.count}${pctStr}.`,
    {
      evidenceLink: '#reliability',
      detail: 'Day-over-day error count increase across one or more Sentry views.',
      bullets: spikes.map(x => `${x.v.label}: ${x.spike.prevCount} → ${x.v.count} (+${x.spike.delta})`),
    }
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
  const ruleConf = state.settings?.alerts?.rules || {};
  const rules = [
    ['sprint_goal_at_risk', sprintGoalAtRisk],
    ['scope_creep',         scopeCreep],
    ['stalled_burndown',    stalledBurndown],
    ['due_date_risk',       dueDateRisk],
    ['unassigned_work',     unassignedWork],
    ['reopened_tickets',    reopenedTickets],
    ['sentry_trend_spike',  sentryTrendSpike],
    ['velocity_drop',       velocityDrop],
    ['support_sla_breach',  supportSLABreach],
  ];
  return rules.reduce((acc, [id, fn]) => {
    if (ruleConf[id]?.enabled === false) return acc;   // T-AS-1: skip disabled rules
    try { const a = fn(state); if (a) acc.push(a); }
    catch (e) { console.warn(`[alerts] Rule ${id} threw:`, e.message); }
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

/**
 * Local YYYY-MM-DD for "today" (snooze granularity is one calendar day).
 */
export function todayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Tomorrow's YYYY-MM-DD — an alert snoozed today reappears tomorrow (if its
 * condition still holds). Snooze is a one-day reprieve, not a permanent dismiss.
 */
export function tomorrowKey(now = new Date()) {
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  return todayKey(t);
}

/**
 * Filter alerts by the snooze map: hide an alert whose ruleId is snoozed until
 * a date strictly after today. Once the snooze date arrives, the alert is shown
 * again (re-evaluated fresh by checkAlerts on the next data refresh).
 *
 * @param {Object[]} alertList
 * @param {Object<string,string>} snoozeMap  { ruleId: 'YYYY-MM-DD' }
 * @param {Date} [now]
 */
export function visibleAlerts(alertList, snoozeMap = {}, now = new Date()) {
  const today = todayKey(now);
  return (alertList || []).filter(a => {
    if (a.acknowledged) return false;
    const until = snoozeMap[a.ruleId];
    if (!until) return true;
    return today >= until; // snooze expired (today is the reappear day or later)
  });
}
