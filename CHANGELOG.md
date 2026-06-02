# Changelog

## v1.8.1 (2026-06-02) — Fix burndown "Actual" line drawn as a flat line

**Fixed:**
- The burndown **Actual** line was drawn across the entire sprint width
  (all days, including days that haven't happened yet). Because no work is
  logged on future days, the remaining value repeated from today to sprint end,
  rendering as a flat horizontal line that didn't look like a burndown.
- Fix (matches Jira's "Remaining work" behavior): the Actual line is now drawn
  **only up to today**. Ideal and By-due-date — both forward-looking — still
  span the full sprint. A dot marks today's remaining so it's visible even on
  day 0–1 of a sprint.
- `computeBurndownSeries` now accepts `daysElapsed` and returns `todayIndex`
  (the day the Actual line should stop at). Defaults to full width when not
  supplied, so existing callers/tests are unaffected.

---

## v1.8.0 (2026-06-02) — Multi-view Sentry tracking

**New feature: track multiple Sentry views at once.**

Previously only one Sentry view could be tracked. Now you can track any number of
views and the trend chart draws each as its own colored line on a single shared chart.

### Tracking
- `settings.sentry.trackedViewId` (single string) → `settings.sentry.trackedViewIds` (array).
  A migration wraps any existing tracked view into a one-element array, so current
  tracking is preserved on upgrade.
- Settings → each Sentry view row now has a multi-select Track toggle (multiple can be
  active) and shows the view's assigned color swatch.
- `background.js` records a daily sample for every tracked view.

### Chart
- One colored polyline per view, on a shared X axis (union of all date ranges) and shared
  Y axis (max across views). A view with a shorter history starts its line later.
- Legend with color swatch + label + latest count + day-over-day delta per view.
- **Click a legend entry to hide/show that line.**
- Gap shading ("no data · Nd") is shown only when a single line is visible, to keep
  multi-line charts readable.
- Colors are assigned by the view's position in the views list (stable per view),
  defined in the shared `src/trend-colors.js`.

### Export — now a dropdown
- ⬇ opens a menu: one entry per tracked view + "All views".
- Per view → that view's JSON file + a single-view PDF.
- All views → one JSON file per view (batch download) + one combined multi-line PDF.
- Every JSON file stays strictly one-view, so any export is independently importable.

### Import
- Unchanged routing (the file carries its own viewId). Live readings still win.
- If you import a file for a view that isn't currently tracked, the data is saved
  silently and an amber notice in Settings reminds you to click Track on that view.

### Other
- New `docs/MULTI_VIEW_TRACKING.md` documenting the data model, colors, all scenarios.
- New `src/trend-colors.js` + `tests/trend-colors.test.js`.
- `print.html`/`print.js` extended to render combined multi-line PDFs (v2 payload),
  still backward-compatible with single-view exports.

---

## v1.7.6 (2026-06-01) — Fix sprint name + member filter

**Fixed:**

1. **Sprint name stays as old sprint after 'Keep history'**
   When a sprint change is detected, the 'sprint-changed' message fires during
   the Jira fetch (before 'partial-update' arrives with the new sprint data). The
   'Keep' button previously only removed the banner and did nothing else — the new
   sprint name only appeared once the separate 'partial-update' arrived, which
   could be seconds later or miss entirely if the user clicked Keep first.
   Fix: the Keep handler now calls `loadData()` then `renderCurrentScreen()`
   after removing the banner, forcing an immediate re-render with whatever is
   currently in storage (which includes the new sprint from `saveAndNotify`).

2. **Member filter (👥) opens but doesn't apply to charts**
   The Apply handler was reading settings from `chrome.storage.local` before
   updating them. If a `partial-update` had updated `state.settings` in memory
   but the storage hadn't yet caught up, the read returned a stale object. Setting
   `state.settings = storedValue` then overwrote the newer in-memory changes, so
   on the subsequent `renderInsights()` call, the filter appeared to have no effect.
   Fix: mutate `state.settings` directly (no storage read), then save the updated
   object to storage. `renderInsights()` now always sees the current filter selection.

---

## v1.7.5 (2026-06-01) — Fix CSP violation from print.html inline script

**Fixed:**
- `print.html` had a large inline `<script>` block which violated the extension's
  Content Security Policy (`script-src 'self'`). Chrome was logging two CSP errors
  in the extension manager page for every session. The script has been extracted
  to `print.js` and referenced with `<script src="print.js">`.

**Note:** The "Failed to fetch" errors visible in the extension manager
(Failed to fetch active sprint, Failed view ...) are transient network errors
from the background service worker waking up when a request times out. They are
caught and handled gracefully — not crashes, and not related to our code changes.

---

## v1.7.4 (2026-06-01) — Fix export page showing no data

**Fixed:**
- Export page (print.html) was reading the chart data from `chrome.storage.local`
  (key `printData`), which caused timing issues and showed a blank page when the
  storage write hadn't propagated or when the page was manually refreshed.
  Fix: data is now passed directly as a JSON-encoded URL query parameter when the
  print tab is opened. No storage involved — data is self-contained in the URL and
  available the instant the page loads.
- Fixed a crash in print.html when `samples` was empty or had only 1 entry:
  accessing `prev.count` on an undefined `prev` threw TypeError and left the
  summary cards, chart, and table all blank. Added a null-guard on `prev`.

---

## v1.7.3 (2026-05-31) — Fix Sentry import (dynamic import → static import)

**Fixed:**
- The import handler in Settings used `await import('./src/sentry-trend.js')`
  (dynamic import inside an event listener). This silently failed in the extension
  options page context, meaning the import appeared to do nothing even though the
  file was read correctly.
  Fix: `importTrendSamples` is now a static import at the top of `settings.js`
  alongside the other module imports.
- Added a null-guard helper `setStatus()` around all `importStatus` references
  so the handler never crashes silently if the element is somehow missing.

---

## v1.7.2 (2026-05-29) — Sentry trend: Export, Import, and gap visualization

**New features:**

### Export (⬇ button inside the Sentry trend card)
Clicking ⬇ triggers two simultaneous outputs:
1. **JSON file download** (`EM-Dashboard-Sentry-{label}-{date}.json`) — the canonical
   backup/restore format. Use this as the import file if you ever need to restore data.
2. **Print-ready PDF tab** — opens a new Chrome tab with a clean, light-themed page
   containing a large chart, summary stats, and a full data table with day-over-day changes.
   Press Ctrl+P (or Cmd+P on Mac) → Save as PDF. Instructions are shown on the page.

### Import (Settings → Sentry Trend History)
- File input that accepts `.json` files exported by the ⬇ button.
- **Live readings always win**: if an imported date already has a reading recorded
  directly from Sentry by the extension, the live value is kept unchanged.
  Only missing dates are filled in by the import.
- The import section in Settings explains this policy clearly.

### Gap visualization in the chart
- **Date-normalised x-axis**: points are now positioned by their actual calendar date,
  not array index. A 14-day gap is visually 14× wider than a 1-day step.
- **Grey gap rectangles**: periods with no recorded data are shaded grey with a
  "no data · N days" label. **No fake connecting line is drawn** across gaps —
  the chart makes no assumptions about what the count did during a gap.
- **Polyline breaks at gaps**: each continuous streak of data is a separate line segment.

**Other:**
- Added `tabs` permission to manifest (required for `chrome.tabs.create` on export).
- New `print.html` extension page (used internally by the export).
- New `importTrendSamples()` in `src/sentry-trend.js`.

---

## v1.7.1 (2026-05-29) — Sentry trend chart visual fixes

**Fixed (all in `buildTrendCardHTML` in popup.js):**

1. **Flat line at chart floor** — y-axis collapsed when all counts were equal
   (or nearly equal). Every point landed at `py = bottom` leaving the upper 80%
   of the chart empty. Fix: add ≥15% padding above and below the data range
   so flat/near-flat series render centred, not pinned to the edge.

2. **Overlapping x-axis labels** — the SVG x-axis labels sat at `y = H − 2`
   (touching the SVG edge) while an HTML `min/max` row sits only 2px below.
   Visually they collided. Fix: raised labels to `y = H − 4` and increased
   `PAD_B` from 16 → 20 to give proper breathing room.
   Also: the middle label is now skipped when it has less than 40 px clearance
   on either side (prevents crowding on small datasets).

3. **"min 23 max 23" footer** — when the count is constant the footer was
   repeating the same number twice, looking broken. Fix: when `dataRange === 0`
   show "stable at N" instead.

---

## v1.7.0 (2026-05-28) — Fix Sentry issue count (was lower than real total)

**Fixed:**
- `getIssuesFromView` in `sentry-api.js` hardcoded `statsPeriod: '7d'`, which
  tells the Sentry API to return only issues that had activity in the last 7 days.
  Older unresolved issues (with no recent events) were silently excluded, making
  the dashboard count lower than the real total shown in Sentry's own UI.
  (Example: dashboard showed 24, Sentry showed 39 — the 15 gap is issues older
  than 7 days that are still open.)
- `query`, `sort`, and `statsPeriod` were also hardcoded (`is:unresolved`,
  `date`, `7d`) even though `parseSentryUrl` already extracted the correct values
  from the view URL. Those extracted values were silently dropped.
- Fix: `getIssuesFromView` now accepts an optional `viewParams` object
  (`{ query, sort, statsPeriod }`). `background.js` passes the values from
  `parseSentryUrl` through. When `statsPeriod` is absent from the URL, it is
  intentionally omitted from the API request — Sentry then returns all matching
  issues regardless of last-seen date, matching the "All Time" default view.

**Impact:** Sentry counts in the header, section, and trend chart now match
what the Sentry UI shows for each view.

---

## v1.6.9 (2026-05-26) — Fix Sentry trend: Track button now auto-saves + data-view-id stays in sync

**Fixed:**
- Sentry trend chart never received data because the Track button click only
  updated the DOM visually. The `trackedViewId` was only written to storage
  when the main Save button was pressed. Users who clicked Track and navigated
  away (or simply expected it to persist like a toggle) found it silently reset
  on next settings open. Because `trackedViewId` was always null in storage,
  `recordTrendSample` in background.js was never called, so the trend chart
  had no history to show.
  Fix: the Track click handler is now `async` and immediately writes
  `settings.sentry.trackedViewId` to `chrome.storage.local` after updating
  the DOM. Save button is no longer required for this one field.
- Brief "✓ Saved" flash on the Track button confirms the auto-save completed.
- `updateRowPreview()` now also updates `trackBtn.dataset.viewId` when the URL
  field changes. Previously, `data-view-id` was frozen at row-creation time, so
  editing a URL left a stale viewId and `getTrackedViewId()` returned null even
  when Save was pressed correctly.

**How data builds from here:**
  The next time the dashboard panel is opened (after clicking Track), the
  background fetch will call `recordTrendSample` for the tracked view. The
  chart will show a single-point "day 1" reading. Each subsequent day adds
  another sample and the trend line starts to form.

---

## v1.6.8 (2026-05-26) — Theme-aware in-app logo

**Changed:**
- v1.6.7 used the navy cap in the app bar, welcome screen, and settings header.
  That works fine on the light theme but loses contrast on the dark theme. The
  user wanted the white cap shown in-app too.
- New asset `icons/cap-white.png` (256x256 white cap with navy Zeal mark,
  matching the toolbar icons) added.
- Both `cap-color.png` (navy) and `cap-white.png` (white) are now rendered in
  the DOM at every logo placement, wrapped in a `.theme-logo` span. CSS hides
  whichever is wrong for the current theme:
  - `data-theme="light"` → navy cap visible
  - `data-theme="dark"` → white cap visible
  - `data-theme="browser"` → follows `prefers-color-scheme`
- New CSS block at end of `styles.css` (40 lines): `.theme-logo`, size
  variants `.theme-logo-22/40/72`, and theme selectors.
- Two extra image requests (4-30 KB each) but they're cached after first load.

---

## v1.6.7 (2026-05-26) — Logo refinement: bigger toolbar icon + app-wide branding

**Changed:**
- Toolbar icons reprocessed: source image was tightly cropped to the cap's
  bounding box (was wasting ~40% of canvas to whitespace), then colors inverted
  to a WHITE cap with NAVY Zeal mark via flood-fill from corners. Result: the
  cap fills ~95% of each icon canvas and reads clearly against Chrome's dark
  toolbar at 16/32/48/128 px.
- New asset `icons/cap-color.png` (256x256, navy cap on transparent) — used
  inside the app where backgrounds can be light. Toolbar icons stay white.
- Replaced the placeholder 4-square SVG logos in three app surfaces:
  - `popup.html` app-bar header (was 18px inline SVG)
  - `popup.html` welcome / auth screen (was 48px inline SVG)
  - `settings.html` page header (was 32px inline SVG)
  All now use `<img src="icons/cap-color.png">` at appropriate sizes.

**Why:** v1.6.6 shipped the logo but only into the manifest icons. In-app
surfaces still showed the placeholder squares, and the toolbar icon was
smaller than it could be because the source had ~40% padding around the cap.

---

## v1.6.6 (2026-05-25) — New logo (navy cap with Zeal mark)

**Changed:**
- Brand identity refresh: replaced the four toolbar/install icons (16/32/48/128)
  with a custom navy-blue baseball cap silhouette featuring a stylized Zeal bird
  mark on the side panel and the iconic white curl-stripe between crown and brim.
- Source asset: 1254×1254 JPEG, converted to RGBA PNG with white background
  keyed out (transparent), high-quality Lanczos downscale to each target size.
- No code changes — visual identity only. All 179 tests continue to pass.

---

## v1.6.5 (2026-05-25) — Message channel + bar layout + quarter member filter

**Fixed:**
- Chrome error 'message channel closed before response received': the
  fetch-quarter-worklogs handler returned true (implying sendResponse use) but
  never called sendResponse. Fix: return undefined instead. We use
  chrome.runtime.sendMessage for the reply, not the synchronous response channel.
- Support board bars shrink when blocked label appears: blocked badge was inline
  in the flex row with no reserved space, so bar (flex:1) shrank to give it room.
  Fix: right side is now a fixed 88px div (always present, empty when no blocked).
  Bar always occupies the same proportional space regardless of blocked status.
- Member filter had no effect on Q1/Q2 data: timesheetMembers for quarters was
  taken directly from the cache (full list), without applying the monitored filter.
  Fix: monitored filter applied after reading rawTimesheetMembers for all modes.

---

## v1.6.4 (2026-05-25) — Quarter 400 fix + estimate sync + support board header

**Fixed:**
- Quarter fetch 400 error: new paginated getTeamWorklogs passed startAt in the
  POST body, but /rest/api/3/search/jql uses cursor-based pagination (nextPageToken),
  not offset-based (startAt). startAt is an unrecognized field on that endpoint.
  Fix: removed startAt; now reads result.nextPageToken and passes it on subsequent
  calls until no nextPageToken is returned.
- Estimate vs Actual showed stale sprint data while Time Logged showed Q1 loading:
  teamForEstimate fell back to filteredTs (sprint) when timesheetMembers was null.
  Fix: detect quarterPending (mode != sprint AND no cached data) and show a matching
  Loading Q1 data placeholder in the estimate card too.
- Support board breakdown: centering moved the header up with the bars.
  Fix: card is flex-column, header has flex-shrink:0 (stays at top), inner div
  has flex:1 + justify-content:center (bars centered in remaining space).

---

## v1.6.3 (2026-05-25) — CRITICAL: fix modeRange TDZ crash

**Fixed:**
- ReferenceError: Cannot access 'modeRange' before initialization.
  The date-computation block (declaring modeRange via const) was placed AFTER
  the buildEstimateVsActualCard(teamForEstimate, modeRange) call. JavaScript
  const/let have a Temporal Dead Zone — accessing them before their declaration
  line throws a ReferenceError even within the same scope.
  Fix: moved the date block and modeRange declaration above the teamForEstimate
  section that references it.

---

## v1.6.2 (2026-05-25) — Quarter data + layout consistency

**Fixed (critical — quarter data):**
- Q1/Q2 data was drastically under-counting because:
  a) Jira embeds only the 20 most-recent worklogs per issue (date-descending).
     For Q1 queries, those 20 are often all post-Q1 entries; Q1 logs were missed.
     Fix: for any issue where worklog.total > worklogs.length, fetch complete
     worklogs via /rest/api/3/issue/{id}/worklog?startedAfter=&startedBefore=
  b) maxResults was capped at 200 issues. Fix: paginate until all issues retrieved
     (max 1000 issues per query, batched in 100s).

