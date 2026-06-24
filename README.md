# Zealer Dashboard — Chrome Extension

Engineering Manager + Engineer cockpit for **Jira + Sentry**. Sprint health, reliability trends, time tracking, milestones, a sprint-timeline Gantt, and configurable alert rules — all in a Chrome MV3 side panel. A single extension serves both EMs and individual engineers via a dual-role architecture.

**Current version: v2.20.0**

---

## Features

### Dual-role mode (EM / Engineer)
First launch prompts you to choose your role. Role is persisted and changeable in Settings at any time.

| Feature | EM mode | Engineer mode |
|---|---|---|
| Sprint tickets | Full squad, engineers dropdown filter | Me / Squad toggle, "Me" default |
| Time tracking | Full squad, engineers dropdown filter | Me / Squad toggle, "Me" default |
| Estimate vs Actual | Full squad | Me / Squad toggle |
| Extra boards (support) | Full squad | Me / Squad toggle |
| **My Tasks card** | Not shown | Personal donuts (sprint pts by status + support ticket count) **and a personal sprint burndown**; hidden if no assignments |
| Burndown chart | Team | Team |
| Sprint progress | Team | Team |
| Sentry trend | Configured views | Configured views |

### Alert rules — configurable in Settings
Settings → Alert rules lets you enable/disable each rule, tune thresholds (scope-creep %, stalled days, Sentry spike delta/%), and toggle per-rule desktop notifications independently. A **Reset to defaults** button restores the original values.

| Rule | Fires when |
|---|---|
| `sprint_goal_at_risk` | Working-day-aware burndown projects a shortfall vs committed baseline |
| `scope_creep` | Points added after kickoff exceed the configured % of committed |
| `stalled_burndown` | No points completed in the last N working days (early-sprint grace period applies) |
| `due_date_risk` | Open pointed tickets are due before sprint end |
| `unassigned_work` | Open pointed tickets have no assignee (severity-capped) |
| `reopened_tickets` | A ticket that reached Done moved back to open |
| `sentry_trend_spike` | Day-over-day count increase past the configured delta/% in a tracked Sentry view |
| `velocity_drop` | Velocity drop over consecutive sprints _(gated: needs sprint history)_ |
| `support_sla_breach` | Support ticket past SLA _(gated: needs support board data)_ |

### Analytics (Insights)
- **Sentry trend chart** — issue-count trend per tracked view.
- **Burndown chart** — committed-baseline burndown with scope-change steps and hover tooltips.
- **Sprint progress bar** — status-breakdown mini bar with risk pills.
- **Time logged** — per-member horizontal bar chart (sprint / quarterly modes) with **two 6h/working-day reference lines**: a fixed full-sprint **cap** (drives the over-capacity ⚠ flag) and a moving **pace** marker (expected hours to date).
- **Estimate vs Actual** — hours comparison, synced to the time-logged mode.

### Sprint Timeline (Gantt)
One row per parent story (sorted by priority then rank), the parent due date as a dashed marker, and child tickets as bars in per-assignee sub-lanes. Click-through to Jira; engineer Me mode shows only your rows. Opens in a full browser tab as well.

### Milestones (OKRs & Dev Plans)
Label-based tracking on backlog tickets: configure labels in Settings (`label`, `label|Display Name`, or `label|Display Name|Leapsome URL`), tag tickets in Jira, and each milestone renders a progress card (by ticket count), status breakdown, IN SPRINT badges, and a click-through listing. Me/Squad scope applies.

### Demo / Mock Data Mode
A session-scoped toggle in Settings populates the dashboard with mock data (amber banner while active) so you can explore every chart without live credentials — useful for demos and onboarding.

### Launch splash
A branded splash plays once per browser session on first open, and respects your reduced-motion preference.

---

## Installation

1. Download the latest release zip (or clone the repo).
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** → select the `em-dashboard-extension` folder.
5. Open the side panel from the toolbar icon.

