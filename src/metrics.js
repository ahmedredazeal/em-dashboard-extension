/**
 * metrics.js
 * Pure metric calculation functions (no DOM dependencies)
 * All thresholds from the EM charter
 */

/**
 * Calculate rolling 5-sprint velocity average
 * @param {Array} sprintHistory - [{sprintId, velocity}, ...]
 * @returns {number} rolling average
 */
export function calculateVelocity(sprintHistory) {
  if (!sprintHistory || sprintHistory.length === 0) return 0;
  
  const recent = sprintHistory.slice(-5);
  const sum = recent.reduce((acc, s) => acc + (s.velocity || 0), 0);
  return Math.round(sum / recent.length);
}

/**
 * Check if velocity dropped >15% for 2 consecutive sprints
 * @param {Array} sprintHistory
 * @returns {boolean}
 */
export function velocityDropped(sprintHistory) {
  if (!sprintHistory || sprintHistory.length < 3) return false;
  
  const recent = sprintHistory.slice(-3);
  const [s1, s2, s3] = recent;
  
  const drop1 = (s1.velocity - s2.velocity) / s1.velocity;
  const drop2 = (s2.velocity - s3.velocity) / s2.velocity;
  
  return drop1 > 0.15 && drop2 > 0.15;
}

/**
 * Calculate sprint goal achievement rate (rolling 5 sprints)
 * @param {Array} sprintHistory - [{goalAchieved: boolean}, ...]
 * @returns {number} percentage (0-100)
 */
export function goalAchievementRate(sprintHistory) {
  if (!sprintHistory || sprintHistory.length === 0) return 0;
  
  const recent = sprintHistory.slice(-5);
  const achieved = recent.filter(s => s.goalAchieved === true).length;
  return Math.round((achieved / recent.length) * 100);
}

/**
 * Calculate carry-over rate (avg stories carried between sprints)
 * @param {Array} sprintHistory - [{carryOver: number}, ...]
 * @returns {number} average carry-over count
 */
export function carryOverRate(sprintHistory) {
  if (!sprintHistory || sprintHistory.length === 0) return 0;
  
  const recent = sprintHistory.slice(-5);
  const sum = recent.reduce((acc, s) => acc + (s.carryOver || 0), 0);
  return Math.round((sum / recent.length) * 10) / 10; // 1 decimal
}

/**
 * Calculate support SLA adherence
 * @param {Array} supportTickets - [{resolvedWithinSLA: boolean}, ...]
 * @returns {number} percentage (0-100)
 */
export function supportSLAAdherence(supportTickets) {
  if (!supportTickets || supportTickets.length === 0) return 100; // no tickets = 100%
  
  const resolved = supportTickets.filter(t => t.resolvedWithinSLA === true).length;
  return Math.round((resolved / supportTickets.length) * 100);
}

/**
 * Calculate rolling 7-day Sentry error count
 * @param {Array} sentryIssues - [{createdAt: timestamp, resolved: boolean}, ...]
 * @returns {number} unresolved count in last 7 days
 */
export function sentryErrorTrend(sentryIssues) {
  if (!sentryIssues || sentryIssues.length === 0) return 0;
  
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recent = sentryIssues.filter(issue => 
    new Date(issue.createdAt).getTime() > sevenDaysAgo && !issue.resolved
  );
  
  return recent.length;
}

/**
 * Calculate incident frequency (per sprint)
 * @param {Array} sprintHistory - [{incidents: number}, ...]
 * @returns {number} average incidents per sprint
 */
export function incidentFrequency(sprintHistory) {
  if (!sprintHistory || sprintHistory.length === 0) return 0;
  
  const recent = sprintHistory.slice(-5);
  const sum = recent.reduce((acc, s) => acc + (s.incidents || 0), 0);
  return Math.round((sum / recent.length) * 10) / 10;
}

/**
 * Calculate engineer utilization (vacation-aware in Phase 2)
 * @param {Object} engineer - {worklogs: [{date, hours}]}
 * @param {Array} vacations - [{from, to}] (Phase 2 — Leapsome)
 * @param {number} daysToCheck - rolling window (default 7)
 * @returns {Object} {avgHours, isInBand, trend}
 */