**Changed (layout — row 2 consistency):**
- Mode dropdown (Sprint/Q1/Q2) and member filter button (👥) moved OUT of the
  Time Logged card header into a SHARED control bar above both row-2 cards.
  Both TIME LOGGED and ESTIMATE VS ACTUAL now respect the same mode + filter.
- Date range subtitle in shared bar updates when mode changes.
- Both row-2 cards have identical header layout: title + date subtitle.
- ESTIMATE VS ACTUAL: removed separate member filter button (shared bar covers it).
  Now shows the mode date range as subtitle instead.
- Support board breakdown: content centered vertically in card (justify-content:center).

---

## v1.6.1 (2026-05-25) — Fix: member filter duplicate IDs + Apply reset

**Fixed (4 bugs):**
1. Estimate vs Actual filter button did nothing: memberFilterHtml (full popover with
   id='member-filter-popover') was rendered in BOTH Time Logged and Estimate cards,
   creating duplicate IDs. document.getElementById found only the first (Time Logged).
   Fix: Time Logged gets the full popover; Estimate gets a trigger-only button
   (id='member-filter-btn-2') that opens the same popover.

2. member-filter-btn-2 was declared but never wired. Now wired to openPopover()
   alongside member-filter-btn.

3. document.addEventListener('click', close, {once:true}) fired on the very next
   click — including the Apply button itself — closing the popover BEFORE Apply could
   read the checkboxes, so the selection appeared to reset. Fix: replaced with a
   named closeOnOutsideClick handler that checks the click target and is removed
   explicitly on close/Apply.

