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

// Burndown: remaining pts per calendar day (0-based)
const BD_ACTUAL  = [59,59,59,54,54,51,48,27,27,null,null,null,null,null]; // closings at days 2,4,5,6
const BD_IDEAL   = Array.from({length:TOTAL_DAYS+1}, (_, i) => +(59 - 59 * i / TOTAL_DAYS).toFixed(1));
const BD_LABELS  = Array.from({length:TOTAL_DAYS+1}, (_, i) => {
  const dt = new Date(SPRINT_START + 'T00:00:00');
  dt.setDate(dt.getDate() + i);
  return `${dt.getDate()}/${dt.getMonth()+1}`;
});

const MOCK_BURNDOWN = {
  ideal:          BD_IDEAL.map((pts, day) => ({ day, pts })),
  estimate:       BD_IDEAL.map((pts, day) => ({ day, pts })),
  actual:         BD_ACTUAL.filter(v => v !== null).map((pts, day) => ({ day, pts })),
  labels:         BD_LABELS,
  totalPoints:    COMMITTED_PTS,
  committedPoints:COMMITTED_PTS,
  totalDays:      TOTAL_DAYS,
  todayIndex:     TODAY_IDX,
  hasActualData:  true,
  perDayData:     BD_ACTUAL.map((v, i) => ({ day:i, actual:v??0, ideal:BD_IDEAL[i], completedDelta:0, scopeNet:0 })),
};

// Timesheet members (sprint)
const MOCK_TIMESHEET = [
  { accountId:'mock-acc-ahmed', name:'Ahmed Reda',    total:18, byProject:{DEMO:18}, byDate:{[d(-6)]:3,[d(-5)]:4,[d(-4)]:3,[d(-3)]:4,[d(-2)]:2,[d(-1)]:2}, tickets:['DEMO-1','DEMO-4','DEMO-7'] },
  { accountId:'mock-acc-sara',  name:'Sara Hassan',   total:24, byProject:{DEMO:24}, byDate:{[d(-8)]:4,[d(-7)]:5,[d(-6)]:4,[d(-5)]:4,[d(-4)]:4,[d(-3)]:3}, tickets:['DEMO-2','DEMO-5']         },
  { accountId:'mock-acc-omar',  name:'Omar Farouk',   total:10, byProject:{DEMO:10}, byDate:{[d(-7)]:3,[d(-6)]:4,[d(-5)]:3},                                 tickets:['DEMO-3','DEMO-9']         },
  { accountId:'mock-acc-nour',  name:'Nour Khalil',   total:8,  byProject:{DEMO:8},  byDate:{[d(-7)]:2,[d(-6)]:3,[d(-5)]:3},                                 tickets:['DEMO-6','DEMO-10']        },
  { accountId:'mock-acc-layla', name:'Layla Mostafa', total:4,  byProject:{DEMO:4},  byDate:{[d(-3)]:2,[d(-2)]:2},                                            tickets:['DEMO-8','DEMO-11']        },
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

const MOCK_SENTRY_TREND_SAMPLES = {
  'demo-sentry-001': [
    { date: d(-6), count: 98  },
    { date: d(-5), count: 101 },
    { date: d(-4), count: 97  },
    { date: d(-3), count: 112 },
    { date: d(-2), count: 138 },
    { date: d(-1), count: 142 },
  ],
  'demo-sentry-002': [
    { date: d(-6), count: 21 },
    { date: d(-5), count: 22 },
    { date: d(-4), count: 23 },
    { date: d(-3), count: 22 },
    { date: d(-2), count: 23 },
    { date: d(-1), count: 23 },
  ],
};

export const MOCK_CURRENT_USER = {
  accountId:    'mock-acc-ahmed',
  displayName:  'Ahmed Reda',
  emailAddress: 'ahmed@demo.com',
};

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
    supportTickets:    [],
    extraBoardsData:   [],
    currentUser:       MOCK_CURRENT_USER,
    isLoading:         false,
  };
}

export { TEAM as MOCK_TEAM };
