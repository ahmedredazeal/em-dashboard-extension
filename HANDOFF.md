# HANDOFF.md — Session State

> **Read this before starting any work.**
> Update this at the end of every session.

---

## Current version: v2.8.8

## Last session: Ahmed + Claude — 2026-06-04

### Completed this session (v1.8.7 → v2.0.0)

| Version | Summary |
|---|---|
| v1.8.7 | Burndown day-bucketing fixed (calendar-date, not 24h ms window). 63 tests pass, tz-safe. |
| v1.9.0 | Committed-baseline burndown (sprint-start estimate reconstruction). Colored segments. |
| v1.9.1 | Phase 2 alerts: 9 rules all grounded in real data. `countWorkingDays`, `committedBurnPrediction`, `sentryDayOverDaySpike` metrics. |
| v1.9.2 | Phase 1 role foundation: welcome screen with role cards, `settings.role`, `state.viewScope`, `getCurrentUser()` added to JiraClient. |
| v1.9.3 | Phase 2 scope filters: Me/Squad toggle on tickets, timesheet, estimate vs actual. `wireScopePills`, `buildScopeToggleHtml`. |
| v1.9.4 | Phase 3 settings split: EM-only sections hidden for engineer. Squad member management (curated list, stops auto-discovery). `role`+`viewScope` preserved across saves. |
| v1.9.5–v1.9.6 | Code review: 6 bugs fixed. Critical: `squadKey` deleted by Phase 1 edit breaking all Jira fetches. |
| v1.9.7–v1.9.8 | UX: section reorder (Sentry → Insights → Extra boards → Current Sprint), Me/Squad filter on charts and extra boards, sprint filter row, welcome SVG icons. Bug: `wireScopePills(contentEl)` was undefined (should be `content`). |
| v1.9.9 | Root cause of "scaled-up header": Python reorder scripts created duplicate copies of ALL screen divs. Rebuilt `popup.html` atomically. Merged auth+role-select into one welcome screen. `Hello, Zealer! 👋`, 120px logo, square role cards, ascending-bars EM icon. |
| v2.5.5 | Alert fixes: due_date_risk = overdue+imminent only (not sprint-end); stalled_burndown early guard (isEarlySprint); unassigned capped at medium early. Sentry empty-state dismiss button (sentryEmptyDismissed flag). |
| v2.5.4 | Cross-squad time + accountId filter. Quarter = two-pass (project discovery → author-scoped cross-project). Member filter keyed on accountId (isMonitored/memberKey/normalizeMember helpers); roster stored as {accountId,name} (mergeRoster); settings page handles object roster. Estimate-vs-actual cross-project too. |
| v2.5.3 | Fix: quarter timesheet showed only current-sprint loggers. Quarter worklog fetch now project-scoped (project=squad AND worklogDate in quarter), no author filter — all engineers who logged time appear. Added getProjectWorklogs + shared _fetchWorklogIssues (page cap 1000→2000). |
| v2.5.2 | Usage logging: endpoint-aware usageLoggedFor flag (replaces stuck boolean usageLogged), anonymous POST (credentials:omit), verbose [usage] logging. Rows need Apps Script deployed "Anyone". |
| v2.5.1 | Fixes: fetchSentryData wrapped in total try/catch (one bad project no longer rejects whole fetch / blanks chart); usage log gated on accountId not email (Jira may hide email) so rows write even without email. |
| v2.5.0 | Usage logging: once-per-user ping to Google Apps Script → Sheet (maybeLogUsage in saveAndNotify; usageLogged flag; no-cors fire-and-forget). Added script.google.com host_permissions. |
| v2.4.4 | Splash gradient → top-glow radial (radial-gradient(125% 75% at 50% 0%, #787ed9, #1d2c81 33%, #000 68%)) to match reference. |
| v2.4.3 | Splash: removed ripple effect, background → gradient linear-gradient(#787ed9 9.52%, #1d2c81), tightened timing (title 1.25s, total ~2.4s). |
| v2.4.2 | Copy fix: welcome screen "Set your default view" (was "Sets"). |
| v2.4.1 | Splash polish: correct all-white logo (cap-splash-white.png generated from cap-color.png with wing/swoosh cutouts), cap +20% (115px), title -40% (16px), Dashboard regular weight. |
| v2.5.5 | Alert fixes: due_date_risk = overdue+imminent only (not sprint-end); stalled_burndown early guard (isEarlySprint); unassigned capped at medium early. Sentry empty-state dismiss button (sentryEmptyDismissed flag). |
| v2.5.4 | Cross-squad time + accountId filter. Quarter = two-pass (project discovery → author-scoped cross-project). Member filter keyed on accountId (isMonitored/memberKey/normalizeMember helpers); roster stored as {accountId,name} (mergeRoster); settings page handles object roster. Estimate-vs-actual cross-project too. |
| v2.5.3 | Fix: quarter timesheet showed only current-sprint loggers. Quarter worklog fetch now project-scoped (project=squad AND worklogDate in quarter), no author filter — all engineers who logged time appear. Added getProjectWorklogs + shared _fetchWorklogIssues (page cap 1000→2000). |
| v2.5.2 | Usage logging: endpoint-aware usageLoggedFor flag (replaces stuck boolean usageLogged), anonymous POST (credentials:omit), verbose [usage] logging. Rows need Apps Script deployed "Anyone". |
| v2.5.1 | Fixes: fetchSentryData wrapped in total try/catch (one bad project no longer rejects whole fetch / blanks chart); usage log gated on accountId not email (Jira may hide email) so rows write even without email. |
| v2.5.0 | Usage logging: once-per-user ping to Google Apps Script → Sheet (maybeLogUsage in saveAndNotify; usageLogged flag; no-cors fire-and-forget). Added script.google.com host_permissions. |
| v2.4.4 | Splash gradient → top-glow radial (radial-gradient(125% 75% at 50% 0%, #787ed9, #1d2c81 33%, #000 68%)) to match reference. |
| v2.4.3 | Splash: removed ripple effect, background → gradient linear-gradient(#787ed9 9.52%, #1d2c81), tightened timing (title 1.25s, total ~2.4s). |
| v2.4.2 | Copy fix: welcome screen "Set your default view" (was "Sets"). |
| v2.4.1 | Splash polish: generated cap-splash-white.png (white cap, wing as navy cutout — cap-white.png wing was navy/invisible on navy); cap +20% (115px); title −40% (16px); Dashboard regular weight. |
| v2.4.0 | Phase 6: launch splash (navy, ripple, cap, title) once per session via chrome.storage.session. DM Sans bundled; Nohemi slot in fonts/. maybeRunSplash() in boot(). |
| v2.3.0 | Alert Settings: per-rule enable/disable, configurable thresholds (scope_creep %, stalled_burndown days, sentry_spike delta/%), per-rule desktop notif (🔔), reset-to-defaults, migration. |
| v2.2.0 | Rebrand to "Zealer Dashboard" (all user-facing strings + docs; internal IDs unchanged). Toolbar icon → circular blue badge, visible both light/dark. action.default_icon added. |
| v2.1.3 | Fix: engineer Me filter no longer shows squad data (never falls back to squad chart; accountId matching; stale-cache + no-data states). |
| v2.1.2 | Fix: sprint progress % bug (points ÷ ticket-count → now points ÷ totalPoints). Adds "x pts done · y pts to go". |
| v2.1.1 | Engineer me-mode personal charts: daily/monthly bars for Time Logged + Estimate vs Actual. byDate added to aggregateWorklogs. buildPersonalBarsSVG + helpers. |
| v2.1.0 | Phase 5: engineer progress circles (sprint donut + support donut). `buildDonut()` SVG helper. `renderEngineerProgressCircles()` first in `renderTodayScreen`. Docs update rule added to `AI_PROMPT.md` + memory. |
| v2.0.0 | Fix: welcome screen used hardcoded `cap-color.png` (navy always). Restored `theme-logo` dual-image span so dark mode shows white cap. |

### Current state

- Role-select + auth screens merged into one welcome screen (`screen-role-select`)
- `screen-auth` still exists in HTML as a fallback but is never routed to
- `popup.html` has exactly one copy of each screen (no more duplicates)
- All 9 test suites pass (~100+ tests)
- Engineer me/squad scope filter works on: tickets, timesheet, estimate, extra boards
- EM squad member management: curated list locks out background auto-discovery

### What's next (planned phases)

| Phase | Status | Description |
|---|---|---|
| 5 | ✅ Done | Engineer progress circles: sprint donut (pts, multi-status) + support donut (count, QA Accepted = done). Hidden if no assignments. Always "me"-scoped. |
| 6 | ✅ Done | Splash screen (2s, logo + animation). Discuss style when reached. |
| Alert settings | ✅ Done | Per-rule enable/disable + threshold config in Settings page. |

---

## Architecture notes

### Data flow
```
chrome.alarms (5 min) → saveAndNotify()
  → fetchJiraData(settings)
      → client.getCurrentUser()       → state.currentUser {accountId, displayName}
      → const squadKey = settings.squad?.key   ← CRITICAL: must come AFTER getCurrentUser
      → fetchSprintStories()
      → attachCloseTimestamps()       → normalizedStories with closedAt, closedDay
      → estimateAtSprintStart()       → committedPoints reconstruction
      → computeBurndownSeries()       → burndown with committed baseline
      → return { currentSprint, sprintHistory, supportTickets, extraBoardsData, currentUser }
  → fetchSentryData(settings)         → sentryViews [{viewId, label, count}]
  → recordTrendSample()               → chrome.storage.sync per view
  → state.sentryTrendSamples = {}     → last 7 days per view (for spike rule)
  → state.settings = settings
  → checkAlerts(state)                → 9 rules, each try/catched
  → mergeAlerts()                     → chrome.storage.local
```

### Key files
| File | Purpose |
|---|---|
| `background.js` | Service worker. Data fetching, alert engine, caching. Note: `squadKey` must be declared AFTER `getCurrentUser()` block. |
| `popup.js` | Side panel UI. `renderTodayScreen`, `renderInsights`, `renderRoleSelectScreen`, `wireScopePills`, `renderExtraBoards`. |
| `settings.html/js` | Role toggle, credentials, squad config, squad member management. `applyRoleToSettings(role)` hides/shows `.em-only`. |
| `src/jira-api.js` | Jira REST v3 + Agile v1.0. `getCurrentUser()` added. |
| `src/metrics.js` | `committedBurnPrediction()`, `countWorkingDays()`, `sentryDayOverDaySpike()`. |
| `src/alerts.js` | 9 rules. `checkAlerts(state)` wraps each in try/catch. |
| `src/burndown.js` | `computeBurndownSeries()` using committed-baseline from changelog. |
| `src/changelog-parser.js` | `estimateAtSprintStart()`, `wasAddedAfterSprintStart()`, `attachCloseTimestamps()`. |

### Settings schema (relevant keys)
```js
settings = {
  role:      'em' | 'engineer',       // set on first launch
  viewScope: 'me' | 'squad',          // persisted scope toggle for engineers
  jira:      { baseUrl, email, token },
  sentry:    { baseUrl, org, token },
  squad:     { key, name, extraBoards: [{name, boardId}] },
  ui:        { theme, privacyMode, workingDays },
  analytics: {
    discoveredMembers:    string[],   // auto-discovered OR curated by EM
    squadMembersCurated:  boolean,    // true = background won't auto-update list
    monitoredMembers:     string[],   // active DDL filter selection (EM mode)
  }
}
```

### Known traps / lesson-learned
1. **`squadKey` placement** — must be declared AFTER the `getCurrentUser()` try/catch in `fetchJiraData`. Moving the function opening without including `const squadKey` causes ReferenceError on every Jira fetch.
2. **`wireScopePills` variable name** — `renderInsights()` uses `const content = ...` (not `contentEl`). Calling `wireScopePills(contentEl)` passes `undefined` → silent no-op.
3. **popup.html reorder scripts** — Python str_replace and block-reorder scripts can create duplicate screen divs if the slice boundaries aren't exact. Always verify with `h.count('id="screen-X"')` == 1 after any reorder.
4. **`theme-logo` vs single `<img>`** — Always use `<span class="theme-logo"><img class="logo-light"><img class="logo-dark"></span>` pattern. Single `<img src="cap-color.png">` always shows navy regardless of theme.
5. **Engineer me-mode charts** — must NEVER fall through to the squad chart builder. If `myMember.byDate` is missing (stale cache aggregated before v2.1.1), show a refresh hint, not `buildTimesheetSVG(timesheetMembers)`. Match the current user by `accountId`, not `displayName`.
6. **Calendar-day bucketing** — Sprint startDate is a UTC datetime (e.g. 13:41Z). Always use `setHours(0,0,0,0)` to normalize to local calendar day before computing day indices.

---

## How to continue

```bash
git clone https://github.com/ahmedredazeal/em-dashboard-extension
cd em-dashboard-extension
git pull
# Read HANDOFF.md (this file) + CHANGELOG.md
# Pick a phase from the "What's next" table above
bash pre-flight.sh            # verify all green before starting
# Make changes
bash pre-flight.sh            # must stay green
# Bump manifest.json version
# Update CHANGELOG.md + changelog.html
# Update HANDOFF.md (this file)
git add -A && git commit -m "feat(v#.#.#): description"
git push
```