export function engineerUtilization(engineer, vacations = [], daysToCheck = 7) {
  if (!engineer || !engineer.worklogs || engineer.worklogs.length === 0) {
    return { avgHours: 0, isInBand: false, trend: 'no-data' };
  }
  
  const cutoff = Date.now() - (daysToCheck * 24 * 60 * 60 * 1000);
  const recentLogs = engineer.worklogs.filter(log => 
    new Date(log.date).getTime() > cutoff
  );
  
  // Phase 1: simple average (vacation-awareness added in Phase 2)
  if (recentLogs.length === 0) {
    return { avgHours: 0, isInBand: false, trend: 'no-data' };
  }
  
  const sum = recentLogs.reduce((acc, log) => acc + (log.hours || 0), 0);
  const avgHours = sum / recentLogs.length;
  
  // Target: 6±1 hours per working day
  const isInBand = avgHours >= 5 && avgHours <= 7;
  
  // Simple trend: compare first half vs second half
  const mid = Math.floor(recentLogs.length / 2);
  const firstHalf = recentLogs.slice(0, mid);
  const secondHalf = recentLogs.slice(mid);
  
  const avgFirst = firstHalf.reduce((a, l) => a + l.hours, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, l) => a + l.hours, 0) / secondHalf.length;
  
  let trend = 'stable';
  if (avgSecond > avgFirst * 1.1) trend = 'increasing';
  if (avgSecond < avgFirst * 0.9) trend = 'decreasing';
  
  return {
    avgHours: Math.round(avgHours * 10) / 10,
    isInBand,
    trend
  };
}

/**
 * Calculate growth plan coverage (% engineers with active plans)
 * @param {Array} engineers - [{id, growthPlan: {active: boolean}}]
 * @returns {number} percentage (0-100)
 */
export function growthPlanCoverage(engineers) {
  if (!engineers || engineers.length === 0) return 0;
  
  const withPlans = engineers.filter(e => e.growthPlan?.active === true).length;
  return Math.round((withPlans / engineers.length) * 100);
}

/**
 * Calculate effective working days (vacation-aware)
 * Phase 1: stub — full implementation in Phase 2 with Leapsome
 * @param {string} engineerId
 * @param {Object} range - {from: Date, to: Date}
 * @param {Array} vacations - Leapsome vacation data (Phase 2)
 * @returns {number} working days in range
 */
export function effectiveWorkingDays(engineerId, range, vacations = []) {
  // Phase 1 stub: count total days (weekends subtracted)
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = Math.ceil((range.to - range.from) / msPerDay);
  
  // Rough estimate: 5/7 of days are working days (excludes weekends)
  // Phase 2 will subtract actual vacation days from Leapsome
  return Math.round(daysDiff * (5/7));
}

/**
 * Mid-sprint burndown prediction (is goal at risk?)
 * @param {Object} sprint - {totalPoints, completedPoints, daysElapsed, totalDays}
 * @returns {Object} {predicted, onTrack, risk}
 */
