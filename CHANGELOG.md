# Changelog

## v1.3.4 (2026-05-21) — Timesheet complete team coverage + doc fixes

**Fixed:**
- Timesheet only showed 2 members: inline worklog field only returns entries for issues
  where someone explicitly logged time. Now fetches worklogs per-issue for ALL sprint
  issues in parallel (using getIssueWorklogs), giving complete team coverage
- manifest.json version was stuck at 1.3.0 — corrected to track all patches
- changelog.html missing entries for v1.3.1, v1.3.2, v1.3.3 — all added
- CHANGELOG.md missing v1.3.1 entry — added

---

## v1.3.1 (2026-05-21) — Fix expand=changelog as URL query param

**Fixed:**
- Jira POST /rest/api/3/search/jql returns 400 "Invalid request payload" when
  expand is in the request body. Fixed by appending ?expand=changelog to the URL.

---

## v1.3.3 (2026-05-21) — Fix dynamic import in service worker

**Fixed:** Used dynamic import() in background.js (service worker). import() is disallowed in ServiceWorkerGlobalScope. Fixed by moving dayIndex to the static import at the top of background.js.

---

## v1.3.2 (2026-05-21) — Analytics fixes

**Fixed:**
- Burndown actual line missing: added fallback using ticket updated date for done stories
  without changelog close timestamp (handles Jira instances with limited history)
- Timesheet chart: replaced vertical column chart with horizontal bar chart — scales to
  any number of members without clipping or label overlap
- Sprint Analytics section moved above ticket list (still under Current Sprint section)
- Sprint Analytics now collapsed by default (▶), matching other sections

---

## v1.3.0 (2026-05-21) — Sprint Analytics Charts (Burndown + Timesheet)

**Added:**
- Sprint analytics section under Current Sprint, expanded by default
- Burndown chart with 3 series: Ideal (dashed gray), By due date (blue), Actual (green)
  — actual line built from Jira changelog transition-to-done timestamps
- Timesheet grouped bar chart: Week 1 vs Week 2 hours per member
  — built from Jira worklog data; working days configurable (default Sun-Thu)
- Sprint-change banner: when active sprint changes, prompts to keep or delete old analytics
- src/sprint-cache.js: Chrome storage layer keyed by sprint name
- src/chart-svg.js: standalone SVG chart renderers (no external libs, CSP-safe)
- Sprint stories now fetched with expand=changelog and worklog fields

---

## v1.2.9 (2026-05-18) — Sprint name in title + ticket counts on section headers

**Changed:**
- Current Sprint section title now shows sprint name in brackets:
  'Current Sprint (HRM Sprint 64)'  with 'N TICKETS' on the right
- When no sprint loaded: title stays 'Current Sprint' with no count
- Extra board section titles now show total on the right: 'SUPPORT BOARD  100 TOTAL'
- Consistent with Sentry sections which show '40 TOTAL' on the right

---

## v1.2.8 (2026-05-18) — Real status counts + Kanban board filter fix

**Fixed:**
- Status counts showed wrong values (4 QA Accepted not visible, QA Rejected missing)
  Root cause: counting by statusCategory buckets (done/indeterminate) does not match
  actual workflow status names. Now shows counts by real status name (QA Accepted,
  QA Rejected, In Progress, Open, QA Testing — whatever is in the data).
- Support board (Kanban extra board) returned no data
  Root cause: 'board = {id}' JQL doesn't work in Jira Cloud
  Fix: GET board details → filter.id → GET filter JQL → search with that JQL
  This ensures all fields including priority are returned correctly.

---

## v1.2.7 (2026-05-18) — Ticket counts in collapsed header + statusCategory fix

**Fixed:**
- statusCategory inprogress was wrong — Jira key is indeterminate → 0 in progress bug
- Summary line was inside expandable body (invisible when collapsed)
- Renamed closed to QA Accepted

**Changed:**
- Ticket counts in collapsed header (always visible without expanding)
- Support badges also in header

---

## v1.2.6 (2026-05-18) — Unified sections + priority + clickable tickets + support analytics

**Added:**
- Priority colour dot per ticket: 🔴 highest/critical · 🟠 high · 🟡 medium · 🔵 low · ⚪ lowest
- Clickable Jira ticket rows (opens `/browse/KEY` in browser, same as Sentry)
- Ticket summary: `X closed · X in progress · X open` at top of each board
- Support board special analytics: boards named "support" show `BreachedSLA 🔴` and `blocked-external ⚠` counts
- `labels` field included in Jira story fetch + normalizeStory

**Changed:**
- Section structure unified: "Current Sprint" and each board use `section-label` + collapsible row, matching Sentry style
- Shared helpers: `renderTicketRow`, `ticketSummaryHTML`, `wireTicketClicks`, `priorityDot`

---

## v1.2.5 (2026-05-17) — Incremental rendering: Jira and Sentry independent