4. Empty selection saved as [] which triggered 'show all' fallback (monitored.length===0
   → all checkboxes checked), making it look like a reset. Fix: if selected is empty
   save null instead (null = show all is intentional, [] would be ambiguous).

---

## v1.6.0 (2026-05-25) — Sentry setup prompt + chart layout v2

**Fixed:**
- Sentry trend card was silently hidden when no view was tracked.
  Now shows a setup instruction: Settings → Sentry views → Track → Save.
  This also explains the chart not appearing for users who haven't tracked a view.

**Changed:**
- Chart layout row order changed:
  Row 1: Burndown | Support Board Breakdown
  Row 2: Time Logged | Estimate vs Actual
  (was: Row1 Burndown|Time Logged, Row2 Estimate|Support)

---

## v1.5.9 (2026-05-25) — Chart layout polish + Sentry day-1 fix

**Changed:**
- Removed TEAM FOCUS (issue-type split) chart — too noisy without context.
- ESTIMATE VS ACTUAL and SUPPORT BOARD BREAKDOWN now side-by-side at >=520px
  (same breakpoint as Burndown / Time Logged above them).
- ESTIMATE VS ACTUAL: shows the same member filter button (👥 N/M) as
  TIME LOGGED — both charts update when the member selection changes.
- ESTIMATE VS ACTUAL: card style updated to flex column to support equal heights.