> **Auto-update:** Chrome MV3 extensions cannot update themselves from code. The extension shows an in-app banner when a newer **promoted** release is available on GitHub (see *Updates* below). A Chrome Web Store listing for true hands-off auto-update is planned.

## First-time setup

1. Open the panel — you'll see the welcome screen.
2. Pick your role (Engineering Manager or Engineer).
3. Go to **Settings** and fill in:
   - **Jira**: base URL (`https://yourco.atlassian.net`), email, API token.
   - **Sentry** (optional): base URL (`https://your-org.sentry.io`), org slug, auth token, and one or more view URLs.
   - **Squad**: project key (e.g. `HRM`), plus any extra boards (`Name|BoardID`).
4. Save → the dashboard loads.

API token links:
- Jira: https://id.atlassian.com/manage/api-tokens
- Sentry: your Sentry account → **Settings → Account → Auth Tokens** (needs `project:read` + `org:read`).

> **Sentry is optional.** The dashboard runs Jira-only if no Sentry credentials are set.

---

## Using it across multiple teams / orgs

The extension is not hard-wired to Zeal. Any team can point it at their own systems:

- **Jira** — set your own `*.atlassian.net` base URL, email, and token.
- **Sentry** — the **base URL is editable**; enter your own `https://<your-org>.sentry.io`. Views are parsed from any `*.sentry.io` URL and the org slug is derived from the subdomain. Your Sentry **auth token is sent only to your own Sentry base URL** (Bearer auth) and is never transmitted anywhere else.

Each team's Jira/Sentry data stays entirely within that team's own accounts.

---

## Updates