**Fixed:**
- Sprint showed "Loading…" until Sentry finished (both sources were batched)
- Sentry showed "Loading issues…" for the full slow-Sentry duration

**Changed:**
- `checkDashboard` saves each source to storage as it completes + sends `partial-update` message
- Popup listens for `partial-update` and re-renders immediately per source
- Jira (sprint/boards) renders fast; Sentry renders when ready
- `refreshDashboard()` is fire-and-forget; button re-enables immediately

---

## v1.2.4 (2026-05-16) — ACTUAL FIX: Extra Boards Cache Bug

**Root cause found:**
When settings were saved, `settings-updated` fired, popup reloaded — but the 2-minute cache grace window meant the popup **skipped the fresh fetch** and rendered old cached data (which had no extra boards yet).

**Fix:**
In the `settings-updated` handler, zero out the cache timestamp **before** reloading:
```js
await chrome.storage.local.set({ cache: { lastFetch: { jira: 0, sentry: 0 } } });
location.reload();
```
This forces `boot()` to see an infinitely old cache → always fetches fresh data after settings save.

**Added:**
- `tests/integration.test.js`: 12 tests covering the settings→storage→background→render data flow, including a test that explicitly verifies the cache-invalidation fix
- Pre-flight now runs both parser tests (32) and integration tests (12) = 44 total assertions per release

---

## v1.2.3 (2026-05-16) — Unit Tests + Verbose Extra-Boards Logging

**Added:**
- `src/parsers.js` — pure parsing functions (no DOM, no chrome.*) for extra board specs, Sentry view specs, story points extraction, story normalization, done-status detection
- `tests/parsers.test.js` — 32 unit tests covering all parsing edge cases (object/string/null/blank/invalid inputs, round-trip persistence)
- `package.json` — minimal ES-module config; `npm test` runs the suite
- Pre-flight step 1c: runs the test suite, fails the build if any test fails
- Verbose logging throughout the extra-boards fetch pipeline so service worker console reveals exactly where things break

**Changed:**
- `background.js` now uses the tested `parseExtraBoardSpec`, `normalizeStory`, `isStoryDone` instead of duplicated inline logic — one tested path for all data shapes

**Why:** Previous 4 fixes shipped without verification because there was no way to test parsing in isolation. Now the core logic is locked behind 32 assertions that run before every release.

---

## v1.2.2 (2026-05-20) — Fix Extra Boards Not Rendering (Scope Bugs)

