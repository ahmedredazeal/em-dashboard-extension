#!/usr/bin/env node
/**
 * tests/worklog-aggregator.test.js
 */
import {
  assignProjectColors,
  currentQuarters, quarterRange,
  aggregateWorklogs, aggregateByIssueType, extractWorklogsFromIssues
} from '../src/worklog-aggregator.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch(e) { console.error(`  ✗ ${name}: ${e.message}`); fail++; }
}
function assert(v, msg='assertion failed') { if (!v) throw new Error(msg); }
function deq(a,b) { return JSON.stringify(a)===JSON.stringify(b); }

// ── assignProjectColors ───────────────────────────────────────────────────
console.log('\nassignProjectColors');
test('assigns colours alphabetically', () => {
  const m = assignProjectColors(['ZZZ','AAA']);
  assert(m['AAA'] !== m['ZZZ'], 'different colours');
  // AAA sorts first → palette[0]
  assert(m['AAA'] === '#0ea5e9', `AAA colour: ${m['AAA']}`);
});
test('same key always gets same colour', () => {
  const m1 = assignProjectColors(['HRM','POS','ATH']);
  const m2 = assignProjectColors(['ATH','HRM','POS']); // different input order
  assert(m1['HRM'] === m2['HRM'], 'HRM stable');
  assert(m1['POS'] === m2['POS'], 'POS stable');
});
test('deduplicates keys', () => {
  const m = assignProjectColors(['HRM','HRM','POS']);
  assert(Object.keys(m).length === 2, 'only 2 keys');
});
test('empty array returns empty object', () => {
  assert(Object.keys(assignProjectColors([])).length === 0);
});
test('wraps palette after 8 colours', () => {
  const keys = ['A','B','C','D','E','F','G','H','I'];
  const m = assignProjectColors(keys);
  // 9th project (I) wraps to palette[0]
  assert(m['I'] === '#0ea5e9', `9th: ${m['I']}`);
});

// ── currentQuarters ───────────────────────────────────────────────────────
console.log('\ncurrentQuarters');
test('May 2026 → Q1 + Q2 only', () => {
  const qs = currentQuarters(2026, 5);
  assert(qs.length === 2, `expected 2, got ${qs.length}`);
  assert(qs[0].label === 'Q1', `first: ${qs[0].label}`);
  assert(qs[1].label === 'Q2', `second: ${qs[1].label}`);
});
test('Jan 2026 → Q1 only', () => {
  const qs = currentQuarters(2026, 1);
  assert(qs.length === 1 && qs[0].label === 'Q1');
});
test('Dec 2026 → all 4 quarters', () => {
  assert(currentQuarters(2026, 12).length === 4);
});
test('Q1 dates correct', () => {
  const qs = currentQuarters(2026, 5);
  assert(qs[0].start === '2026-01-01', `start: ${qs[0].start}`);
  assert(qs[0].end   === '2026-03-31', `end: ${qs[0].end}`);
});
test('Q2 dates correct', () => {
  const qs = currentQuarters(2026, 5);
  assert(qs[1].start === '2026-04-01', `start: ${qs[1].start}`);
  assert(qs[1].end   === '2026-06-30', `end: ${qs[1].end}`);
});

// ── quarterRange ──────────────────────────────────────────────────────────
console.log('\nquarterRange');
test('Q1 2026', () => {
  const r = quarterRange(1, 2026);
  assert(r.start === '2026-01-01' && r.end === '2026-03-31');
});
test('Q4 2026 ends Dec 31', () => {
  const r = quarterRange(4, 2026);
  assert(r.start === '2026-10-01' && r.end === '2026-12-31');
});
test('Q2 leap year 2024', () => {
  const r = quarterRange(2, 2024);
  assert(r.start === '2024-04-01' && r.end === '2024-06-30');
});

// ── aggregateWorklogs ─────────────────────────────────────────────────────
console.log('\naggregateWorklogs');

const RAW = [
  { authorId:'u1', authorName:'Ali', timeSpentSeconds:3600*10, projectKey:'HRM', projectName:'Hermes', estimateSeconds:3600*8, issueType:'Story', started:'2026-05-01' },
  { authorId:'u1', authorName:'Ali', timeSpentSeconds:3600*5,  projectKey:'POS', projectName:'POS',    estimateSeconds:0,      issueType:'Bug',   started:'2026-05-02' },
  { authorId:'u2', authorName:'Dana',timeSpentSeconds:3600*20, projectKey:'HRM', projectName:'Hermes', estimateSeconds:3600*18,issueType:'Story',  started:'2026-05-01' },
];

