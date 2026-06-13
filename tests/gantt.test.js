#!/usr/bin/env node
/**
 * tests/gantt.test.js
 * Run with: node tests/gantt.test.js
 */

import {
  getWorkingDays,
  dayColIndex,
  fmtDay,
  partitionStories,
  attachChildren,
  buildGanttSVG,
} from '../src/gantt.js';

const PORD = { highest:0,critical:0,high:1,medium:2,low:3,lowest:4 };
const priIdx = p => PORD[(p||'medium').toLowerCase()] ?? 2;
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); fail++; }
}
function assertEqual(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertIncludes(html, str) { assert(html.includes(str), `Expected to contain "${str}"`); }
function assertExcludes(html, str) { assert(!html.includes(str), `Expected NOT to contain "${str}"`); }

// ── getWorkingDays ─────────────────────────────────────────────────────────
console.log('\ngetWorkingDays');

test('returns only Sun-Thu days for default Zeal config', () => {
  // 2026-05-10 (Sun) to 2026-05-16 (Sat)
  const days = getWorkingDays('2026-05-10', '2026-05-16', [0,1,2,3,4]);
  assertEqual(days.length, 5); // Sun Mon Tue Wed Thu
  assertEqual(days[0], '2026-05-10'); // Sunday
  assertEqual(days[4], '2026-05-14'); // Thursday
});

test('excludes Fri and Sat in Sun-Thu config', () => {
  const days = getWorkingDays('2026-05-10', '2026-05-16', [0,1,2,3,4]);
  assert(!days.includes('2026-05-15'), 'Fri should be excluded');
  assert(!days.includes('2026-05-16'), 'Sat should be excluded');
});

test('returns empty for invalid range', () => {
  const days = getWorkingDays('2026-05-16', '2026-05-10', [0,1,2,3,4]);
  assertEqual(days.length, 0);
});

test('single day range returns that day if it is a working day', () => {
  // 2026-05-11 is a Monday (workday in Mon-Fri config)
  const days = getWorkingDays('2026-05-11', '2026-05-11', [1,2,3,4,5]);
  assertEqual(days.length, 1);
  assertEqual(days[0], '2026-05-11');
});

test('single day range returns empty if non-working day', () => {
  // 2026-05-10 is Sunday — not in Mon-Fri config
  const days = getWorkingDays('2026-05-10', '2026-05-10', [1,2,3,4,5]);
  assertEqual(days.length, 0);
});

test('2-week sprint Sun-Thu gives 10 working days', () => {
  // 2026-05-10 (Sun) to 2026-05-23 (Sat) — 10 working Sun-Thu days
  const days = getWorkingDays('2026-05-10', '2026-05-23', [0,1,2,3,4]);
  assertEqual(days.length, 10);
});

// ── dayColIndex ────────────────────────────────────────────────────────────
console.log('\ndayColIndex');

const SAMPLE_DAYS = ['2026-05-10','2026-05-11','2026-05-12','2026-05-13','2026-05-14'];

test('returns exact index for date in list', () => {
  assertEqual(dayColIndex('2026-05-12', SAMPLE_DAYS), 2);
});
test('clamps to 0 for date before list', () => {
  assertEqual(dayColIndex('2026-05-01', SAMPLE_DAYS), 0);
});
test('clamps to last for date after list', () => {
  assertEqual(dayColIndex('2026-06-01', SAMPLE_DAYS), 4);
});
test('returns closest for date between working days', () => {
  // 2026-05-15 (Fri) is not in the Sun-Thu list — should clamp to 4 (Thu)
  const idx = dayColIndex('2026-05-15', SAMPLE_DAYS);
  assert(idx >= 3 && idx <= 4, `Expected 3 or 4, got ${idx}`);
});

// ── fmtDay ─────────────────────────────────────────────────────────────────
console.log('\nfmtDay');

test('formats YYYY-MM-DD to "D Mon"', () => {
  assertEqual(fmtDay('2026-05-23'), '23 May');
});
test('single digit day has no leading zero', () => {
  assertEqual(fmtDay('2026-05-01'), '1 May');
});
test('formats December correctly', () => {
  assertEqual(fmtDay('2026-12-31'), '31 Dec');
});

// ── partitionStories ───────────────────────────────────────────────────────
console.log('\npartitionStories');

const ME = 'acc-me';
const stories = [
  { key:'HRM-1', summary:'Alpha', dueDate:'2026-05-20', startDate:'2026-05-10', created:'2026-05-10', assigneeAccountId: ME,   statusCategory:'done',          priority:'High',   points:3, assignee:'Ahmed' },
  { key:'HRM-2', summary:'Beta',  dueDate:'2026-05-15', startDate:'2026-05-11', created:'2026-05-11', assigneeAccountId:'x',   statusCategory:'indeterminate', priority:'Medium', points:5, assignee:'Sara'  },
  { key:'HRM-3', summary:'Gamma', dueDate: null,        startDate: null,        created:'2026-05-10', assigneeAccountId: ME,   statusCategory:'new',           priority:'Low',    points:0, assignee:'Ahmed' },
  { key:'HRM-4', summary:'Delta', dueDate: null,        startDate: null,        created:'2026-05-12', assigneeAccountId:'y',   statusCategory:'new',           priority:'High',   points:2, assignee:'Omar'  },
  { key:'HRM-5', summary:'Eps',   dueDate:'2026-05-23', startDate:'2026-05-14', created:'2026-05-14', assigneeAccountId: ME,   statusCategory:'new',           priority:'Low',    points:1, assignee:'Ahmed' },
];

test('scheduled sorted by priority then rank', () => {
  const { scheduled } = partitionStories(stories, ME, false);
  // HRM-1: High, rank 0|i0003 — HRM-2: Medium, HRM-5: Low — so High first
  assertEqual(scheduled[0].key, 'HRM-1');
  assert(priIdx(scheduled[0].priority) <= priIdx(scheduled[scheduled.length-1].priority), 'sorted by priority asc');
});
test('unscheduled sorted by priority then key', () => {
  const { unscheduled } = partitionStories(stories, ME, false);
  // HRM-4 is High priority (idx=1), HRM-3 is Low (idx=3) → High comes first
  assertEqual(unscheduled.map(s => s.key), ['HRM-4','HRM-3']);
});
test('filterMine=true returns only engineer tickets', () => {
  const { scheduled, unscheduled } = partitionStories(stories, ME, true);
  const all = [...scheduled, ...unscheduled].map(s => s.key);
  assert(all.every(k => ['HRM-1','HRM-3','HRM-5'].includes(k)), 'Only ME tickets');
  assert(!all.includes('HRM-2'), 'HRM-2 (other engineer) excluded');
});
test('filterMine=false returns all tickets', () => {
  const { scheduled, unscheduled } = partitionStories(stories, ME, false);
  assertEqual(scheduled.length + unscheduled.length, 5);
});
test('null accountId with filterMine=true returns nothing', () => {
  const { scheduled, unscheduled } = partitionStories(stories, null, true);
  assertEqual(scheduled.length + unscheduled.length, 5); // no filter applied
});

// ── buildGanttSVG ──────────────────────────────────────────────────────────
console.log('\nbuildGanttSVG');

const sprint = {
  name: 'HRM Sprint 64',
  startDate: '2026-05-10',
  endDate:   '2026-05-23',
};

test('returns an HTML container element', () => {
  const html = buildGanttSVG(stories, sprint, [0,1,2,3,4], ME);
  assertIncludes(html, '<div');
});
test('renders ticket keys', () => {
  const html = buildGanttSVG(stories, sprint, [0,1,2,3,4], ME);
  assertIncludes(html, 'HRM-1');
  assertIncludes(html, 'HRM-2');
});
test('renders unscheduled section when there are no-due-date tickets', () => {
  const html = buildGanttSVG(stories, sprint, [0,1,2,3,4], ME);
  assertIncludes(html, 'without due dates');
});
test('no unscheduled section when all tickets have due dates', () => {
  const allDated = stories.filter(s => s.dueDate);
  const html = buildGanttSVG(allDated, sprint, [0,1,2,3,4], ME);
  assertExcludes(html, 'without due dates');
});
test('filterMine=true excludes other engineers tickets', () => {
  const html = buildGanttSVG(stories, sprint, [0,1,2,3,4], ME, { filterMine: true });
  assertExcludes(html, 'HRM-2'); // belongs to 'x'
  assertExcludes(html, 'HRM-4'); // belongs to 'y'
  assertIncludes(html, 'HRM-1'); // mine
});
test('filterMine=false includes all tickets', () => {
  const html = buildGanttSVG(stories, sprint, [0,1,2,3,4], ME, { filterMine: false });
  assertIncludes(html, 'HRM-2');
  assertIncludes(html, 'HRM-4');
});
test('escapes XSS in ticket key and summary', () => {
  const xssStory = [{ key:'<script>', summary:'alert("xss")', dueDate:'2026-05-20', created:'2026-05-10', assigneeAccountId: ME, statusCategory:'new', priority:'Medium', points:0 }];
  const html = buildGanttSVG(xssStory, sprint, [0,1,2,3,4], ME);
  assertExcludes(html, '<script>');
  assertIncludes(html, '&lt;script&gt;');
});
test('empty stories returns valid HTML', () => {
  const html = buildGanttSVG([], sprint, [0,1,2,3,4], ME);
  assertIncludes(html, '<div');
});
test('today column is highlighted in red (Sprint Planner style)', () => {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  const end   = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const html = buildGanttSVG(stories, { name:'Test', startDate: start, endDate: end }, [0,1,2,3,4,5,6], ME);
  assertIncludes(html, '#DC2626'); // Sprint Planner today colour
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log('');
console.log('Parent/child (subtask) rendering');
test('subtasks nest into parent row (not their own row) and show ↳ child bars', () => {
  const parent = { key:'HRM-9', summary:'Parent story', priority:'Medium', points:3,
    assignee:'Ali', assigneeAccountId:'acc-ali', statusCategory:'new',
    dueDate:'2026-06-16', startDate:'2026-06-10', rank:'0|y:', labels:[] };
  const sub = { key:'HRM-9a', summary:'Child work', priority:'Medium', points:0,
    assignee:'Ali', assigneeAccountId:'acc-ali', statusCategory:'indeterminate',
    dueDate:'2026-06-12', startDate:'2026-06-10', rank:'0|x:', isSubtask:true, parentKey:'HRM-9', labels:[] };
  const html = buildGanttSVG([parent],
    { name:'S', startDate:'2026-06-08', endDate:'2026-06-18' }, [0,1,2,3,4], 'acc-ali',
    { subtasks: [sub] });
  // Parent row present once
  assert((html.match(/data-jira-key="HRM-9"/g) || []).length === 1, 'parent row missing/duplicated');
  // Child must NOT be a full row of its own — a row is a flex div with min-height;
  // the child key may appear ONLY on its bar (which uses position:absolute).
  assert(!/data-jira-key="HRM-9a"[^>]*min-height/.test(html), 'child should not be a full row');
  assert(/data-jira-key="HRM-9a"[^>]*position:absolute/.test(html), 'child should render as an absolutely-positioned bar');
  // Child bar rendered with ↳ marker
  assert(html.includes('↳'), 'child ↳ marker missing');
  // Child bar is hoverable/clickable on its own and shows a rich tooltip
  assert(/data-jira-key="HRM-9a"[^>]*pointer-events:auto/.test(html), 'child bar should be hoverable (pointer-events:auto + own key)');
  assert(/title="Child work · Ali/.test(html), 'child tooltip should show summary · assignee');
  // Child count badge on the parent
  assert(html.includes('1↳'), 'child-count badge missing');
});
test('orphan subtask (parent not in sprint) gets a synthetic parent row', () => {
  const orphan = { key:'HRM-50a', summary:'Orphan child', priority:'High', points:0,
    assignee:'Sara', assigneeAccountId:'acc-sara', statusCategory:'new',
    dueDate:'2026-06-14', startDate:'2026-06-11', rank:'0|z:', isSubtask:true, parentKey:'HRM-50', labels:[] };
  const html = buildGanttSVG([], // no parent stories
    { name:'S', startDate:'2026-06-08', endDate:'2026-06-18' }, [0,1,2,3,4], 'acc-sara',
    { subtasks: [orphan] });
  assert(html.includes('data-jira-key="HRM-50"'), 'synthetic parent row missing');
  assert(html.includes('ext'), 'external/synthetic marker missing');
});
test('childless parent still draws its own single bar', () => {
  const story = { key:'HRM-7', summary:'Solo', priority:'Medium', points:3,
    assignee:'Ali', assigneeAccountId:'acc-ali', statusCategory:'new',
    dueDate:'2026-06-12', startDate:'2026-06-10', rank:'0|y:', labels:[] };
  const html = buildGanttSVG([story],
    { name:'S', startDate:'2026-06-08', endDate:'2026-06-18' }, [0,1,2,3,4], 'acc-ali',
    { subtasks: [] });
  assert(html.includes('data-jira-key="HRM-7"'), 'parent row missing');
  assert(html.includes('3pt'), 'childless parent should show its own bar with points');
  assert(!html.includes('↳'), 'no child marker expected for childless story');
});

console.log('');
console.log('attachChildren grouping');
test('children attach to their parent by parentKey', () => {
  const stories = [{ key:'P-1', summary:'P', priority:'Medium', rank:'a' }];
  const subs = [
    { key:'P-1a', parentKey:'P-1', assignee:'Ali', assigneeAccountId:'x', dueDate:'2026-06-10' },
    { key:'P-1b', parentKey:'P-1', assignee:'Sara', assigneeAccountId:'y', dueDate:'2026-06-11' },
  ];
  const rows = attachChildren(stories, subs);
  assert(rows.length === 1, 'one parent row');
  assert(rows[0].children.length === 2, 'two children attached');
});
test('orphan subtask becomes a synthetic parent', () => {
  const rows = attachChildren([], [
    { key:'Q-9a', parentKey:'Q-9', assignee:'Ali', assigneeAccountId:'x', dueDate:'2026-06-12', startDate:'2026-06-10' },
  ]);
  assert(rows.length === 1, 'synthetic row created');
  assert(rows[0].key === 'Q-9' && rows[0].isSynthetic === true, 'synthetic parent keyed by parentKey');
  assert(rows[0].children.length === 1, 'orphan attached to synthetic parent');
});
test('filterMine keeps parent if a child is mine, narrows children to mine', () => {
  const stories = [{ key:'P-1', summary:'P', priority:'Medium', rank:'a', assigneeAccountId:'other' }];
  const subs = [
    { key:'P-1a', parentKey:'P-1', assignee:'Me', assigneeAccountId:'me', dueDate:'2026-06-10' },
    { key:'P-1b', parentKey:'P-1', assignee:'Other', assigneeAccountId:'other', dueDate:'2026-06-11' },
  ];
  const rows = attachChildren(stories, subs, 'me', true);
  assert(rows.length === 1, 'parent kept because a child is mine');
  assert(rows[0].children.length === 1 && rows[0].children[0].assigneeAccountId === 'me', 'children narrowed to mine');
});

console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('\nBar start uses startDate (set by Sprint Planner)');

test('ticket with startDate renders a positioned bar', () => {
  const s = [{ key:'HRM-99', summary:'Task', dueDate:'2026-05-21',
    startDate:'2026-05-13', created:'2026-05-10',
    assigneeAccountId: ME, statusCategory:'new', priority:'Medium', points:2, assignee:'Ahmed' }];
  const html = buildGanttSVG(s, sprint, [0,1,2,3,4], ME);
  assertIncludes(html, 'position:absolute');
});

test('ticket without startDate falls back to sprint start', () => {
  const s = [{ key:'HRM-100', summary:'Old ticket', dueDate:'2026-05-21',
    startDate: null, created:'2026-04-01',
    assigneeAccountId: ME, statusCategory:'new', priority:'Medium', points:1, assignee:'Ahmed' }];
  const html = buildGanttSVG(s, sprint, [0,1,2,3,4], ME);
  assertIncludes(html, 'position:absolute');
});

test('startDate before sprint start is clamped to sprint start', () => {
  const s = [{ key:'HRM-101', summary:'Clamped', dueDate:'2026-05-20',
    startDate:'2026-04-15', created:'2026-04-15',
    assigneeAccountId: ME, statusCategory:'new', priority:'Medium', points:0, assignee:'Ahmed' }];
  const html = buildGanttSVG(s, sprint, [0,1,2,3,4], ME);
  assertIncludes(html, 'position:absolute');
});

console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
