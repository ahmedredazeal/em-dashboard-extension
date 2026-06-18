/**
 * src/mock-data.js — Zealer Dashboard
 *
 * Generates a complete mock state for Demo Mode. All dates are computed
 * relative to "today" so the sprint always appears currently in progress.
 * Engineer mode uses accountId "mock-acc-ahmed" as the "me" user.
 */

const d = (offset) => {
  const dt = new Date();
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

// Sprint: starts 8 days ago, ends 5 days from now
const SPRINT_START = d(-8);
const SPRINT_END   = d(5);

const TEAM = [
  { accountId: 'mock-acc-ahmed', name: 'Ahmed Reda',   email: 'ahmed@example.com' },
  { accountId: 'mock-acc-sara',  name: 'Sara Hassan',  email: 'sara@example.com'  },
  { accountId: 'mock-acc-omar',  name: 'Omar Farouk',  email: 'omar@example.com'  },
  { accountId: 'mock-acc-nour',  name: 'Nour Khalil',  email: 'nour@example.com'  },
  { accountId: 'mock-acc-layla', name: 'Layla Mostafa',email: 'layla@example.com' },
];

// Sprint stories — sorted by priority then rank (lexorank ascending = lower string = higher rank)
const STORIES = [
  { key:'DEMO-1',  summary:'Auth service migration',          priority:'Highest', points:8,  assignee:'Ahmed Reda',    assigneeAccountId:'mock-acc-ahmed', statusCategory:'done',          dueDate:d(-3), startDate:d(-8), rank:'0|i0000:', closedDay:3,  closedAt:new Date(Date.now()-5*86400000).toISOString() },
  { key:'DEMO-2',  summary:'Payment gateway integration',     priority:'Highest', points:13, assignee:'Sara Hassan',   assigneeAccountId:'mock-acc-sara',  statusCategory:'done',          dueDate:d(-1), startDate:d(-8), rank:'0|i0001:', closedDay:6,  closedAt:new Date(Date.now()-2*86400000).toISOString() },
  { key:'DEMO-3',  summary:'Fix critical checkout bug',       priority:'High',    points:5,  assignee:'Omar Farouk',   assigneeAccountId:'mock-acc-omar',  statusCategory:'done',          dueDate:d(-4), startDate:d(-7), rank:'0|i0002:', closedDay:2,  closedAt:new Date(Date.now()-6*86400000).toISOString() },
  { key:'DEMO-4',  summary:'API rate limiting',               priority:'High',    points:3,  assignee:'Ahmed Reda',    assigneeAccountId:'mock-acc-ahmed', statusCategory:'done',          dueDate:d(-2), startDate:d(-6), rank:'0|i0003:', closedDay:4,  closedAt:new Date(Date.now()-4*86400000).toISOString() },
  { key:'DEMO-5',  summary:'Database indexing optimization',  priority:'High',    points:5,  assignee:'Sara Hassan',   assigneeAccountId:'mock-acc-sara',  statusCategory:'indeterminate', dueDate:d(2),  startDate:d(-3), rank:'0|i0004:', closedDay:null },
  { key:'DEMO-6',  summary:'User session management',         priority:'High',    points:3,  assignee:'Nour Khalil',   assigneeAccountId:'mock-acc-nour',  statusCategory:'done',          dueDate:d(-3), startDate:d(-7), rank:'0|i0005:', closedDay:3,  closedAt:new Date(Date.now()-5*86400000).toISOString() },
  { key:'DEMO-7',  summary:'Error handling improvements',     priority:'Medium',  points:3,  assignee:'Ahmed Reda',    assigneeAccountId:'mock-acc-ahmed', statusCategory:'indeterminate', dueDate:d(3),  startDate:d(-1), rank:'0|i0006:', closedDay:null },
  { key:'DEMO-8',  summary:'Mobile responsive fixes',         priority:'Medium',  points:2,  assignee:'Layla Mostafa', assigneeAccountId:'mock-acc-layla', statusCategory:'indeterminate', dueDate:d(4),  startDate:d(-2), rank:'0|i0007:', closedDay:null },
  { key:'DEMO-9',  summary:'Notification service',            priority:'Medium',  points:5,  assignee:'Omar Farouk',   assigneeAccountId:'mock-acc-omar',  statusCategory:'indeterminate', dueDate:d(5),  startDate:d(0),  rank:'0|i0008:', closedDay:null },
  { key:'DEMO-10', summary:'Admin dashboard widgets',         priority:'Medium',  points:3,  assignee:'Nour Khalil',   assigneeAccountId:'mock-acc-nour',  statusCategory:'new',           dueDate:d(4),  startDate:d(1),  rank:'0|i0009:', closedDay:null },
  { key:'DEMO-11', summary:'Email templates redesign',        priority:'Medium',  points:2,  assignee:'Layla Mostafa', assigneeAccountId:'mock-acc-layla', statusCategory:'new',           dueDate:d(5),  startDate:d(2),  rank:'0|i000a:', closedDay:null },
  { key:'DEMO-12', summary:'Export to CSV feature',           priority:'Low',     points:3,  assignee:null,            assigneeAccountId:null,             statusCategory:'new',           dueDate:d(5),  startDate:d(3),  rank:'0|i000b:', closedDay:null },
  { key:'DEMO-13', summary:'Dark mode toggle',                priority:'Low',     points:2,  assignee:'Ahmed Reda',    assigneeAccountId:'mock-acc-ahmed', statusCategory:'new',           dueDate:d(5),  startDate:d(3),  rank:'0|i000c:', closedDay:null },
  { key:'DEMO-14', summary:'Performance profiling',           priority:'Low',     points:1,  assignee:'Sara Hassan',   assigneeAccountId:'mock-acc-sara',  statusCategory:'new',           dueDate:null,  startDate:null,  rank:'0|i000d:', closedDay:null },
  { key:'DEMO-15', summary:'Documentation updates',           priority:'Lowest',  points:1,  assignee:'Omar Farouk',   assigneeAccountId:'mock-acc-omar',  statusCategory:'new',           dueDate:null,  startDate:null,  rank:'0|i000e:', closedDay:null },
].map(s => ({
  ...s,
  status: s.statusCategory === 'done' ? 'Done' : s.statusCategory === 'indeterminate' ? 'In Progress' : 'To Do',
  type: 'Story', labels: [],
}));

const COMMITTED_PTS = STORIES.reduce((n, s) => n + s.points, 0); // 59
const DONE_PTS = STORIES.filter(s => s.statusCategory === 'done').reduce((n, s) => n + s.points, 0); // 29

const TOTAL_DAYS = 14; // calendar days from start to end
const TODAY_IDX  = 8;  // d(-8) + 8 = today

// Burndown: remaining pts per calendar day (plain number arrays, as buildBurndownSVG expects)
// ideal/estimate: full series 0..TOTAL_DAYS, actual: only elapsed days (0..TODAY_IDX)
const BD_IDEAL_NUMS = Array.from({length:TOTAL_DAYS+1}, (_, i) =>
  Math.round(COMMITTED_PTS - COMMITTED_PTS * (i / TOTAL_DAYS)));
const BD_ESTIMATE_NUMS = [...BD_IDEAL_NUMS];
// Actual remaining per day: burndowns as tickets close
// Day 0-2: no completions. Day 3: DEMO-3 done (-5). Day 5: DEMO-6 (-3). Day 6: DEMO-4 (-3). Day 7: DEMO-1 (-8). Day 8 (today): DEMO-2 (-13).
const BD_ACTUAL_NUMS = [59,59,59,54,54,51,48,40,27];
const BD_LABELS  = Array.from({length:TOTAL_DAYS+1}, (_, i) => {
  const dt = new Date(SPRINT_START + 'T00:00:00');
  dt.setDate(dt.getDate() + i);
  return `${dt.getDate()}/${dt.getMonth()+1}`;
});

const MOCK_BURNDOWN = {
  ideal:          BD_IDEAL_NUMS,
  estimate:       BD_ESTIMATE_NUMS,
  actual:         BD_ACTUAL_NUMS,
  labels:         BD_LABELS,
  totalPoints:    COMMITTED_PTS,
  committedPoints:COMMITTED_PTS,
  totalDays:      TOTAL_DAYS,
  todayIndex:     TODAY_IDX,
  hasActualData:  true,
  perDayData:     BD_IDEAL_NUMS.map((ideal, i) => ({
    day: i, ideal, estimate: ideal,
    actual: BD_ACTUAL_NUMS[i] ?? null,
    completedDelta: i > 0 && BD_ACTUAL_NUMS[i] != null && BD_ACTUAL_NUMS[i-1] != null
      ? BD_ACTUAL_NUMS[i-1] - BD_ACTUAL_NUMS[i] : 0,
    scopeNet: 0,
  })),
};

// Timesheet members (sprint) — `estimated` = total hours estimated for the sprint
const MOCK_TIMESHEET = [
  { accountId:'mock-acc-ahmed', name:'Ahmed Reda',    total:18, estimated:20, byProject:{DEMO:18}, byDate:{[d(-6)]:3,[d(-5)]:4,[d(-4)]:3,[d(-3)]:4,[d(-2)]:2,[d(-1)]:2}, tickets:['DEMO-1','DEMO-4','DEMO-7'] },
  { accountId:'mock-acc-sara',  name:'Sara Hassan',   total:24, estimated:22, byProject:{DEMO:24}, byDate:{[d(-8)]:4,[d(-7)]:5,[d(-6)]:4,[d(-5)]:4,[d(-4)]:4,[d(-3)]:3}, tickets:['DEMO-2','DEMO-5']         },
  { accountId:'mock-acc-omar',  name:'Omar Farouk',   total:10, estimated:14, byProject:{DEMO:10}, byDate:{[d(-7)]:3,[d(-6)]:4,[d(-5)]:3},                                 tickets:['DEMO-3','DEMO-9']         },
  { accountId:'mock-acc-nour',  name:'Nour Khalil',   total:8,  estimated:10, byProject:{DEMO:8},  byDate:{[d(-7)]:2,[d(-6)]:3,[d(-5)]:3},                                 tickets:['DEMO-6','DEMO-10']        },
  { accountId:'mock-acc-layla', name:'Layla Mostafa', total:4,  estimated:8,  byProject:{DEMO:4},  byDate:{[d(-3)]:2,[d(-2)]:2},                                            tickets:['DEMO-8','DEMO-11']        },
];

const MOCK_SPRINT = {
  id: 'demo-sprint-001',
  name: 'DEMO Sprint 1',
  boardId: 'demo-board',
  boardName: 'DEMO Board',
  startDate: SPRINT_START + 'T09:00:00.000+0300',
  endDate:   SPRINT_END   + 'T18:00:00.000+0300',
  totalStories: STORIES.length,
  completedStories: STORIES.filter(s => s.statusCategory === 'done').length,
  totalPoints:     COMMITTED_PTS,
  completedPoints: DONE_PTS,
  committedPoints: COMMITTED_PTS,
  totalDays:    TOTAL_DAYS,
  daysElapsed:  TODAY_IDX + 1,
  todayIndex:   TODAY_IDX,
  scopeByDay:   {},
  stories:      STORIES,
  subtasks: [
    { key:'DEMO-5a', summary:'DB index migration script', status:'Done', statusCategory:'done',
      assignee:'Sara Hassan', assigneeAccountId:'mock-acc-sara', priority:'High', points:0,
      type:'Sub-task', isSubtask:true, parentKey:'DEMO-5', dueDate:d(0), startDate:d(-3), rank:'0|i0004:a', labels:[] },
    { key:'DEMO-5b', summary:'Verify query plans on staging', status:'In Progress', statusCategory:'indeterminate',
      assignee:'Sara Hassan', assigneeAccountId:'mock-acc-sara', priority:'High', points:0,
      type:'Sub-task', isSubtask:true, parentKey:'DEMO-5', dueDate:d(2), startDate:d(-1), rank:'0|i0004:b', labels:[] },
  ],
};

const MOCK_ANALYTICS = {
  burndown: MOCK_BURNDOWN,
  timesheet: MOCK_TIMESHEET,
  issueTypeSplit: { Story:11, Bug:3, Task:1 },
  sprintId: 'demo-sprint-001',
  totalDays: TOTAL_DAYS,
  startDate: SPRINT_START,
  endDate:   SPRINT_END,
};

const MOCK_SPRINT_HISTORY = [
  { name:'DEMO Sprint -2', startDate:d(-42), endDate:d(-29), completedPoints:48, committedPoints:55, totalPoints:55 },
  { name:'DEMO Sprint -1', startDate:d(-28), endDate:d(-15), completedPoints:55, committedPoints:60, totalPoints:60 },
];

const MOCK_SENTRY_VIEWS = [
  { viewId:'demo-sentry-001', label:'Demo Issues',    issues:[], count:142, error:null },
  { viewId:'demo-sentry-002', label:'Demo BE Issues', issues:[], count:23,  error:null },
];

// Trend samples in the REAL shape getTrendSamples returns: [{day:"YYYY-MM-DD", count:N}].
// 14 days each; the first view spikes in the last few days so the
// sentry_trend_spike alert has something to chew on.
const MOCK_SENTRY_TREND_SAMPLES = {
  'demo-sentry-001': Array.from({ length: 14 }, (_, i) => ({
    day: d(-13 + i),
    count: 96 + (i % 4) * 3 + (i >= 11 ? 32 : 0),   // ~96-105, jumps to ~140 at the end
  })),
  'demo-sentry-002': Array.from({ length: 14 }, (_, i) => ({
    day: d(-13 + i),
    count: 20 + (i % 3),                              // steady 20-22
  })),
};


// Milestones (OKRs / Dev Plans) — backlog tickets grouped by label.
// DEMO-7 is also in the sprint stories above, so it demos the "IN SPRINT" badge.
const mkMs = (key, summary, cat, assignee, accId, label, due = null) => ({
  key, summary,
  status: cat === 'done' ? 'Done' : cat === 'indeterminate' ? 'In Progress' : 'To Do',
  statusCategory: cat, assignee, assigneeAccountId: accId,
  priority: 'Medium', points: 0, type: 'Task', dueDate: due, startDate: null, rank: null,
  labels: [label],
});
const MOCK_MILESTONES = [
  {
    label: 'okr-q2-retention',
    name: 'Q2 Retention OKR',
    leapsomeUrl: 'https://app.leapsome.com/goals/demo',
    tickets: [
      mkMs('DEMO-21', 'Churn analysis dashboard',        'done',          'Sara Hassan',   'mock-acc-sara',  'okr-q2-retention'),
      mkMs('DEMO-22', 'Win-back email campaign flow',    'done',          'Nour Khalil',   'mock-acc-nour',  'okr-q2-retention'),
      { ...STORIES.find(s => s.key === 'DEMO-7'), labels: ['okr-q2-retention'] },
      mkMs('DEMO-23', 'Retention cohort tracking',       'new',           'Omar Farouk',   'mock-acc-omar',  'okr-q2-retention', d(9)),
      mkMs('DEMO-24', 'Exit-survey integration',         'new',           null,            null,             'okr-q2-retention'),
    ],
  },
  {
    label: 'dev-plan-ahmed',
    name: 'Ahmed Dev Plan',
    leapsomeUrl: null,
    tickets: [
      mkMs('DEMO-31', 'Lead architecture review session','done',          'Ahmed Reda',    'mock-acc-ahmed', 'dev-plan-ahmed'),
      mkMs('DEMO-32', 'Mentor junior on testing',        'indeterminate', 'Ahmed Reda',    'mock-acc-ahmed', 'dev-plan-ahmed'),
      mkMs('DEMO-33', 'Public talk: MV3 extensions',     'new',           'Ahmed Reda',    'mock-acc-ahmed', 'dev-plan-ahmed', d(20)),
    ],
  },
];

export const MOCK_CURRENT_USER = {
  accountId:    'mock-acc-ahmed',
  displayName:  'Ahmed Reda',
  emailAddress: 'ahmed@demo.com',
};

// Support board tickets — 3 assigned to "me" (Ahmed Reda)
const SUPPORT_TICKETS = [
  { key:'SUP-1', summary:'Login page not loading for some users',   status:'Open',         statusCategory:'new',          labels:['blocked-external'], assignee:'Ahmed Reda',    assigneeAccountId:'mock-acc-ahmed', points:0 },
  { key:'SUP-2', summary:'Payment fails for AMEX cards',            status:'In Progress',  statusCategory:'indeterminate', labels:[],                   assignee:'Omar Farouk',   assigneeAccountId:'mock-acc-omar',  points:0 },
  { key:'SUP-3', summary:'Export CSV returns empty file',           status:'In Progress',  statusCategory:'indeterminate', labels:[],                   assignee:'Ahmed Reda',    assigneeAccountId:'mock-acc-ahmed', points:0 },
  { key:'SUP-4', summary:'Dashboard charts not loading on Safari',  status:'QA Testing',   statusCategory:'indeterminate', labels:[],                   assignee:'Nour Khalil',   assigneeAccountId:'mock-acc-nour',  points:0 },
  { key:'SUP-5', summary:'Mobile app crashes on startup (iOS 17)',  status:'Open',         statusCategory:'new',          labels:['blocked-external'], assignee:null,             assigneeAccountId:null,             points:0 },
  { key:'SUP-6', summary:'Notification emails not being sent',      status:'Code Review',  statusCategory:'indeterminate', labels:[],                   assignee:'Sara Hassan',   assigneeAccountId:'mock-acc-sara',  points:0 },
  { key:'SUP-7', summary:'Reports show incorrect date range',       status:'Open',         statusCategory:'new',          labels:[],                   assignee:'Ahmed Reda',    assigneeAccountId:'mock-acc-ahmed', points:0 },
  { key:'SUP-8', summary:'Two-factor auth loop on mobile',          status:'QA Rejected',  statusCategory:'indeterminate', labels:[],                   assignee:'Layla Mostafa', assigneeAccountId:'mock-acc-layla', points:0 },
  { key:'SUP-9', summary:'API timeout on large data exports',       status:'Open',         statusCategory:'new',          labels:['blocked-external'], assignee:'Sara Hassan',   assigneeAccountId:'mock-acc-sara',  points:0 },
].map(s => ({ ...s, type:'Bug', dueDate:null, startDate:null, rank:null, priority:'Medium' }));

/**
 * Returns a complete state snapshot for demo mode.
 * @param {Object} settings — the real settings (role is read to pick the right mock profile)
 */
export function generateMockState(settings) {
  return {
    currentSprint:     MOCK_SPRINT,
    sprintHistory:     MOCK_SPRINT_HISTORY,
    sprintAnalytics:   MOCK_ANALYTICS,
    sentryIssues:      [],
    sentryViews:       MOCK_SENTRY_VIEWS,
    sentryTrendSamples:MOCK_SENTRY_TREND_SAMPLES,
    supportTickets:    SUPPORT_TICKETS,
    milestonesData:    MOCK_MILESTONES,
    extraBoardsData:   [{
      boardId:    999,
      boardLabel: 'Support Board',
      boardName:  'Support Board',
      stories:    SUPPORT_TICKETS,
    }],
    currentUser:       MOCK_CURRENT_USER,
    isLoading:         false,
  };
}

export { TEAM as MOCK_TEAM };

// ── Monthly report demo data (T-RPT-1) ───────────────────────────────────────
// A few finalized months + an in-progress current month, so the report viewer
// is fully demoable in Demo/Mock Mode.
export function generateMockReportStore() {
  const ENG = {
    'mock-acc-ahmed': 'Ahmed Reda',
    'mock-acc-sara':  'Sara Hassan',
    'mock-acc-omar':  'Omar Farouk',
    'mock-acc-nour':  'Nour Khalil',
  };
  function finalized(month, seed) {
    const hoursByEng = {};
    Object.keys(ENG).forEach((acc, i) => {
      hoursByEng[acc] = 110 + ((seed * 7 + i * 13) % 50);
    });
    // Bug/support counts are squad-level (not derived from individuals).
    const bugsOpened = 9 + (seed % 5);
    const bugsResolved = 11 + (seed % 4);
    const totalHours = Object.values(hoursByEng).reduce((a, h) => a + h, 0);
    const byEngineer = Object.fromEntries(Object.entries(hoursByEng).map(([a, h]) => [a, { hours: h }]));
    return {
      month, partial: false, squad: 'HRM', observedDays: 20,
      finalizedAt: `${month}-28T18:00:00.000Z`, hoursAvailable: true,
      appVersion: 'demo',
      sprintsClosed: [
        { name: `Sprint ${seed * 2 + 40}`, committedPts: 34, completedPts: 30 + (seed % 5), velocity: 30 + (seed % 5), completionPct: Math.round(((30 + (seed % 5)) / 34) * 100) },
        { name: `Sprint ${seed * 2 + 41}`, committedPts: 38, completedPts: 33 + (seed % 4), velocity: 33 + (seed % 4), completionPct: Math.round(((33 + (seed % 4)) / 38) * 100) },
      ],
      derived: {
        totalHours, hoursAvailable: true,
        perEngineerHours: { ...hoursByEng },
        bugsOpened, bugsResolved, netBugFlow: bugsOpened - bugsResolved,
        byEngineer,
        supportOpened: 12 + (seed % 6), supportClosed: 11 + (seed % 7),
        openBugsStart: 18 - seed, openBugsEnd: 16 - seed, medianBugAgeEnd: 6 + (seed % 5),
        velocityAvg: 31 + (seed % 4), completionPctAvg: 86 + (seed % 8), sprintCount: 2,
      },
    };
  }
  // Build last 4 finalized months relative to "now".
  const now = new Date();
  const history = {};
  for (let back = 4; back >= 1; back--) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    history[key] = finalized(key, back);
  }
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const current = {
    month: curKey, partial: false, squad: 'HRM', observedDays: Math.max(1, now.getDate() - 1),
    startedAt: `${curKey}-01T09:00:00.000Z`, appVersion: 'demo',
    daily: {
      [`${curKey}-02`]: { bugsOpened: 2, bugsResolved: 1, supportOpened: 1, supportClosed: 2 },
      [`${curKey}-03`]: { bugsOpened: 1, bugsResolved: 3, supportOpened: 0, supportClosed: 1 },
    },
    stateFirst: { openBugs: 15, medianBugAge: 7, capturedAt: `${curKey}-02T09:00:00.000Z` },
    stateLatest: { openBugs: 13, medianBugAge: 8, capturedAt: `${curKey}-03T09:00:00.000Z` },
    sprintsClosed: [],
  };
  return { schemaVersion: 1, currentMonth: curKey, current, history, retentionMonths: 12 };
}