**Fixed:**
- Sentry trend chart now shows from day 1.
  On the first reading: displays a dot + count + first-reading label with a
  'Open the panel daily to build the trend line' prompt.
  Previously required 2 data points before any chart appeared.

---

## v1.5.8 (2026-05-24) — CRITICAL: date format fix for worklog + chart headers

**Fixed (critical):**
- NaN May – NaN May date headers and empty TIME LOGGED chart:
  Jira sprint startDate/endDate are ISO datetimes (2026-05-11T00:00:00.000Z).
  The fmtDate parser did +day on '11T00:00:00.000Z' → NaN.
  The worklog JQL passed full ISO strings; Jira expects YYYY-MM-DD for worklogDate.
  All date handling now slices to YYYY-MM-DD before use.
- Analytics cache stores sliced dates going forward.
- renderInsights falls back to analytics.startDate when currentSprint.startDate absent.
- Worklog fetch guard: skips if wlStart or wlEnd is empty after slice.

---

## v1.5.7 (2026-05-24) — Due date colors + worklog format + support board chart

**Fixed:**
- Closed and QA Accepted tickets no longer show red/orange overdue warnings.
  formatDueDate now accepts statusCategory; done tickets display due date in
  muted gray (informational only, no alarm styling).
- Old worklog format detection: if sprint analytics cache has pre-v1.5.4 format
  (week1/week2 instead of byProject), TIME LOGGED now shows a helpful message
  'Data format updated — click ↻ to refresh' instead of empty/invisible bars.

