# Zealer Dashboard — Chrome Extension

Engineering Manager + Engineer cockpit for Jira + Sentry. Sprint health, reliability, time tracking and alert rules in a Chrome side panel. Dual-role architecture serves both EMs and individual engineers from a single extension.

**Current version: v2.0.0**

---

## Features

### Dual-role mode (EM / Engineer)
First launch prompts you to choose your role. Role is persisted and can be changed in Settings at any time.

| Feature | EM mode | Engineer mode |
|---|---|---|
| Sprint tickets | Full squad, engineers DDL filter | Me / Squad toggle, "Me" default |
| Time tracking | Full squad, engineers DDL filter | Me / Squad toggle, "Me" default |
| Estimate vs Actual | Full squad | Me / Squad toggle |
| Extra boards (support) | Full squad | Me / Squad toggle |
| **Progress circles** | Not shown | Two personal donuts: sprint (pts by status) + support (ticket count); hidden if no assignments |
| Burndown chart | Team — unchanged | Team — unchanged |
| Sprint progress | Team — unchanged | Team — unchanged |
| Sentry trend | Configured views — unchanged | Configured views — unchanged |

### Alert rules — fully configurable in Settings

Open Settings → Alert rules to enable/disable each rule, tune thresholds (scope-creep %, stalled days, Sentry spike delta/%), and control per-rule desktop notifications independently. A Reset to defaults button restores the original hardcoded values.

### Alert rules (9 — all grounded in real data)
| Rule | Fires when |
|---|---|
| `sprint_goal_at_risk` | Working-day-aware burndown projects a shortfall vs committed baseline |
| `scope_creep` | Points added after kickoff exceed 10% of committed |
| `stalled_burndown` | No points completed in the last 2+ working days |
| `due_date_risk` | Open pointed tickets are due before sprint end |
| `unassigned_work` | Open pointed tickets have no assignee |
| `reopened_tickets` | A ticket that reached Done moved back to open |
| `sentry_trend_spike` | Day-over-day count increase ≥10 issues or ≥25% in a Sentry view |
| `velocity_drop` | >15% velocity drop for 2 consecutive sprints _(gated: needs ≥3 sprints)_ |
| `support_sla_breach` | Support ticket past SLA _(gated: needs support board data)_ |

### Analytics (Insights section)
- **Sentry trend chart** — 7-day issue-count trend per view (above filtered charts)
- **Burndown chart** — committed-baseline burndown with colored segments (green=done, amber=added, blue=removed) and hover tooltips
- **Sprint progress bar** — status-breakdown mini bar with risk pills
- **Time logged** — per-member horizontal bar chart with sprint / quarterly mode
- **Estimate vs Actual** — hours comparison, synced to time-logged mode

### Today screen section order
Alerts → Insights → Extra boards → Sentry Issues → Current Sprint

### Settings
- Role section at the top (EM / Engineer pills, saves instantly)
- **EM mode** shows: squad member management (curated list, stops auto-discovery), extra boards config
- **Engineer mode** hides EM-only sections
- Time span filter shared between both roles

---

### Launch splash

A branded splash (navy, cap icon, water-ripple animation, then the wordmark) plays once per browser session on first open. DM Sans is bundled; to render "Zealer" in Nohemi, add a licensed `fonts/Nohemi-SemiBold.woff2` (see `fonts/README.md`).

## Installation

1. Clone the repo: `git clone https://github.com/ahmedredazeal/em-dashboard-extension`
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `em-dashboard-extension` folder
5. The Zealer Dashboard icon appears in your toolbar or side panel

## First-time setup

1. Click the toolbar icon — you'll see the **Hello, Zealer!** welcome screen
2. Pick your role (Engineering Manager or Engineer)
3. Click **Go to Settings →** and fill in:
   - **Jira**: base URL (`https://yourco.atlassian.net`), email, and API token
   - **Sentry**: org slug, base URL, and auth token
   - **Squad**: project key (e.g. `HRM`), any extra boards (format: `Name|BoardID`)
4. Save → dashboard loads automatically

API token links:
- Jira: [id.atlassian.com/manage/api-tokens](https://id.atlassian.com/manage/api-tokens)
- Sentry: Settings → Account → API → Auth Tokens (needs `org:read event:read`)

---

### Sprint Timeline (Gantt)

Sprint Planner-style timeline of the active sprint: stories, tasks, and subtasks (↳), bars from startDate to dueDate, sorted by priority then rank, click-through to Jira. Engineer Me mode shows only your rows.

### Milestones (OKRs & Dev Plans)

Label-based milestone tracking on backlog tickets: configure labels in Settings (`label|Display Name|Leapsome URL`), tag tickets in Jira, and each milestone renders a progress card (ticket count), status breakdown, IN SPRINT badges, and a click-through listing. Me/Squad scope applies. New module: `src/milestones.js`.

### Usage logging

The extension submits a single once-per-user response (Jira email, display name, accountId, role, version, squad) to a Google Form linked to a private Google Sheet, so the admin can track adoption. The POST is anonymous (`credentials: omit`) — no Google credentials are stored in the extension. The form URL is the `USAGE_ENDPOINT` constant in `background.js`; per-question IDs live in `USAGE_FORM_FIELDS`.

## Architecture

```
manifest.json          # MV3, CSP, side panel, host permissions
background.js          # service worker: data fetching, alert engine, getCurrentUser
popup.html / popup.js  # side panel UI, screen routing, rendering, scope filtering
settings.html / .js    # role toggle, credentials, squad config, member management
src/
  jira-api.js          # Jira REST v3 + Agile v1.0 client; getCurrentUser()
  sentry-api.js        # Sentry Issues API client
  metrics.js           # burndown prediction, countWorkingDays, sentryDayOverDaySpike
  alerts.js            # 9 alert rules, checkAlerts(), mergeAlerts()
  burndown.js          # committed-baseline burndown series computation
  changelog-parser.js  # Jira changelog → close timestamps + sprint-start estimates
  worklog-aggregator.js# per-member worklog hours aggregation
  parsers.js           # normalizeStory (incl. assigneeAccountId)
  sentry-trend.js      # per-view trend sample recording + retrieval
  sprint-cache.js      # sprint analytics keyed by sprint name
  migrations.js        # storage schema migrations
  privacy-mode.js      # screen-share privacy toggle
tests/                 # 9 suites, ~100+ tests
pre-flight.sh          # runs all suites, validates manifest+changelog version sync
```

### Data flow
```
chrome.alarms (5 min) → saveAndNotify()
  → fetchJiraData()    → state.currentSprint, state.sprintHistory
                       → state.currentUser (GET /rest/api/3/myself)
  → fetchSentryData()  → state.sentryViews
  → enrichState()      → state.sentryTrendSamples, state.settings
  → checkAlerts()      → mergeAlerts() → chrome.storage.local
  → notifyPopup()

popup.js (on open)    → loadData() → renderCurrentScreen()
                      → renderTodayScreen() + renderInsights()
```

### Critical API notes
- **Jira boards/sprints**: `/rest/agile/1.0/` NOT `/rest/api/3/` (returns 404)
- **Jira search**: POST `/rest/api/3/search/jql` with cursor pagination
- **Jira current user**: GET `/rest/api/3/myself` → `accountId` used for "me" scope
- **Day bucketing**: always use `setHours(0,0,0,0)` calendar-date comparison (sprint starts mid-afternoon)
- **Sentry views**: pass `project` IDs explicitly

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [GUIDELINES.md](GUIDELINES.md).

Run tests before any commit:
```bash
bash pre-flight.sh
```