export function sprintBurndownPrediction(sprint) {
  if (!sprint || !sprint.totalPoints) {
    return { predicted: 0, onTrack: true, risk: 'no-data', dailyVelocity: 0, expectedDailyVelocity: 0 };
  }
  
  const { totalPoints, completedPoints, daysElapsed, totalDays } = sprint;
  const daysRemaining = Math.max(0, totalDays - daysElapsed);
  const expectedDailyVelocity = totalPoints / totalDays;

  // Sprint ended
  if (daysRemaining <= 0) {
    return {
      predicted: completedPoints,
      onTrack: completedPoints >= totalPoints,
      risk: completedPoints >= totalPoints ? 'none' : 'goal-missed',
      dailyVelocity: Math.round((completedPoints / Math.max(1, totalDays)) * 10) / 10,
      expectedDailyVelocity: Math.round(expectedDailyVelocity * 10) / 10
    };
  }

  // Too early to judge: first 20% of sprint or first 2 days — give the team time
  const earlyThreshold = Math.max(2, Math.floor(totalDays * 0.2));
  const roundedExpected = Math.round(expectedDailyVelocity * 10) / 10;
  if (daysElapsed <= earlyThreshold) {
    return {
      predicted: totalPoints,
      onTrack: true,
      risk: 'early',
      dailyVelocity: 0,
      expectedDailyVelocity: roundedExpected
    };
  }

  // Linear projection: current velocity × remaining days
  const dailyVelocity = completedPoints / daysElapsed;
  const predicted = completedPoints + (dailyVelocity * daysRemaining);
  const onTrack = predicted >= totalPoints * 0.85; // within 15%

  let risk = 'none';
  if (predicted < totalPoints * 0.6) risk = 'high';
  else if (predicted < totalPoints * 0.85) risk = 'medium';

  return {
    predicted: Math.round(predicted),
    onTrack,
    risk,
    dailyVelocity: Math.round(dailyVelocity * 10) / 10,
    expectedDailyVelocity: Math.round(expectedDailyVelocity * 10) / 10
  };
}

/**
 * Check if Sentry spike is untriaged (age > 24h)
 * @param {Object} sentryIssue - {createdAt, triaged: boolean}
 * @returns {boolean}
 */
export function sentryUntriaged(sentryIssue) {
  if (!sentryIssue || sentryIssue.triaged) return false;
  
  const ageMs = Date.now() - new Date(sentryIssue.createdAt).getTime();
  const ageHours = ageMs / (60 * 60 * 1000);
  
  return ageHours > 24;
}

/**
 * Check if ticket is stale (no update in 2+ days)
 * @param {Object} ticket - {lastUpdated: timestamp}
 * @returns {boolean}
 */
export function ticketStale(ticket) {
  if (!ticket || !ticket.lastUpdated) return false;
  
  const ageMs = Date.now() - new Date(ticket.lastUpdated).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  
  return ageDays > 2;
}

// ────────────────────────────────────────────────────────────────────────────
// Working-day utilities

/**
 * Count working days between two dates (inclusive of from, exclusive of to).
 * @param {Date|string} fromDate
 * @param {Date|string} toDate
 * @param {number[]} workingDayNums  0=Sun … 6=Sat  (default Sun–Thu)
 */