**Added:**
- SUPPORT BOARD BREAKDOWN card in Insights section: horizontal bar chart per
  status (Open, In Progress, QA Testing, etc.) with count and blocked-external
  ⚠ badge per status. Summary banner shows total blocked-external tickets.

---

## v1.5.6 (2026-05-24) — Worklog data + quarter fetch + UX fixes

**Fixed:**
- TIME LOGGED shows no data: when sprint stories have no assigneeAccountId (cached
  from pre-v1.5.4), accountIds array was empty and worklog fetch was skipped.
  Added fallback: if no account IDs available, queries project=HRM worklogs so
  at least HRM data loads. Cross-squad query runs on next refresh once fresh
  stories with accountIds are cached.
- Quarter fetch: 'baseUrl.replace is not a function' — JiraClient constructor
  expects (baseUrl, email, token) but handler was passing settings.jira object.
  Fixed to use settings.jira.baseUrl/email/token like the main Jira client.
- wrap is not defined crash in renderInsights — ResizeObserver still referenced
  deleted sprint-analytics-wrap element. Fixed to use contentEl (insights-content).

**Changed:**
- Current Sprint: removed inner sprint-glance-header toggle. Single subsection
  shows flat when the section is expanded — no need for an inner collapsible.
- Extra boards (Support): same treatment. Section label toggles whole content;
  mini bar + ticket list show flat when expanded.

---

## v1.5.5 (2026-05-24) — Fix: wrap undefined crash + board sections collapsible

**Fixed:**
- ReferenceError: wrap is not defined in renderInsights()
  The ResizeObserver still referenced the old sprint-analytics-wrap element
  after the Insights restructure. Now uses contentEl (insights-content div).
- Extra board sections (Support Board etc.) are now collapsible at the
  section-label level, closed by default. Clicking the section-label
  toggles the entire section body (mini bar + ticket list). Removed
  the redundant inner mini-bar collapsible — section is now single-level.

---

