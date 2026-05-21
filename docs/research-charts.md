# Research: Burndown + Timesheet Charts

## Chart 1: Burndown — 3 series

| Series | Source | API calls |
|---|---|---|
| **Ideal** | Computed: `totalPoints / totalDays × dayN` | 0 — already have sprint data |
| **Estimate-based** | Computed from existing story `dueDate` + `points` fields | 0 — already in `currentSprint.stories` |
| **Actual** | Each story's transition-to-done timestamp from Jira changelog | 1 call per sprint with `expand=changelog` |

### Actual line — confirmed API
```
POST /rest/api/3/search/jql
{
  "jql": "sprint = 64",
  "fields": ["summary","status","customfield_10016","duedate"],
  "expand": ["changelog"],
  "maxResults": 100
}
```

Response per issue contains:
```json
"changelog": {
  "histories": [
    {
      "created": "2026-05-12T14:30:22Z",
      "items": [
        { "field": "status", "fromString": "In Progress", "toString": "QA Accepted" }
      ]
    }
  ]
}
```

**Algorithm:** find the last history item where `field = status` and `toString` is in done-category. That timestamp is when the story closed. Bucket by sprint day, sum points → daily actual.

**Cost:** ONE search call per sprint (we already make this call — just need to add `expand: ['changelog']`).

---

## Chart 2: Timesheet — week1 / week2 per member

### Data needed
For each sprint issue, every worklog entry has:
- `author.displayName`
- `started` (timestamp)
- `timeSpentSeconds`

### API options

**Option A — One call per issue:**
```
GET /rest/api/3/issue/{key}/worklog
```
Pros: complete, official. Cons: 1 call per ticket → ~30-50 calls per sprint.

**Option B — JQL `worklogDate` filter + expand:**
```
POST /rest/api/3/search/jql
{
  "jql": "sprint = 64 AND worklogDate >= '2026-05-05'",
  "fields": ["worklog","summary"],
  "maxResults": 100
}
```
Returns worklog summary inline. But worklog field returns only ~20 most recent entries (paginated).

**Decision:** use Option B as primary. If a ticket has > 20 worklogs, fall back to Option A for that ticket only.

**Cost:** 1 search call + occasional per-ticket calls (rare).

### Work week handling

Sprint = 2 weeks. User's working days = configurable (default Sun–Thu).
- Week 1 = `[sprintStart, sprintStart + 7 days]`
- Week 2 = `[sprintStart + 7 days, sprintEnd]`
- For each worklog, check if `started` falls in week 1 or week 2 AND `started.dayOfWeek` is a working day.

---

## Cache Strategy

### Storage
```
chrome.storage.local: {
  sprintCache: {
    "HRM Sprint 64": {
      sprintId: 64,
      sprintName: "HRM Sprint 64",
      cachedAt: 1747500000000,
      burndown: { ideal: [...], estimate: [...], actual: [...] },
      timesheet: { "Ahmed": { week1: 18.5, week2: 12.0 }, ... }
    },
    "HRM Sprint 63": { ... }
  }
}
```

### Sprint change detection
On every fetch, compare incoming `currentSprint.name` to cached sprint names.
- If a cached sprint is no longer the active one → show prompt:
  > "Sprint 'HRM Sprint 63' is no longer active. Keep its data for history, or delete?"
  - **Keep** → leave in cache
  - **Delete** → remove from cache

### Settings additions
1. **Work week toggle** — checkbox grid Sun/Mon/Tue/Wed/Thu/Fri/Sat (default Sun-Thu)
2. **Sprint cache manager** — list of cached sprints with size + "Delete" button each + "Delete all"

---

## Rate limit / performance check

Jira Cloud: 10 req/sec per IP, ~5000/hour per user.

Per sprint refresh:
- 1 call: search with changelog + worklog (already needed)
- ~5 fallback calls for tickets with > 20 worklogs (worst case)
- Total: **~6 calls per refresh**

Refreshes happen on panel open + manual ↻. Fine for 5000/hr limit.

---

## Chart rendering

### Constraint
Manifest V3 + CSP: no eval, no inline scripts.

### Options
| Library | Size | CSP-safe |
|---|---|---|
| Chart.js | ~80KB | ✅ (DOM only) |
| Plain SVG | 0KB | ✅ |
| D3 | ~280KB | ✅ |

### Decision
**Plain SVG**. We only need 2 chart types, both simple. Vanilla SVG keeps the extension small and gives us full control over theming (CSS variables).

---

## Files to create / modify

### New
- `src/changelog-parser.js` — extract transition timestamps from `expand=changelog`
- `src/burndown.js` — compute the 3 series
- `src/timesheet.js` — group worklogs by member + week
- `src/sprint-cache.js` — read/write/clear chart data per sprint
- `src/chart-svg.js` — render burndown line chart + grouped bar chart
- `tests/burndown.test.js`, `tests/timesheet.test.js` — pure-function tests

### Modified
- `src/jira-api.js` — `getSprintStories` accepts `expand` param; new `getIssueWorklogs(key)`
- `background.js` — fetch with `expand=['changelog']`, compute series, save to cache
- `popup.js` — render charts in Today screen, sprint-change prompt UI
- `popup.html` — new sections for charts
- `settings.html` + `settings.js` — work-week toggle + sprint cache manager
- `TASKS.md` — claim and update task list

---

## Implementation phases

1. **Phase 1** (~1.5h)
   - changelog-parser + burndown logic
   - Tests pass without touching popup
2. **Phase 2** (~1h)
   - Worklog fetching + timesheet computation
   - Tests
3. **Phase 3** (~1.5h)
   - SVG chart renderer
   - Wire into Today screen
4. **Phase 4** (~1h)
   - Cache layer + sprint-change prompt
   - Settings: work week + cache manager
5. **Phase 5** (~30m)
   - Docs, CHANGELOG, version bump, push

Total: ~5.5 hours of work spread across small commits.