test('groups by author', () => {
  const r = aggregateWorklogs(RAW);
  assert(r.length === 2, `expected 2, got ${r.length}`);
});
test('sorts by total descending', () => {
  const r = aggregateWorklogs(RAW);
  assert(r[0].name === 'Dana', `first should be Dana, got ${r[0].name}`);
  assert(r[1].name === 'Ali',  `second should be Ali, got ${r[1].name}`);
});
test('total hours computed correctly', () => {
  const r = aggregateWorklogs(RAW);
  const ali = r.find(m => m.name === 'Ali');
  assert(ali.total === 15, `Ali total: ${ali.total}`);
});
test('byProject breakdown', () => {
  const r = aggregateWorklogs(RAW);
  const ali = r.find(m => m.name === 'Ali');
  assert(ali.byProject['HRM'] === 10, `HRM: ${ali.byProject['HRM']}`);
  assert(ali.byProject['POS'] === 5,  `POS: ${ali.byProject['POS']}`);
});
test('estimateRatio computed', () => {
  const r = aggregateWorklogs(RAW);
  const ali = r.find(m => m.name === 'Ali');
  // 15h logged / 8h estimated = 1.88
  assert(Math.abs(ali.estimateRatio - 1.88) < 0.01, `ratio: ${ali.estimateRatio}`);
});
test('estimateRatio null when no estimate', () => {
  const r = aggregateWorklogs([
    { authorId:'u3', authorName:'X', timeSpentSeconds:3600, projectKey:'HRM', estimateSeconds:0, started:'2026-05-01' }
  ]);
  assert(r[0].estimateRatio === null);
});
test('empty input returns empty array', () => {
  assert(deq(aggregateWorklogs([]), []));
  assert(deq(aggregateWorklogs(null), []));
});

// ── aggregateByIssueType ──────────────────────────────────────────────────
console.log('\naggregateByIssueType');
test('sums by issue type', () => {
  const r = aggregateByIssueType(RAW);
  const story = r.find(x => x.type === 'Story');
  assert(story, 'Story should exist');
  assert(story.hours === 30, `Story hours: ${story.hours}`);  // 10+20
  const bug = r.find(x => x.type === 'Bug');
  assert(bug.hours === 5, `Bug hours: ${bug.hours}`);
});
test('sorted by hours desc', () => {
  const r = aggregateByIssueType(RAW);
  assert(r[0].type === 'Story', `first: ${r[0].type}`);
});

// ── extractWorklogsFromIssues ─────────────────────────────────────────────
console.log('\nextractWorklogsFromIssues');

const ISSUES = [
  {
    fields: {
      project: { key: 'HRM', name: 'Hermes' },
      issuetype: { name: 'Story' },
      timeoriginalestimate: 3600 * 5,
      worklog: {
        total: 2, maxResults: 20,
        worklogs: [
          { author: { accountId:'u1', displayName:'Ali' }, timeSpentSeconds: 3600*3, started: '2026-05-15T10:00:00.000+0000' },
          { author: { accountId:'u2', displayName:'Dana'}, timeSpentSeconds: 3600*2, started: '2026-05-16T10:00:00.000+0000' },
        ]
      }
    }
  },
  {
    fields: {
      project: { key: 'POS', name: 'POS' },
      issuetype: { name: 'Bug' },
      timeoriginalestimate: 0,
      worklog: {
        total: 1, maxResults: 20,
        worklogs: [
          { author: { accountId:'u1', displayName:'Ali' }, timeSpentSeconds: 3600*1, started: '2026-04-01T10:00:00.000+0000' }, // outside range
        ]
      }
    }
  }
];

test('extracts worklogs from issues', () => {
  const r = extractWorklogsFromIssues(ISSUES, [], '2026-05-01', '2026-05-31');
  assert(r.length === 2, `expected 2 in range, got ${r.length}`);
});
test('filters by date range', () => {
  const r = extractWorklogsFromIssues(ISSUES, [], '2026-05-01', '2026-05-31');
  assert(r.every(w => w.started >= '2026-05-01'), 'all in range');
});
test('filters by authorIds when provided', () => {
  const r = extractWorklogsFromIssues(ISSUES, ['u1'], '2026-05-01', '2026-05-31');
  assert(r.length === 1, `expected 1, got ${r.length}`);
  assert(r[0].authorId === 'u1');
});
test('includes project key on each worklog', () => {
  const r = extractWorklogsFromIssues(ISSUES, [], '2026-05-01', '2026-05-31');
  assert(r.every(w => w.projectKey === 'HRM'));
});
test('includes issue type on each worklog', () => {
  const r = extractWorklogsFromIssues(ISSUES, [], '2026-05-01', '2026-05-31');
  assert(r.every(w => w.issueType === 'Story'));
});
test('empty issues returns empty array', () => {
  assert(deq(extractWorklogsFromIssues([], [], '2026-05-01', '2026-05-31'), []));
});

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