## v1.5.4 (2026-05-24) — Worklog v2: all-squad time tracking + analytics cards

**Added:**
- TIME LOGGED chart now shows hours across ALL squads (not just HRM).
  Uses worklogAuthor JQL to query by team member account IDs — same approach
  as Jira's own 'Logged hours by user' chart.
- Bars are now stacked by project colour (auto-assigned from 8-colour palette,
  deterministic by project key). Week 1/Week 2 split removed in favour of
  per-project coloured segments.
- Quarter dropdown in TIME LOGGED card: Sprint / Q1 / Q2 / ... (only shows
  quarters that have started in the current year). Quarter data is fetched
  lazily on first selection and cached in chrome.storage.local with a
  Refresh link shown below the chart.
- ESTIMATE VS ACTUAL card: per-person logged vs estimated hours with
  over/under ratio indicator (orange if >1.3x, green if <0.7x).
- TEAM FOCUS card: horizontal bar breakdown of hours by issue type
  (Bug / Story / Task / etc.) for the selected time period.
- New src/worklog-aggregator.js: aggregateWorklogs, aggregateByIssueType,
  extractWorklogsFromIssues, assignProjectColors, currentQuarters, quarterRange.
  28 unit tests.
- state.timesheetMode and state.quarterWorklogCache added for period switching.

**Changed:**
- src/parsers.js: normalizeStory now includes assigneeAccountId field.
- src/jira-api.js: new getTeamWorklogs(accountIds, start, end) method.
- background.js: sprint timesheet uses getTeamWorklogs + aggregateWorklogs;
  stores issueTypeSplit in analytics cache; handles fetch-quarter-worklogs
  message for lazy quarter fetching.

---

## v1.5.3 (2026-05-24) — Insights section + section-level toggles

**Changed:**
- New top-level INSIGHTS section (open by default) consolidates all charts:
  Sprint Progress, Burndown, Time Logged, Sentry Trend.
  Flat layout — no inner collapsibles inside Insights.
- CURRENT SPRINT section is now closed by default; section label + mini
  progress bar always visible; ticket list shown on expand.
- SENTRY ISSUES section is now closed by default; views shown on expand.
- All section labels are now clickable toggles (▶/▼ chevron).
- Sprint Analytics sub-section removed; its content moved to Insights.
- setSectionLoading updated: analytics-loading-pill → insights-loading-pill.

---

## v1.5.1 (2026-05-24) — Light mode fix + decimal rounding

**Fixed:**
- Light mode: all card and chart backgrounds now adapt correctly. Root cause:
  --surface and --surface-raised CSS custom properties were used everywhere
  (card/chart backgrounds, collapsible sections, inputs) but never defined in
  styles.css — so the dark hex fallbacks always kicked in. Added to all three
  theme blocks:
  Light: --surface:#f3f4f6 --surface-raised:#e5e7eb
  Dark:  --surface:#11131c --surface-raised:#1f2937
  Browser-dark: same as dark
- Decimal overflow in risk text: At risk · need 4.846153846153846pt/d
  Root cause: metrics.sprintBurndownPrediction sprint-ended branch (daysRemaining=0)
  returned the raw unrounded expectedDailyVelocity. Day 13/13 triggers this path.
  Fix: added Math.round(x*10)/10 to that branch, matching the other branches.
  Also added .toFixed(1) guard in popup.js as a second-layer safety net.

---

## v1.5.0 (2026-05-24) — Sentry trend chart

**Added:**
- Sentry daily issue-count trend chart. Tracks unresolved issues for one
  selected view over time and renders a compact sparkline card directly under
  the SENTRY ISSUES section label — always visible, same card style as
  burndown and timesheet
- Track button on each Sentry view row in Settings — click to select which
  view is tracked; only one at a time; click again to deselect. Tooltip explains
  what tracking does
- Hint text below the Sentry views list clarifying the Track button purpose
- Samples stored in chrome.storage.sync bucketed by month (sentryTrend:{id}:{YYYY-MM})
  — survives extension reinstall and machine changes as long as the user
  is signed into Chrome with the same Google account
- Each refresh overwrites today's count for the tracked view (passive capture)
- 365-day rolling retention — months older than 12 are pruned automatically
- Chart shows last 30 days: area sparkline, today's count, delta vs yesterday,
  min/max annotation, 3 date labels on X axis
- New module: src/sentry-trend.js with recordTrendSample, getTrendSamples,
  pruneOldSamples, todayUTC
- 15 unit tests with mock chrome.storage.sync in tests/sentry-trend.test.js

---

## v1.4.6 (2026-05-23) — Sentry settings polish, ticket row simplification, support QA tracking

