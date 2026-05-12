# HANDOFF.md — Session State

> **Read this before starting any work.**
> Update this at the end of every session.

---

## Current version: v1.1.4

## Last session: Ahmed + Claude — 2026-05-12

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
