# HANDOFF.md — Session State

> **Read this before starting any work.**
> Update this at the end of every session.

## Current version: v1.2.9 (chart logic complete, not yet wired to UI)

## Last session: Ahmed + Claude — 2026-05-20

### Completed this session (Phase 1+2)
- ✅ src/changelog-parser.js — extract done-transition timestamps (isDoneStatus, transitionToDoneTimestamp, attachCloseTimestamps)
- ✅ src/burndown.js — 3-series burndown: ideal (linear), estimate (by due dates), actual (from changelog)
- ✅ src/timesheet.js — week1/week2 hours per member; extractWorklogs; sortTimesheetMembers; getUTCDay() for timezone safety
- ✅ src/jira-api.js — getSprintStories accepts {withChangelog, withWorklogs}; getIssueWorklogs(key) added
- ✅ pre-flight.sh — all 4 test suites run (119 total: parsers 32, integration 12, burndown 41, timesheet 34)
- ✅ docs/research-charts.md — full API research + decisions documented
- ✅ tests/burndown.test.js — 41 tests
- ✅ tests/timesheet.test.js — 34 tests

### Next session (Phase 3 — T-20)

Branch: feature/claude-t20-charts-svg

Create:
- src/sprint-cache.js  (cache burndown+timesheet by sprint name)
- src/chart-svg.js     (SVG renderer: renderBurndownChart, renderTimesheetChart)

Modify:
- background.js        (call getSprintStories with withChangelog+withWorklogs, compute+save)
- popup.html           (collapsible sprint-analytics-section, expanded by default)
- popup.js             (read cache, inject SVG charts)

Key reminders:
- getUTCDay() NOT getDay() for all day-of-week logic
- Charts placed in collapsed area under Current Sprint, EXPANDED by default
- Cache keyed by sprint name, prompt on sprint change (keep/delete)
- Default working days: [0,1,2,3,4] = Sun-Thu

---

---

## Current version: v1.1.9

## Last session: Ahmed + Claude — 2026-05-16

### ⚠️ Workflow note

All work from v1.0.0 → v1.1.9 was shipped by pushing directly to `main` without GitHub Issues, branches, or PRs. This violates CONTRIBUTING.md.

**Retroactive fix:**
- `scripts/create-issues.sh` — run this once from your machine to create all 21 retroactive issues
- Going forward: every piece of work MUST start with a GitHub Issue and a feature branch

**From v1.2.0 onwards the workflow will be:**
```
create issue → branch feature/claude-issue-N → work → PR → review → merge
```

### What was completed this session

- ✅ Fixed Sentry loading/empty state overlap
- ✅ All Sentry view sections collapsed by default
- ✅ Sprint burndown early-sprint logic fixed (no false "at risk" on Day 1)
- ✅ Sprint shows expected velocity: `X pt/day needed`
- ✅ Set up collaboration infrastructure (this file, CONTRIBUTING.md, AI_PROMPT.md)
- ✅ GitHub Pages enabled — index.html, docs.html, changelog.html now hosted
- ✅ Version bumped to v1.1.4

### Current state of the app

| Feature | Status | Notes |
|---|---|---|
| Sprint at a glance | ✅ Working | Shows tickets, assignees, story points |
| Sprint burndown prediction | ✅ Working | Ignores Day 1-2, shows expected velocity |
| Sentry multi-view sections | ✅ Working | Collapsed by default, per-view counts |
| Sentry project IDs | ⚠️ Manual | User must paste project IDs from view URLs |
| Settings auto-reload | ✅ Working | Popup refreshes on save |
| Alerts | ✅ Working | Section hidden when no alerts |
| Extra boards | 🚧 Scaffolded | Fetched in background, not yet displayed in UI |
| Board Manager UI | 📋 Planned | v1.2.0 — drag-and-drop multi-board |
| Leapsome integration | 📋 Planned | v2.0 |

### Known issues / TODOs

- [ ] Extra boards (if configured) not yet rendered in the dashboard UI
- [ ] Sentry project IDs require manual copy from view URL — could auto-fetch from view config
- [ ] Sprint story points show 0 for some Jira instances (story points field varies)
- [ ] No loading state on initial boot (only on refresh)

---

## Active GitHub Issues

> Update this when you pick up or close an issue

| Issue | Status | Assigned to |
|---|---|---|
| None open yet | — | — |

---

## What's next (v1.2.0)

Priority order:
1. **Board Manager UI** — multiple boards, drag-to-reorder, custom names per board
2. **Display extra boards** — additional sections in dashboard for configured extra boards
3. **Auto-fetch Sentry project IDs** from saved view config (so user doesn't have to copy them)
4. **Sprint story points debug** — better fallback if board config returns wrong field

---

## Architecture notes (for new contributors)

### Data flow
```
chrome.runtime.onInstalled → setupAlarm()
                          ↓
chrome.alarms (30min)  → checkDashboard()
                          → fetchJiraData()  → storage.set(currentSprint, sprintHistory)
                          → fetchSentryData() → storage.set(sentryIssues, sentryViews)
popup.js (on open)     → refreshDashboard() → sendMessage('refresh-dashboard')
                          → loadData()        → reads from storage
                          → renderTodayScreen()
settings.js (on save)  → sendMessage('settings-updated') → popup reloads
```

### Key files
- `background.js` — service worker, alarms, data fetching, alert rules
- `popup.js` — side panel UI, screen routing, rendering
- `settings.js` — credentials form, save/load logic
- `src/jira-api.js` — Jira REST v3 + Agile v1.0 client
- `src/sentry-api.js` — Sentry Issues API client
- `src/metrics.js` — sprint velocity, burndown prediction
- `src/alerts.js` — alert rule definitions
- `src/migrations.js` — data model migrations between versions

### Critical API notes
- **Jira boards/sprints**: use `/rest/agile/1.0/` NOT `/rest/api/3/` (returns 404)
- **Jira search**: use POST `/rest/api/3/search/jql` (GET `/search` is deprecated)
- **Sentry views**: always pass `project` IDs explicitly — `view=` param doesn't filter by project
- **Sentry query**: `is:unresolved&sort=date&statsPeriod=7d`

---

## How to continue

```bash
git clone https://github.com/ahmedredazeal/em-dashboard-extension
cd em-dashboard-extension
git pull
# Read HANDOFF.md (this file)
# Pick an issue from GitHub Issues
git checkout -b feature/your-name-issue-N
# Make changes
bash pre-flight.sh
# Bump version in manifest.json
git add -A && git commit -m "type(scope): description"
git push
# Open PR on GitHub
# Update HANDOFF.md before ending session
```