**Fixed:**
- Sentry views section now always shows one empty row by default — users no
  longer have to click + Add another view to get the first input
- Removed the v1.4.4 migration banner from Settings — no longer needed
- Ticket rows had two color systems (priority dot + status icon) which was
  visually confusing. Removed the status icon at the row start; status name
  on the right (already colored) carries the status info
- Support board pill text "blocked" → "blocked-external" to match the
  actual Jira label name and make the source obvious

**Changed:**
- Support board API filter: was AND statusCategory != Done, now
  AND status != "Closed". QA Accepted tickets now appear in the list and
  count toward the done% in the progress bar — the metric is meaningful again
  (was always stuck at 0% before, since done category was filtered out)

---

## v1.4.5 (2026-05-23) — HOTFIX: rescue squad config from broken v1.1.0 migration

**Fixed (critical):**
- v1.4.4 wired runMigrations() into the boot sequence for the first time.
  This activated an ORPHANED v1.0.0 → v1.1.0 migration that had been sitting
  in src/migrations.js since v1.1.0 was conceived. That migration deletes
  settings.squad after copying its data to settings.boards[0] — but the
  rest of the app code never adopted the boards[] shape, so users running
  the migration ended up with a missing settings.squad and the error:
  '[background] Jira fetch failed: Squad project key not configured'

**Recovery:**
- Added rescueSquadFromBoards(): if settings.squad is missing AND
  settings.boards[0] exists with a valid key, rebuild settings.squad from
  settings.boards[0]. Runs FIRST in the migration chain, so affected users
  automatically recover on their next extension load.
- Disabled migrateToV1_1_0 — now a no-op. Kept the function signature so
  the chain still runs; just doesn't do anything that breaks state.

---

## v1.4.4 (2026-05-23) — Sentry views accept full URLs (BREAKING)

**Breaking:**
- Sentry views are now configured by pasting their full Sentry URL instead of
  the previous Label|ViewID|projectIds pipe-format
- On upgrade, existing pipe-format entries are CLEARED. A one-time amber
  banner appears in Settings asking users to re-add views from their URLs

**Added:**
- parseSentryUrl(url) — extracts baseUrl, orgSlug, viewId, projectIds[],
  environment, query, sort, statsPeriod from any Sentry view URL
  17 new unit tests covering valid, invalid, edge cases, malformed input
- Dynamic row UI in Settings: label input + URL input + remove button per row
- Live URL preview: green check + parsed summary on valid URL,
  red border + error message on invalid
- + Add another view button appends a blank row
- Migration v1_4_4_sentry_url_format detects legacy formats and clears them,
  flagged via settings.migrationsApplied so it runs once
- runMigrations() now actually wired — called on background.js boot and
  on settings.js page load (was orphaned dead code)

**Removed:**
- Sentry views textarea with pipe-delimited format
- Pipe-format parsing from background.js — only the new shape is consumed

**Why this changed:**
The pipe-format required users to manually extract viewID and project IDs
from a Sentry URL. Now they paste the URL we already have access to and
we parse everything automatically. Less friction, fewer errors.

---

## v1.4.3 (2026-05-23) — Resize warning, equal chart heights, API-level support filter

**Fixed:**
- ResizeObserver loop completed with undelivered notifications warning
  Caused by synchronous renderSprintAnalytics() call inside the observer
  Now wrapped in requestAnimationFrame so layout changes happen on next frame
- Burndown and Time Logged cards now equal heights when side-by-side
  align-items: stretch on the flex container; each card has flex:1 + 100% width

**Changed:**
- Support boards now filter closed tickets at the API level (JQL appends
  statusCategory != Done) instead of fetching all and hiding client-side
  Faster initial load, less data over wire
- Removed N closed hidden indicator (we no longer fetch the closed count)

---

## v1.4.2 (2026-05-22) — Mini progress bar in all collapsed board headers

**Changed:**
- Sprint header and all extra board headers (including support) now show a
  visual mini progress bar instead of text status counts
  Format: [▰▰▰▰▱▱▱▱▱] 48% done · 6 in flight · ⚠ At risk
- Sprint header: risk text moved from top line to pill format inside the bar
- Support board header adds unassigned count: 3 unassigned (warns if > 0)
- Support board also surfaces blocked-external and BreachedSLA as pills
- In-flight count includes all indeterminate statusCategory tickets
  (In Progress, QA Testing, QA Rejected, Code Review, etc)

**Removed:**
- Text status breakdown (15 Closed · 3 In Progress · ...) from collapsed headers
  This was tier-2 info; replaced with a visual bar that scans in 1 second
  Status names still visible in the expanded ticket list

---