// ── Calendar demo data (T-CAL-1) ─────────────────────────────────────────────
// A few meetings around "now" so the Today card + countdown + 30-min alert demo
// without a real ICS calendar. One meeting is within 30 minutes to show the alert
// state; one is in progress; one all-day.
export function generateMockMeetings(now = new Date()) {
  const at = (offsetMin, durMin) => {
    const s = new Date(now.getTime() + offsetMin * 60000);
    const e = new Date(s.getTime() + durMin * 60000);
    return { start: s.toISOString(), end: e.toISOString() };
  };
  const mk = (id, title, offsetMin, durMin, extra = {}) => ({
    id, title, ...at(offsetMin, durMin), allDay: false, location: '', attendeesCount: 3, ...extra,
  });
  const timed = [
    mk('m-inprog', 'Sprint standup', -10, 15, { attendeesCount: 6 }),          // in progress
    mk('m-soon', 'Design review', 20, 45, { attendeesCount: 4 }),              // within 30m → alert
    mk('m-later', '1:1 with manager', 150, 30, { attendeesCount: 2 }),         // later today
  ].sort((a, b) => new Date(a.start) - new Date(b.start));
  const allDay = [
    { id: 'm-allday', title: 'Release freeze', start: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(), end: null, allDay: true, location: '', attendeesCount: 0 },
  ];
  // next = the in-progress one is "next" only if nothing upcoming; here Design
  // review is upcoming, so the core's pickNext returns it. We let the popup
  // recompute via todaysMeetings to keep one source of truth.
  return { timed, allDay };
}