The extension checks GitHub Releases on every open (with a 30-minute network floor to respect GitHub's rate limit) for the newest release marked **promoted** — a release whose tag or name contains the token `promoted` — that is newer than the running version. If found, a dismissible banner appears with a link to the release and a "Remind me later" option. Un-promoted releases are ignored, so only versions the maintainer has tried and marked reach the team.

**Maintainer workflow to promote a build:** create a GitHub *Release* (not just a tag), attach the built zip, and put `promoted` in the tag or release name once you've verified it.

---

## Telemetry & privacy

The extension reports a small amount of **usage and error telemetry** to a fixed Sentry project (`zealer-dashboard`) via a hardcoded, write-only DSN, so the maintainer can see adoption and catch failures across all teams using the tool.

What telemetry contains:
- An `app_opened` event (once per browser session) and `section_viewed` events.
- `action_taken` events for a few meaningful actions: `export_report`, `scope_toggled`, `ticket_clicked` (carried as an `action` tag).
- A rolling per-user profile attached to `app_opened`, kept in `chrome.storage.local`: `firstSeen`/`firstVersion`, `lastSeen`/`currentVersion`, `daysActive` (distinct calendar days), `totalOpens`, and per-section/per-action counts. Headline scalars (`days_active`, `total_opens`, `first_version`) ride as tags; the full profile rides as a `usage_stats` extra — so the latest event per user is self-describing without Discover-tier aggregation.
- Performance timings (e.g. Jira/Sentry fetch duration).
- Handled error/warning reports (e.g. "a Sentry view failed to fetch", with the view id/label — **not** its contents).
- Identity tags from your Jira profile (email, accountId, display name) and `role` / `squad` tags.

Demo/Mock Mode is never reported (opens, sections, and actions are all suppressed).

What telemetry **never** contains: your Jira or Sentry **auth tokens**, your Sentry **issue contents**, or your **configured Sentry view data**. The telemetry path and the user-configured Sentry path are completely separate code paths and never intersect:

- **Telemetry** → always the hardcoded `zealer-dashboard` ingest DSN (write-only), `credentials: omit`.
- **Your Sentry views** → your own org/base URL, authenticated with your own token, fetched read-only and rendered locally. Trend samples are stored in `chrome.storage.sync` on your machine.

This means: if another team uses the tool, their *usage metrics* show up in the maintainer's `zealer-dashboard` Sentry project, while their *own Sentry views* remain entirely within their own Sentry account. The two never cross.

---

## Architecture

```
manifest.json          # MV3, CSP, side panel, host permissions
background.js          # service worker: data fetch orchestration, alert engine,
                       #   getCurrentUser, Sentry usage/error/timing telemetry
popup.html / popup.js  # side panel UI: routing, rendering, scope filtering,
                       #   update-check banner
settings.html / .js    # role toggle, credentials, squad config, member mgmt,
                       #   alert-rule config, demo-mode toggle
src/
  jira-api.js            # Jira REST v3 + Agile v1.0 client; getCurrentUser()
  sentry-api.js          # Sentry Issues API client (user-configured org)
  usage-telemetry.js     # telemetry envelope builders + sendEnvelope (the DSN path)
  update-check.js        # promoted-release discovery (version compare + selection)
  metrics.js             # burndown projection, working-day counting, spike detection
  alerts.js              # alert rules, checkAlerts(), mergeAlerts()
  burndown.js            # committed-baseline burndown + engineerSprintBurndown
  changelog-parser.js    # Jira changelog → close timestamps + sprint-start estimates
  worklog-aggregator.js  # per-member worklog aggregation
  parsers.js             # normalizeStory, parseSentryUrl, parseExtraBoardSpec
  sentry-trend.js        # per-view trend sample recording/retrieval (chrome.storage.sync)
  ticket-stats.js        # ticket count tallies
  bug-reports.js         # bug trend + open-bug snapshot metrics (T-BR-1)
  monthly-report.js      # monthly report core: reducers, rollover, finalize (T-RPT-1)
  calendar.js            # ICS parser + today-meetings/countdown/alert core (T-CAL-1)
  report-html.js         # standalone JSON + HTML report builders (T-RPT-1)
  render-scheduler.js    # single coalesced render scheduler
  render/                # pure SVG/HTML builders (burndown, timesheet, progress,
                         #   support-board, sentry-trend, estimate-actual, personal-bars)
  milestones.js          # label-based milestone data
  gantt.js               # sprint timeline layout
  mock-data.js           # demo/mock mode dataset
  sprint-cache.js        # sprint analytics keyed by sprint name
  migrations.js          # storage schema migrations
gantt-tab.html / .js    # full-tab Gantt view
print.html / .js        # Sentry trend export view
docs.html               # in-app help
tests/                  # 25 suites (475+ tests)
pre-flight.sh           # syntax, brace balance, CSP, element-ID audit, version
                       #   sync, and the FULL test suite — run before every tag
```

### Data flow
```
chrome.alarms / panel open → fetchJiraData()  → current sprint, history, support,
                                                 milestones, extra boards, current user
                           → fetchSentryData() → configured view results + trend samples
                           → checkAlerts()     → mergeAlerts() → chrome.storage.local
                           → notify popup (per-source partial updates)

popup.js → loadData() → requestRender() → renderTodayScreen() + renderInsights()
         → checkForUpdate() (fire-and-forget; promoted-release nudge)
```

### Critical API notes
- **Jira boards/sprints**: `/rest/agile/1.0/`, not `/rest/api/3/`.
- **Jira search**: POST `/rest/api/3/search/jql` with cursor pagination; `expand` goes inside the body (`{ expand: 'changelog' }`).
- **Jira current user**: GET `/rest/api/3/myself` → `accountId` drives "me" scope.
- **Story points** in Zeal's instance: `customfield_10039`; **start date**: `customfield_10015`.
- **Kanban/support boards**: read the board's own filter JQL, then append `status != "Closed"` — never sprint-based JQL.
- **Day bucketing**: always `setHours(0,0,0,0)` calendar-date comparison (sprints start mid-afternoon).
- **Sentry views**: pass `project` IDs explicitly; the view URL also carries query/sort/statsPeriod.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [GUIDELINES.md](GUIDELINES.md).

Design decisions and the reasoning behind backlog items are logged in [docs/DECISIONS.md](docs/DECISIONS.md).

Run the full pre-flight before any commit or tag:
```bash
bash pre-flight.sh
```