## v1.4.1 (2026-05-22) — Tab icon regenerated + progress card style

**Fixed:**
- Tab icon (side panel) was a rotated/diagonal grid (legacy v1.0 PNG); regenerated
  icons/icon16/32/48/128.png from the same SVG used in the panel header.
  All icon sizes now show 4 aligned squares matching the header logo
- Sprint progress card restyled to match Burndown and Time Logged cards:
  same darker surface background, border, padding, and uppercase title style

---

## v1.4.0 (2026-05-21) — Polish: progress by points, card layout, resize, icon

**Fixed (critical):**
- Sprint progress bar was counting tickets — now counts by STORY POINTS to
  match the burndown and sprint header (was 52% by ticket count vs 27% by points)
- Falls back to ticket count only when no story points exist at all
- Progress bar header shows '(by pt)' or '(by tickets)' for clarity

**Fixed:**
- Layout did not update when side panel resized past the 520px breakpoint
  ResizeObserver was comparing against captured const sideBySide value from
  the initial render. Now persists layout state on wrap.dataset.layout
- Sprint Analytics moved ABOVE the sprint collapsible header so the sprint
  collapsible (header + ticket list body) stay visually grouped together
- Tab icon (favicon) now matches the action icon — added <link rel='icon'>
  to popup.html pointing at icons/icon32.png and icons/icon16.png

**Changed:**
- Burndown and Time Logged charts now wrapped in styled cards matching
  the Sprint Progress card style
- Chart cards use --surface (darker) vs --surface-raised (collapsibles)
  for visual hierarchy

---

## v1.3.9 (2026-05-21) — TDZ fix + progress bar in analytics + inline member filter

**Fixed:**
- ReferenceError: Cannot access 'stories' before initialization
  TDZ: const stories was declared AFTER code using it in renderExtraBoards
  Fix: move const stories = board.stories to before displayStories/closedCount

**Changed:**
- Sprint progress bar moved from ticket list into Sprint Analytics section (top)
- Team member filter moved from Settings page into inline popover on the timesheet
  chart header: 👥 N/M button opens a checklist, Apply saves and re-renders chart
  No longer requires loading dashboard first before configuring members in Settings

---

## v1.3.8 (2026-05-21) — Sprint progress bar + per-section loading indicators

**Added:**
- Sprint progress bar: segmented bar (green=done, blue=in-progress, gray=not started)
  with percentage labels — shown at top of expanded sprint section
- Per-section loading pills: each section (Sprint, Sprint Analytics, Sentry, Extra Boards)
  now has its own pulsing indicator that appears independently when its data is loading
  Sprint/Analytics/Boards clear when partial-update:jira arrives
  Sentry clears when partial-update:sentry arrives
- setSectionLoading(source, loading) helper controls all pills consistently

---

## v1.3.7 (2026-05-21) — Support board closed filter + team member monitoring + chart layout

**Added:**
- Support boards (name contains 'support') now hide closed/QA Accepted tickets
  from both the collapsed summary and the expanded ticket list
  Counter shows 'N OPEN' (not TOTAL); closed count shown as '· N closed hidden'
- Settings: Team members to monitor — checkboxes for each discovered member
  Members auto-populated after first sprint analytics fetch
  Unchecked members hidden from the time-logged chart
  Select all / Deselect all controls
- Sprint Analytics charts side by side when panel width >= 520px
  Dynamically switches via ResizeObserver when panel is resized
  Falls back to stacked below 520px

---

## v1.3.6 (2026-05-21) — Chart polish + refresh loading state + error resilience

**Fixed:**
- Timesheet: full display names shown (up to 14 chars, then ellipsis) instead of first-name-only
- Timesheet: smaller chart (ROW_H 28→20, BAR_H 9→7) — fits more members without scrolling
- Burndown: smaller chart (H 175→150)
- Refresh button (↻) now shows loading state on ALL sections simultaneously:
  sprint, sentry views, extra board counts — not just sprint header
- Background worklog fetch wrapped in 15s timeout to prevent service worker termination

---

## v1.3.5 (2026-05-21) — Timesheet: worklogDate JQL covers all subtasks

**Fixed:**
- Team members log time on subtasks ([FE] Implementation, etc.) not parent stories
- Subtasks are not directly in the sprint, so per-story worklog fetch missed them
- Per-issue API was also N calls (1 per sprint story) even after v1.3.4

**Changed:**
- New jira-api method: getSprintWorklogs(project, startDate, endDate)
  Uses JQL: project = X AND worklogDate >= start AND worklogDate <= end
  Returns ALL issues with worklogs in the sprint period, including subtasks
  Only 1 API call; rare fallback for issues with >20 inline worklogs

---

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