**Fixed:**
- `storyPointsField` declared `const` inside `try {}` block — block-scoped, invisible to the extra boards loop below it. Fixed by declaring `let storyPointsField = 'customfield_10016'` before the try block and assigning inside it.
- `boardId` loop variable in extra boards loop overwrote the outer `boardId` (main sprint's board). Renamed loop variable to `extraBoardId` to avoid collision.
- Both bugs meant extra boards silently failed to fetch, so nothing rendered.

---

## v1.2.1 (2026-05-20) — Fix ReferenceError: state is not defined

**Fixed:**
- `fetchJiraData()` referenced `state.extraBoardsData` but `state` is a local variable inside `checkDashboard()` — out of scope entirely in `fetchJiraData()`
- Caused `ReferenceError: state is not defined` on every Jira fetch → no sprint data rendered
- Fix: replaced `state.extraBoardsData.push(...)` with a local `const extraBoardsData = []` inside `fetchJiraData()`, returned as part of the result object

---

## v1.2.0 (2026-05-20) — Critical Syntax Fix + Pre-flight Brace Check

**Fixed:**
- `background.js` missing closing `}` on `fetchJiraData` function — caused "Service worker registration failed" and "Unexpected end of input" on load
- `node --check` doesn't catch missing closing braces in ES modules (returns false-negative) — added separate brace balance check to `pre-flight.sh`

**Added:**
- Pre-flight step 1b: brace balance check on all JS files (`{` count === `}` count) — prevents this class of error from ever shipping again

---

## v1.1.9 (2026-05-16) — Extra Boards Fully Working

**Fixed:**
- Extra boards were fetched but never saved to storage (pipeline broken)
- `popup.js` never read or rendered extra boards
- `fetchJiraData` return value didn't include `extraBoardsData`
- State object was missing `extraBoardsData` field

**Added:**
- Extra boards render as collapsible sections below main sprint (same style, collapsed by default)
- Each section shows: board label, sprint name, `X/Ypt` progress
- Story list with assignee, points, due date per ticket
- Settings now accept `Name|BoardID` format (one per line) with clear hint text

---

## v1.1.8 (2026-05-12) — Due Dates, Icon Fix, Decimal Fix

**Fixed:**
- Expected velocity showed too many decimals (e.g. `4.076923...`) — now rounds to 1dp (`4.1`)
- Early-sprint return in `sprintBurndownPrediction` was skipping the rounding applied elsewhere
- Tab/toolbar icon regenerated with correct RGBA format — was showing corrupted in Chrome

**Added:**
- Sprint story due dates in ticket list: `📅 15 May`
- Overdue stories highlighted red: `⚠ due 10 May`
- Due within 2 days highlighted amber: `📅 12 May`

---

## v1.1.7 (2026-05-12) — Refresh Timer Fixed

**Fixed:**
- Timer was not appearing at all (visibility bug in showScreen reset)
- Timer now always visible when context bar is shown
- `updateRefreshTimer()` called immediately on screen switch so label is always current

**Changed (per clearer requirements):**
- `elapsed < 5 min` → "just now" / "Xm ago"
- `elapsed ≥ 5 min` → `mm:ss` countdown to the 30-min mark
- Countdown goes amber when under 5 minutes remaining
- Countdown hits `00:00` → auto-refresh fires automatically

---

## v1.1.6 (2026-05-12) — On-Demand Fetching (No Background Alarm)

**Changed:**
- Removed 30-minute background alarm — data now fetches only when panel opens
- Panel open → always fetches fresh data (skips fetch if cache < 2 minutes old)
- Countdown changed from "next refresh in mm:ss" to "fetched Xm ago" (elapsed time)
- Cleaned up unused alarm constants from background.js

**Why:** Background alarms fire every 30 minutes regardless of whether you're using the panel — wasteful API calls, unnecessary service worker wakes. Fetching on open is always current and never wasteful.

---

## v1.1.5 (2026-05-12) — Refresh Countdown Timer

**Added:**
- Countdown timer in context bar beside ↻ button — shows `mm:ss` until next auto-refresh
- Timer reads `lastFetch` from cache storage to compute accurate remaining time
- Resets to 30:00 on manual refresh click
- Hidden on auth screen, shown on all dashboard screens

---

## v1.1.4 (2026-05-12) — Collaboration Infrastructure + GitHub Pages

**Added:**
- GitHub Pages site: index.html landing page with docs + changelog links
- CONTRIBUTING.md: full contributor workflow, versioning rules, code rules
- HANDOFF.md: session state log — current version, known issues, next steps
- AI_PROMPT.md: onboarding prompt for new Claude sessions
- GitHub Issue templates: bug report, feature request, docs update
- Versioning policy added to GUIDELINES.md (mandatory on every push)

**Changed:**
- All future pushes must bump manifest.json version + update both changelog files

---

## v1.1.3 (2026-05-12) — Per-View Sentry Sections + Auto Story Points

**Fixed:**
- Sentry issues now display in separate collapsible sections per view (not mixed together)
- Story points auto-detected from board configuration (`/rest/agile/1.0/board/{id}/configuration`)
- Version number now correctly reflects build (manifest.json is source of truth)
- Loading indicator shows while data is being fetched
- Tags no longer shown on issues (replaced by per-section grouping)

**Added:**
- Per-view issue counts in section headers
- Collapsible Sentry view sections (click header to expand/collapse)
- Assignee shown per issue
- Project slug shown per issue

---

## v1.1.0 (2026-05-11) — Dynamic Boards & Multi-Project Sentry

**Added:**
- Dynamic board configuration: multiple boards with custom names
- Drag-and-drop board reordering in settings
- Per-board active sprint detection and display
- Collapsible dashboard sections (per-board)
- Multi-project Sentry integration via saved view IDs
- Sentry view configuration: total count + detailed listings per view
- Settings auto-reload: changes apply immediately without closing side panel
- Migration logic: v1.0.0 single-squad → v1.1.0 multi-board model

**Changed:**
- Settings UI: Board Manager replaces single squad form
- Sentry config: now supports multiple projects via view IDs (e.g., 201661, 205219)
- Dashboard: renders sections per board, sorted by user preference
- Data model: `squad` → `boards[]` array with id, key, customName, order, visible

**Fixed:**
- Settings changes now trigger side panel reload (no manual close/reopen needed)
- Active sprint JQL queries improved for better detection
- Sentry API now fetches issues correctly across multiple projects

---

## v1.0.0 (2026-05-11) — Phase 1: Foundation

**Added:**
- Jira + Sentry integration (read-only APIs)
- Side panel UI with 3 screens: Today, Sprint Health, Reliability
- 4 core alert rules: velocity drop, sprint goal at risk, Sentry spike untriaged, support SLA breach
- Toolbar badge (red dot for unacknowledged alerts)
- Privacy mode toggle (🔒 in app bar) for screen sharing
- Two-row sticky header system per GUIDELINES.md
- Light/dark/browser theme support
- Settings page: Jira + Sentry credentials, squad selection, theme picker
- Background service worker with 30-min polling alarm
- Metrics calculation functions (velocity, goal hit, SLA, Sentry trend)
- Alert rules engine (pure, testable)
- Privacy mode utilities (CSS-based masking scaffold)
- docs.html, changelog.html, privacy.html
- README.md, GUIDELINES.md, PLAN.md

**Notes:**
- Phase 2 (Leapsome + People) coming next
- Leapsome credentials deferred to Phase 2 per user request