export function countWorkingDays(fromDate, toDate, workingDayNums = [0, 1, 2, 3, 4]) {
  const wdSet = new Set(workingDayNums);
  const d    = new Date(fromDate); d.setHours(12, 0, 0, 0);
  const end  = new Date(toDate);  end.setHours(12, 0, 0, 0);
  let count = 0;
  while (d < end) {
    if (wdSet.has(d.getDay())) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/**
 * Returns true if we are still in the "ramp-up" window of a sprint —
 * defined as the first 20 % of working days (minimum 2). Alert rules
 * that are meaningless right after planning should guard on this.
 * @param {Object}   sprint      - currentSprint (needs startDate, endDate)
 * @param {number[]} workingDays - e.g. [0,1,2,3,4] Sun-Thu
 */
export function isEarlySprint(sprint, workingDays = [0, 1, 2, 3, 4]) {
  if (!sprint?.startDate || !sprint?.endDate) return false;
  const start = new Date(sprint.startDate);
  const end   = new Date(sprint.endDate);
  const now   = new Date();
  const wdTotal   = countWorkingDays(start, end, workingDays);
  const wdElapsed = Math.min(countWorkingDays(start, now, workingDays), wdTotal);
  const threshold = Math.max(2, Math.floor(wdTotal * 0.2));
  return wdElapsed <= threshold;
}

// ────────────────────────────────────────────────────────────────────────────
// Enhanced sprint prediction using committed baseline + working days

/**
 * Project whether the sprint will hit its committed goal.
 * Uses working-day-aware velocity and the committed (sprint-start) baseline,
 * not the live story-point sum, so mid-sprint estimate edits don't distort it.
 *
 * @param {Object} sprint  - currentSprint object (needs committedPoints,
 *                           completedPoints, startDate, endDate)
 * @param {number[]} workingDays - [0,1,2,3,4] Sun-Thu default
 * @returns {{ predicted, risk, shortfall, dailyVelocity, neededVelocity,
 *             wdElapsed, wdRemaining, wdTotal }}
 */
export function committedBurnPrediction(sprint, workingDays = [0, 1, 2, 3, 4]) {
  const baseline = sprint?.committedPoints || sprint?.totalPoints || 0;
  if (!baseline || !sprint?.startDate || !sprint?.endDate) {
    return { predicted: 0, risk: 'no-data', shortfall: 0, dailyVelocity: 0,
             neededVelocity: 0, wdElapsed: 0, wdRemaining: 0, wdTotal: 0 };
  }
  const now     = new Date();
  const start   = new Date(sprint.startDate);
  const end     = new Date(sprint.endDate);
  const wdTotal     = countWorkingDays(start, end, workingDays);
  const wdElapsed   = Math.min(countWorkingDays(start, now, workingDays), wdTotal);
  const wdRemaining = Math.max(0, wdTotal - wdElapsed);

  // Too early — first 20 % of working days (min 2) gives benefit of the doubt
  const earlyThreshold = Math.max(2, Math.floor(wdTotal * 0.2));
  if (wdElapsed <= earlyThreshold) {
    return { predicted: baseline, risk: 'early', shortfall: 0,
             dailyVelocity: 0, neededVelocity: 0, wdElapsed, wdRemaining, wdTotal };
  }

  const completedPoints = sprint.completedPoints || 0;
  if (wdRemaining === 0) {
    const risk = completedPoints >= baseline * 0.85 ? 'none' : 'goal-missed';
    return { predicted: completedPoints, risk, shortfall: Math.max(0, baseline - completedPoints),
             dailyVelocity: 0, neededVelocity: 0, wdElapsed, wdRemaining, wdTotal };
  }

  const dailyVelocity   = completedPoints / wdElapsed;
  const projected       = completedPoints + dailyVelocity * wdRemaining;
  const neededVelocity  = (baseline - completedPoints) / wdRemaining;
  const pct             = projected / baseline;

  let risk = 'none';
  if (pct < 0.60) risk = 'high';
  else if (pct < 0.85) risk = 'medium';

  return {
    predicted: Math.round(projected),
    risk,
    shortfall: Math.max(0, Math.round(baseline - projected)),
    dailyVelocity:  Math.round(dailyVelocity  * 10) / 10,
    neededVelocity: Math.round(neededVelocity  * 10) / 10,
    wdElapsed, wdRemaining, wdTotal
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Sentry trend spike

/**
 * Detect a day-over-day spike in a Sentry view's issue count.
 * @param {number}   currentCount   - live count from the latest Sentry fetch
 * @param {Array}    trendSamples   - [{date:'YYYY-MM-DD', count}] sorted asc
 * @param {number}   deltaThreshold - absolute new-issue count to consider a spike
 * @param {number}   pctThreshold   - % increase to consider a spike
 * @returns {null | {delta, pctChange, prevCount, prevDate}}
 */
export function sentryDayOverDaySpike(
  currentCount, trendSamples,
  deltaThreshold = 10, pctThreshold = 25
) {
  if (!trendSamples || trendSamples.length === 0) return null;
  // Tolerate both {date} and {day} sample shapes, and guard against missing
  // keys — a malformed sample must not throw and silently kill this rule.
  const keyOf = s => s.date || s.day || '';
  const sorted = [...trendSamples].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  const last   = sorted[sorted.length - 1];
  const delta  = currentCount - last.count;
  if (delta <= 0) return null;
  const pct = last.count > 0 ? Math.round(delta / last.count * 100) : null;
  if (delta < deltaThreshold && (pct === null || pct < pctThreshold)) return null;
  return { delta, pctChange: pct, prevCount: last.count, prevDate: keyOf(last) };
}
