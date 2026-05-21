#!/usr/bin/env node
/**
 * tests/burndown-algorithm.test.js
 * Proves the burndown algorithm works with synthetic data BEFORE we wire it up.
 * Validates: ideal line, estimate-based line, actual line from changelogs.
 */

// ── Mock sprint + issues ─────────────────────────────────────────────
const sprint = {
  name: 'HRM Sprint 64',
  startDate: '2026-05-05T00:00:00Z', // Mon
  endDate:   '2026-05-18T23:59:59Z', // Sun (2 weeks)
  totalPoints: 30,
  daysInSprint: 14
};

const issues = [
  {
    key: 'HRM-1', points: 5, dueDate: '2026-05-08', // due day 3
    status: 'Done',
    changelog: { histories: [
      { created: '2026-05-08T10:00:00Z', items: [{field:'status', toString:'Done'}] }
    ]}
  },
  {
    key: 'HRM-2', points: 8, dueDate: '2026-05-12',
    status: 'Done',
    changelog: { histories: [
      { created: '2026-05-13T15:00:00Z', items: [{field:'status', toString:'QA Accepted'}] }
    ]}
  },
  {
    key: 'HRM-3', points: 3, dueDate: '2026-05-10',
    status: 'In Progress',
    changelog: { histories: [
      { created: '2026-05-06T12:00:00Z', items: [{field:'status', toString:'In Progress'}] }
    ]}
  },
  {
    key: 'HRM-4', points: 14, dueDate: '2026-05-15',
    status: 'Open',
    changelog: { histories: [] }
  }
];

// ── Algorithm under test ─────────────────────────────────────────────
const DONE_STATUSES = new Set(['done','closed','resolved','qa accepted']);

function dayIndex(date, sprintStart) {
  const ms = new Date(date) - new Date(sprintStart);
  return Math.floor(ms / (1000*60*60*24));
}

function transitionToDoneDay(issue, sprintStart) {
  const hist = issue.changelog?.histories || [];
  // Walk backwards: find most recent status→done transition
  for (let i = hist.length - 1; i >= 0; i--) {
    const entry = hist[i];
    for (const item of entry.items || []) {
      if (item.field === 'status' && DONE_STATUSES.has((item.toString||'').toLowerCase())) {
        return dayIndex(entry.created, sprintStart);
      }
    }
  }
  return null; // not done yet
}

function burndownSeries(sprint, issues) {
  const days = sprint.daysInSprint;
  const total = issues.reduce((s,i) => s + (i.points||0), 0);

  // Ideal: remaining = total - (total/days * day)
  const ideal = [];
  for (let d = 0; d <= days; d++) ideal.push(Math.max(0, total - (total/days)*d));

  // Estimate-based: remaining = total - sum(points of tickets due on or before day d)
  const estimate = [];
  for (let d = 0; d <= days; d++) {
    const closedByThen = issues
      .filter(i => i.dueDate && dayIndex(i.dueDate, sprint.startDate) <= d)
      .reduce((s,i) => s + (i.points||0), 0);
    estimate.push(Math.max(0, total - closedByThen));
  }

  // Actual: remaining = total - sum(points closed by day d)
  const actual = [];
  for (let d = 0; d <= days; d++) {
    const closedByThen = issues
      .filter(i => {
        const closeDay = transitionToDoneDay(i, sprint.startDate);
        return closeDay !== null && closeDay <= d;
      })
      .reduce((s,i) => s + (i.points||0), 0);
    actual.push(Math.max(0, total - closedByThen));
  }

  return { ideal, estimate, actual, total };
}

// ── Run + assert ─────────────────────────────────────────────────────
const result = burndownSeries(sprint, issues);
const fmt = arr => arr.map(n => Math.round(n*10)/10).join(',');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}

console.log('\nBurndown algorithm — synthetic 14-day sprint, 30 total points\n');
console.log(`Total: ${result.total}`);
console.log(`Ideal:    [${fmt(result.ideal)}]`);
console.log(`Estimate: [${fmt(result.estimate)}]`);
console.log(`Actual:   [${fmt(result.actual)}]`);
console.log();

check('Ideal starts at total',  result.ideal[0],       30);
check('Ideal ends at 0',         Math.round(result.ideal[14]), 0);

check('Estimate at day 3 — HRM-1 (5pt) due', result.estimate[3], 25);
check('Estimate at day 7 — HRM-1+3+2 (16pt) due', result.estimate[7], 14);
check('Estimate at day 10 — all 4 (30pt) due',    result.estimate[10], 0);
check('Estimate at day 15 — all due',             result.estimate[14], 0);

check('Actual at day 3 — HRM-1 closed',      result.actual[3], 25);
check('Actual at day 8 — HRM-2 closed too',  result.actual[8], 17);
check('Actual at end — HRM-3,4 not done',    result.actual[14], 17);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
