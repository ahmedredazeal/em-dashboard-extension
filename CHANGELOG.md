# Changelog

## v2.6.9 (2026-06-10) — Demo mode: progress circles render

The sprint + support donut circles are an engineer-mode-only feature, and the
guard `role !== 'engineer' → hide` was hiding them in demo mode for anyone
whose real role is EM (the demo keeps your real role). Since demo mode exists
to showcase every feature, mock mode now bypasses the role guard:
`role === 'engineer' || state.mockMode`. Real (non-demo) EM mode is unchanged
— circles remain engineer-only there.

With the mock data, the demo renders: sprint donut 11/16 pts (4 tickets) and
support donut 3 tickets for the mock "me" (Ahmed Reda).

---

## v2.6.8 (2026-06-10) — Usage endpoint → personal form + demo Sentry trend

**Usage logging now points at a personal-account Google Form.**
The Workspace policy forces domain restriction on org-owned forms, so the
form was recreated from a personal account (no restriction — anonymous
responses accepted by default), linked to a Sheet shared with the work
account. `USAGE_ENDPOINT` + all six `entry.*` IDs swapped. The
endpoint-aware flag auto-retries once per user against the new URL.

**Demo mode: Sentry trend now renders.**
Two bugs: (1) the trend chart reads from `getTrackedSeries()` →
`chrome.storage.sync` samples accumulated over days — it never looked at
the mock state, and (2) the mock samples used `{date, count}` instead of
the real `{day, count}` shape. Added a demo short-circuit in
`getTrackedSeries()` that serves `state.sentryTrendSamples` directly, and
rebuilt the mock samples: 14 days per view in the correct shape, with an
end-of-window spike on "Demo Issues" so the trend-spike alert has data.

---

## v2.6.7 (2026-06-10) — Support "Urgent" priority recognized

The Support board (HRMSP) uses an **Urgent** priority that wasn't in the
priority maps, producing a console warning per ticket and causing those
tickets to fall back to medium styling and mid-list Gantt sorting.

- `parsers.js`: `urgent` added to known priorities (warning gone).
- `gantt.js`: `urgent` added to the sort order (top tier, same as
  highest/critical) and to the badge colours (red, same as highest).

Usage-logging status: extension side confirmed fully working (ping fires with
complete payload). The Google Form endpoint is blocked by an org-wide
Workspace policy that forces domain restriction (the "Restrict to users"
toggle is hidden in form settings). Next step is a non-Google-restricted
endpoint — n8n webhook, personal-account form, or admin policy change.

---

## v2.6.6 (2026-06-10) — Usage logging via Google Form (anonymous, works)

The workspace-restricted Apps Script endpoint silently rejected anonymous
service-worker POSTs (confirmed: ping fired with full payload, no row landed,
and the Workspace admin console only offers "Only me" / "Anyone within
getzeal.io"). Replaced the mechanism entirely:

- **Endpoint:** a Google Form (`/formResponse`) with the domain restriction
  unchecked, linked to a private Google Sheet — responses land as rows
  automatically. Truly anonymous POST (`credentials: 'omit'`), form-encoded
  body mapped via per-question `entry.*` IDs.
- **Same once-per-user semantics:** the endpoint-aware `usageLoggedFor` flag
  sees a new URL and auto-retries once for every user, including those whose
  flag was set against the old broken endpoint.
- **Manifest:** `script.google.com` / `script.googleusercontent.com` host
  permissions removed; `docs.google.com` added.

Payload (unchanged): email, display name, accountId, role, version, squad.

---

## v2.6.5 (2026-06-09) — Diagnostic: loud log when usage ping is skipped

"No `[usage]` logs at all" turned out to mean `maybeLogUsage` was never invoked:
when Jira's `/myself` call fails or returns nothing, the `if (data.currentUser)`
guard skipped silently with no console output. Added a loud
`[usage] SKIPPED — fetchJiraData returned no currentUser` warning on that path
so the next test is conclusive.

How to test: open the service-worker console FIRST (chrome://extensions →
Zealer Dashboard → "service worker"), keep it open, then click ↻ in the panel.
You should now always see exactly one of: `[background] Current user: …` +
`[usage] sending ping…`, or the new `[usage] SKIPPED` warning, or
`[background] getCurrentUser failed: <reason>`.

---

## v2.6.4 (2026-06-09) — Fix: TDZ crash + Estimate vs Actual in demo

**`modeStart` ReferenceError (TDZ) crash fixed.**
`modeStart`/`modeEnd` were declared at line ~1085 of `renderInsights()` but
used at line ~1034 inside the `isEngineerMe` block. A previous refactor
(gantt section insertion) silently moved the date declarations below their
first use, causing a Temporal Dead Zone crash that broke the whole insights
panel. Moved the entire date block (`rawStart`, `rawEnd`, `sprintStart/End`,
`fmtDate`, `modeStart/End`, `modeRange`, `sprintOnlyRange`) to before
`isEngineerMe`, which is the correct declaration order.

**Estimate vs Actual now renders in demo mode.**
Mock timesheet members were missing the `estimated` field (total hours
estimated for the sprint). Added realistic estimated values to each
member — Estimate vs Actual now renders for both Squad and Me modes.

---

## v2.6.3 (2026-06-09) — Demo mode complete + circles placement + usage logging

### Demo mode — remaining gaps fixed
- **Support Board now renders.** Added `extraBoardsData` with a mock "Support Board"
  (9 tickets across Open/In Progress/Code Review/QA Testing/QA Rejected, 3 assigned
  to Ahmed Reda "me"). The support board chart renders alongside the burndown.
- **Time Logged / Estimate vs Actual now render.** The real-settings
  `monitoredMembers` filter was removing all mock accountIds → empty timesheet.
  `injectMockState()` now clears `monitoredMembers` and populates
  `discoveredMembers` with the mock team, and sets `viewScope = 'squad'` so
  the full team chart shows.
- **Support tickets assigned to "me"** — SUP-1, SUP-3, SUP-7 assigned to
  `mock-acc-ahmed`.

### Engineer progress circles — moved to correct position
The sprint + support donut circles were rendering below the Gantt (at the very
bottom) because `renderEngineerProgressCircles()` was called at the TOP of
`renderTodayScreen()`, before `renderInsights()` populated `#insights-content`.

The `#engineer-progress-row` div is now part of the `renderInsights` HTML
template (between `#sentry-trend-card` and the filters row), and
`renderEngineerProgressCircles()` is called at the END of `renderInsights()`
after the template is set — so the div is always in the DOM when populated.
Removed the premature call from `renderTodayScreen()`.

### Usage logging — credential fix
Switched `credentials: 'omit'` → `credentials: 'include'`. Since the Apps
Script endpoint is scoped to "Anyone within getzeal.io", org members' existing
Google browser sessions authenticate the request — no credentials stored in the
extension. Added `?v=3` to the endpoint to bust the cached `usageLoggedFor`
flag so every user retries once with the correct credentials.

---

## v2.6.2 (2026-06-09) — Fix: demo mode 3 bugs

Three bugs introduced in v2.6.0 with the Demo / Mock Data Mode feature:

**1. Toggle required close/reopen.**
Settings page wrote to `chrome.storage.session` but the popup had no listener
for the change. Added a `mock-mode-changed` runtime message: settings.js now
sends it after toggling, and the popup's message listener applies the change
immediately — `injectMockState()` on enable, `boot()` on disable.

**2. Empty content when demo mode was on.**
`injectMockState()` called `renderTodayScreen()` but never called
`showScreen('today')`, so the today screen div stayed hidden. Added
`showScreen('today')` before `renderTodayScreen()` in `injectMockState`.

**3. Burndown NaN polyline errors.**
`buildBurndownSVG` expects `ideal`, `estimate`, `actual` as plain number
arrays (one value per day). The mock data built them as `{day, pts}` object
arrays, causing `Math.max(...[{...}])` → NaN and SVG attribute errors.
Fixed: mock burndown now uses flat number arrays with the correct lengths.

**Usage logging not working (action required on your side).**
The `USAGE_ENDPOINT` URL contains `/a/macros/getzeal.io/` which means the
Apps Script was deployed as "Anyone within getzeal.io". Anonymous PINGs from
the extension are silently rejected. Fix: redeploy the Apps Script with
"Who has access: Anyone" and send the new URL — I will update USAGE_ENDPOINT.

---

## v2.6.1 (2026-06-09) — Gantt: startDate fix + collapsible + below time charts

- **startDate from `customfield_10015`** — Sprint Planner writes start dates to
  this field. Parser now reads `customfield_10015` first, falls back to the
  standard `fields.startDate`. Field added to the Jira sprint story fetch.
- **Collapsible Gantt** — the card header (label + sprint date range) is now
  a clickable toggle row with a ▲/▼ button. Click to collapse/expand. Default:
  expanded.
- **Moved below the two time charts** — the Gantt now sits after "Time Logged"
  and "Estimate vs Actual", consistent with its role as a deeper-drill view.
  It respects the same Me/Squad scope as the charts above it:
  - EM or Engineer "Squad" → all sprint tickets
  - Engineer "Me" → filtered to the engineer's own tickets ("MY TIMELINE")

---

## v2.6.0 (2026-06-09) — Demo / Mock Data Mode + Sprint Timeline (Gantt)

### Demo / Mock Data Mode
A session-scoped toggle in Settings (below the role selector) fills every chart
with realistic pre-built mock data so you can demo or explore the app without
real credentials. Resets automatically on browser restart.

- Toggle in Settings under "Demo / Mock Data Mode" — writes to
  `chrome.storage.session` (not local), so credentials are never touched.
- When ON: all settings below are greyed out/non-interactive; an amber banner
  "Demo mode active" appears with instructions. An amber strip in the popup
  toolbar shows "🎭 Demo mode — showing mock data" with an × to dismiss.
- When OFF (or on restart): normal boot with real credentials.
- Mock EM profile: DEMO Sprint 1, 15 tickets, 5 engineers, burndown, timesheet
  (hours × 5 members), 2 Sentry views, sprint history × 2.
- Mock Engineer profile: same sprint with `filterMine: true` in the Gantt and
  progress circles scoped to accountId `mock-acc-ahmed`.
- Uses session-storage so nothing is persisted to disk.

### Sprint Timeline (Gantt)
A horizontal Gantt chart rendered inside the Insights section — after the Sentry
trend card, before the member filter / timesheet area — for every sprint. No
time-filter dependency (always shows the current sprint).

- Matches the Sprint Planner's exact HTML/CSS layout: left label column
  (key + priority badge + summary + due date) and right % coordinate timeline.
- Bars span `startDate` (set by Sprint Planner) → `dueDate`; falls back to
  sprint start when `startDate` is absent.
- Sorted by priority (Highest → Lowest) then Jira rank (lexorank asc) — matches
  the planner's board order.
- Tickets without `dueDate` shown at bottom with an orange "⚠ No date" section.
- Today column highlighted in red, due-date dashed marker, overdue row tint.
- Assignee colour-palette legend at footer.
- **Click any ticket row** to open the issue in Jira (`jira.baseUrl/browse/KEY`).
- Engineer mode: `filterMine: true` shows only the engineer's own tickets.
- 30 unit tests (ported + updated for priority→rank sort).

### Also in this release
- `parsers.js`: `normalizeStory` now extracts `startDate` and `rank`
  (`fields.startDate`, `fields.rank || fields.customfield_10019`).
- `jira-api.js`: sprint story search now requests `startDate` and `rank` fields.
- `src/gantt.js`, `src/mock-data.js`: new modules.
- `tests/gantt.test.js`: new test suite (30 tests).

---

## v2.5.7 (2026-06-09) — Fix: Jira credentials enough to load dashboard

Removed the requirement for Sentry credentials before the dashboard loads.
Only Jira (baseUrl + email + token) is now needed to start. Sentry is optional
— missing Sentry just leaves the reliability section empty.

Affected: `background.js` credential guard + `popup.js` welcome-screen gate.

---

## v2.5.6 (2026-06-09) — Engineer progress circles moved inside Insights

The sprint + support donut charts (engineer mode) were sitting above and outside
the collapsible Insights section. Moved `#engineer-progress-row` to inside
`#insights-body`, after `#insights-content`, so the circles:
- collapse / expand with the Insights section like everything else
- appear at the bottom of Insights, right above the Sentry Issues section

No logic changes — the `renderEngineerProgressCircles()` call and rendering code
are unchanged; only the HTML placeholder position moved.

---

## v2.5.5 (2026-06-09) — Alert logic fixes + Sentry empty-state dismiss

### Alert rules

**Rule 4 `due_date_risk` — core fix (the screenshot bug).**
The rule was firing on day 1 with every committed ticket ("due by sprint end,
not yet done") because `dueDate ≤ sprintEnd` is true for the whole backlog at
sprint start. The threshold is now `overdue (dueDate < today)` or
`imminent (within the next 2 working days)`. On day 1 of the sprint in the
screenshot only the 6 genuinely overdue tickets fire; the 23 "due by sprint
end" are no longer noise. Text updated to distinguish the two cases.

**Rule 3 `stalled_burndown` — early-sprint grace period.**
Added a `isEarlySprint` guard (first 20% of working days, min 2) so the rule
can't fire during the normal ramp-up when no tickets have closed yet.

**Rule 5 `unassigned_work` — severity capped at medium early.**
During the early-sprint window severity is capped at medium (many teams
assign-as-they-go; a HIGH on day 1 is premature noise).

**Shared `isEarlySprint` helper** added to `src/metrics.js` (exported).
All three rules now use the same early-sprint definition as `sprint_goal_at_risk`.
Unit tests added for all three fixes, including a day-1 regression test that
locks in the "23 tickets → null" scenario.

### Sentry empty-state dismiss button

When the Reliability tab has no Sentry views configured (common for QA or
non-engineering roles), the empty-state card now shows a brief explanation and:
- an **×** close button (top-right) that permanently dismisses the card and
  stores the preference in `chrome.storage.local`.
- a **"Go to Settings →"** link for when they do want to configure later.

If Sentry views are configured but no issues exist, the original minimal
"No recent Sentry issues" message stays (no dismiss button needed).

---

## v2.5.4 (2026-06-09) — Cross-squad time + accountId-based engineer filter

Time Logged and Estimate vs Actual now answer one consistent question in both
charts: **engineer (all / selection / Me) × time (sprint / Qn) × ALL boards &
projects** — keyed by accountId, labelled by display name.

**Cross-squad totals (quarter).** The quarter view now reports each engineer's
time across *every* project, not just the squad's board. Two-pass fetch:
(1) project-scoped discovery finds who logged on the squad's board that period;
(2) an author-scoped cross-project query pulls those people's total time
everywhere (unioned with the known roster + ids from the popup). Estimate vs
Actual rides along (each worklog carries its issue's original estimate), so it's
cross-project too. The sprint timesheet was already cross-project for sprint
assignees — both modes are now consistent.

**accountId-based identity.** The member filter is now keyed on Jira accountId
instead of display name (names can collide or change), while still showing
display names in the UI. The discovered-member roster is stored as
`{accountId, name}` and accumulates from sprint assignees, worklog authors, and
quarter discovery. Selections saved before this change (by name) still match via
a name fallback and migrate to accountIds the next time you hit Apply.

Refactor: shared `_fetchWorklogIssues`; `mergeRoster` helper; `memberKey` /
`isMonitored` / `normalizeMember` helpers in the popup; settings page handles the
`{accountId, name}` roster shape.

---

## v2.5.3 (2026-06-08) — Fix: quarter timesheet only showed current-sprint loggers

The Time Logged and Estimate-vs-Actual charts, when set to a **quarter** (Q1–Q4),
only ever showed engineers who had also logged time in the **active sprint** —
so selecting 9 engineers could still display just 2.

Root cause: the quarter worklog query was author-scoped to the current sprint.
The popup seeded the request with `accountIds` taken from the *current sprint's*
timesheet, and the background then queried Jira with
`worklogAuthor in (those ids) AND worklogDate in <quarter>` — filtering everyone
else out before the data ever came back.

Fix: the quarter now uses a **project-scoped** query
(`project = <squad> AND worklogDate in <quarter>`) with **no author filter**,
aggregating every engineer who logged time on the squad's issues during the
quarter — the same scoping the sprint timesheet already uses as its fallback.
Refactored the shared pagination + truncated-worklog backfill into
`_fetchWorklogIssues`, used by both `getTeamWorklogs` and the new
`getProjectWorklogs`. Page cap raised 1000 → 2000 for full-quarter ranges.

Note: this scopes quarter time to the squad's own project. Time a squad member
logged on a *different* project isn't included in the quarter view (it wasn't
reliably before either); the member filter still applies on top by display name.

---

## v2.5.2 (2026-06-07) — Usage logging: self-unsticking + visible

Two problems made the usage ping appear to do nothing:

1. **Stuck once-per-user flag.** A `no-cors` request resolves even when Google
   redirects it to a login page, so the old boolean `usageLogged` flag got set
   to `true` after the very first (failed) attempt — and every later run
   short-circuited *before* logging or retrying. Replaced it with an
   **endpoint-aware** `usageLoggedFor` flag: logging fires once per user *per
   endpoint URL*, so changing the URL (or this upgrade) re-triggers one attempt
   and nobody stays stuck against a broken URL.
2. **No visibility.** Added clear `[usage] …` console lines for every branch
   (skip reasons, payload, send/fail) so it's obvious in the service-worker
   console what happened.

Also switched the ping to an **anonymous** POST (`credentials: 'omit'`), which
is the correct mode for a public Apps Script web app.

> Note: rows only appear if the Apps Script is deployed with **"Anyone"**
> access. A `/a/macros/<domain>/` URL is domain-restricted and will silently
> drop anonymous pings — redeploy as "Anyone" and update `USAGE_ENDPOINT`.

---

## v2.5.1 (2026-06-07) — Fixes: Sentry resilience + usage email

**Sentry fetch no longer blanks the dashboard on a bad project.**
A view whose URL points at a deleted/renamed project returned a 404
("Project does not exist") that rejected the whole `fetchSentryData`, so
`saveAndNotify('sentry')` never ran and the trend chart didn't render.
Wrapped the `else` branch and the full function body in try/catch — the
fetch now always returns partial results; a single bad view just shows an
error while the others (and the trend chart) render normally.

**Usage logging now works when Jira hides the email.**
The once-per-user ping required `emailAddress`, but Jira can return it empty
depending on profile privacy — so logging was skipped and no row was written.
Now gated on `accountId` (always present); the email is still sent when Jira
provides it. Added a console line on each ping for easier debugging.

---

## v2.5.0 (2026-06-07) — Usage logging (once per user)

The extension now sends a single anonymous-to-the-team usage ping the first
time a user's Jira identity is known, so the admin can see who has tried it.

- **Endpoint:** a Google Apps Script web app that appends a row to a private
  Google Sheet. The script runs as the Sheet owner on Google's servers — no
  Google credentials live in the extension, only the public POST URL.
- **Once per user, ever:** gated by a `usageLogged` flag in `chrome.storage.local`,
  set only after the ping successfully goes out (no duplicates, no misses).
- **Payload:** Jira email, display name, accountId, role, extension version, squad key.
- **Safe by design:** fire-and-forget `fetch` wrapped in try/catch — a logging
  failure can never block or break the dashboard. `mode: 'no-cors'` so the
  request is processed without a CORS round-trip.
- **Manifest:** added `script.google.com` + `script.googleusercontent.com` to
  `host_permissions`.

Hook: `maybeLogUsage(currentUser, settings)` fires in `saveAndNotify` right
after the Jira `currentUser` is resolved.

---

## v2.4.4 (2026-06-07) — Splash gradient match

Replaced the flat top-to-bottom linear gradient with a **top-glow radial
gradient** to match the requested reference: a periwinkle→navy glow
concentrated at the top-centre that fades to pure black across the lower half.
`radial-gradient(125% 75% at 50% 0%, #787ed9 0%, #1d2c81 33%, #000 68%)`.

---

## v2.4.3 (2026-06-07) — Splash: drop ripples, gradient background

- **Removed the water-ripple effect** — didn't land visually.
- **Background is now a gradient** `linear-gradient(#787ed9 9.52%, #1d2c81)`
  (black fallback) instead of flat navy.
- **Tightened timing** now that the ripple window is gone: title fades in at
  1.25s (was 1.85s) and the splash clears at ~2.4s, so the cap no longer sits
  alone. Sequence: gradient → cap fades/scales in → title fades in → fade out.

---

## v2.4.2 (2026-06-04) — Copy fix

Welcome screen: "Sets your default view…" → "Set your default view…".

---

## v2.4.1 (2026-06-04) — Splash polish: correct logo, sizing, weight

Follow-up tweaks to the launch splash:

- **Correct icon.** The splash was using `cap-white.png`, whose wing emblem is
  painted navy — invisible against the navy splash background. Generated
  `cap-splash-white.png` from the full colour logo: the cap body is white and
  the wing + brim swoosh render as navy negative-space cutouts, so the complete
  logo stays readable on `#1A215E`.
- **Cap +20%** — 96px → 115px (ripples scaled to match).
- **Title −40%** — 26px → 16px.
- **"Dashboard" is now regular weight** (400) while "Zealer" stays semibold (600).

---

## v2.4.1 (2026-06-04) — Splash polish: correct logo, sizing, weights

- **Correct logo.** The splash was using `cap-white.png`, which is actually a
  navy wing on a white cap — its wing vanished against the navy background.
  Generated `cap-splash-white.png` (all-white cap from the real `cap-color.png`
  logo, with the wing + brim swoosh as navy negative-space cutouts) so the full
  brand mark reads cleanly on `#1A215E`.
- **Cap +20%** — 96 px → 115 px (ripple base scaled to match).
- **Title −40%** — 26 px → 16 px.
- **"Dashboard" now regular weight** (400) while "Zealer" stays semibold (600).

---

## v2.4.0 (2026-06-04) — Phase 6: Launch splash screen

A branded splash plays once per browser session when the side panel first opens.

**Palette:** Navy `#1A215E` background, white cap icon, white `#FFFFFF` text.
**Type:** "Zealer" in Nohemi SemiBold, "Dashboard" in DM Sans Medium.

**Animation timeline (~2.9s):**
1. ~0.55s — steady navy background
2. cap icon scales/fades in at centre
3. concentric water ripples emanate from the cap (~1.2s)
4. "Zealer Dashboard" title fades up and holds (~1s)
5. splash fades out, revealing the dashboard

**Fonts:** DM Sans is bundled (`fonts/DMSans-*.woff2`, SIL OFL). Nohemi is a
commercial font and is NOT bundled — drop a licensed `fonts/Nohemi-SemiBold.woff2`
into the fonts folder to enable it; until then "Zealer" falls back to DM Sans 500
/ a system geometric sans. See `fonts/README.md`.

Shown once per session via `chrome.storage.session`. Respects
`prefers-reduced-motion` (ripples disabled, instant reveal).

---

## v2.3.0 (2026-06-04) — Alert Settings (T-AS-1/2/3)

A new **Alert rules** section in Settings gives per-rule control over all
9 alert rules. Changes take effect on the next background refresh cycle.

**T-AS-1 — Enable / disable.** Each rule has a pill toggle. Disabled rules
are skipped entirely in `checkAlerts()`. All rules default to enabled so
existing users see no change in behaviour.

**T-AS-2 — Configurable thresholds.** Rules with numeric parameters expose
inline inputs (auto-saved on change/Enter):
- `scope_creep` — Threshold % (default 10%)
- `stalled_burndown` — Stalled days (default 2 working days)
- `sentry_trend_spike` — Min Δ issues (default 10) + Min % (default 25%)

**T-AS-3 — Per-rule desktop notification toggle (🔔).** Each row has a bell
icon that independently controls whether that rule fires a desktop
notification. Only applies to high-severity alerts; medium-severity alerts
never trigger desktop notifications regardless of this setting.

**Reset to defaults** button restores all rules to the original hardcoded
settings.

**Migration:** `migrateToV2_3_0_alertSettings` initialises `settings.alerts.rules`
on first run for existing users, preserving identical behaviour until they
change something.

---

## v2.2.0 (2026-06-04) — Rebrand to "Zealer Dashboard" + toolbar icon fix

**Renamed** from "EM Dashboard" to **Zealer Dashboard** everywhere user-facing:
manifest name/title/description, app-bar, page titles, welcome screen,
desktop notification titles, and all documentation. The tool serves both
EMs and engineers now, so the name and description are role-neutral.
(Internal identifiers — repo/folder name, `.em-only` CSS class, the
`role === "em"` value, file names — intentionally unchanged.)

**Toolbar icon fix.** The previous toolbar icon was a near-white cap on a
transparent background, so it disappeared on light-mode toolbars. Chrome
MV3 service workers can't reliably detect the browser theme to swap icons,
so the icon is now a **circular royal-blue badge** with the white cap
inside — visible on both light and dark toolbars. Regenerated icon16/32/48/128
and added an explicit `action.default_icon` to the manifest.

---

## v2.1.3 (2026-06-04) — Fix: engineer "Me" filter no longer shows squad data

Two problems caused the Time Logged and Estimate vs Actual charts to keep
showing the full team even with the Me scope selected:

1. **Stale cache fall-through.** When the cached timesheet was aggregated
   before v2.1.1 (no `byDate` field), the condition
   `isEngineerMe && myMember?.byDate` was false, so the code fell through to
   the squad chart (`buildTimesheetSVG(timesheetMembers)`) which renders ALL
   members. Restructured: in me-mode the squad chart is **never** rendered.
   - `byDate` present → personal daily/monthly bar chart (as designed)
   - `byDate` missing (stale cache) → "You logged Xh — click ↻ to load the
     daily breakdown" (single line, not the whole team)
   - no member match → "No time logged by you in this period."

2. **Fragile member matching.** `filteredTs` matched the current user by
   `displayName` only. Now matches by `accountId` first (reliable across name
   formatting differences), falling back to `displayName`.

After clicking ↻ once, the background re-aggregates with `byDate` and the
full personal time-series chart appears.

Added a unit test asserting `aggregateWorklogs` emits the `byDate` breakdown.

---

## v2.1.2 (2026-06-04) — Fix: sprint progress % matches Jira + "pts done / to go"

**Root cause:** `buildSprintProgressBar` had a subtle mixed-unit bug.
After correctly computing `donePts`, `inProgPts`, and `total` in story
**points**, three lines immediately overwrote them with **ticket counts**:

```js
// BUG (removed):
inProgPts = stories.filter(s => s.statusCategory === 'indeterminate').length;
openPts   = stories.length - donePts - inProgPts;  // pts - count = nonsense
total     = stories.length;                          // denominator became ticket count
```

This caused `donePct = donePts / stories.length` — dividing story **points**
by the number of **tickets** — yielding a completely wrong percentage
(e.g. 58% on screen vs 33% in Jira for the same sprint).

**Fix:**
- Removed the three overwriting lines; all variables stay in story-point units.
- Changed denominator from `committedPts` → `totalPoints` (live sprint total)
  so the % now matches Jira's point-based view exactly.
- Added **"x pts done · y pts to go"** line below the progress bar with
  absolute counts, matching the Jira burndown widget.

`buildMiniProgressBar` (the smaller collapsed-header bar) was already correct.

---

## v2.1.1 (2026-06-04) — Engineer me-mode: personal time-series charts

**Time Logged and Estimate vs Actual charts now show personal time-series
data when the engineer scope filter is set to "Me".**

Previously both charts showed the same full-squad horizontal bars regardless
of the Me/Squad toggle. Now:

**Time Logged (Me mode):**
- Sprint: vertical bar per calendar day, X = day label, Y = hours logged
- Quarterly: vertical bar per month, X = month name, Y = hours logged
- Card header changes from "TIME LOGGED" to "MY TIME"

**Estimate vs Actual (Me mode):**
- Same X axis as Time Logged
- Two grouped bars per period: estimate (slate, evenly distributed across
  periods) + actual logged (primary colour)
- If no estimates exist on assigned tickets, actual-only bars are shown
  with an explanatory note

**Data change:** `aggregateWorklogs()` now outputs `byDate: { 'YYYY-MM-DD': hours }`
on each member. This flows through sprint analytics cache and quarterly worklog
cache automatically. Existing cached data without `byDate` falls back gracefully
to the existing squad chart.

New helpers: `buildPersonalBarsSVG`, `personalSprintPeriods`, `personalQuarterPeriods`,
`buildPersonalChartCard`.

Squad mode and EM mode charts are completely unchanged.

---

## v2.1.0 (2026-06-04) — Phase 5: Engineer progress circles

Two personal progress donuts appear at the top of the Today screen in
engineer mode whenever the signed-in engineer has assigned work.
Both are always "me"-scoped regardless of the Me/Squad toggle.

**Sprint donut**
- Metric: story points
- Segments coloured by status category:
  Done (green) · In Progress (blue) · Open (slate)
- Centre: `{donePts}/{totalPts}` pts + ticket count hint
- Hidden when the engineer has no assigned sprint stories

**Support donut**
- Metric: ticket count across all configured support boards
- Same three-colour segments; "done" = `statusCategory === "done"`
- Centre: `{done}/{total}` tickets
- Hidden when the engineer has no assigned support tickets

**Implementation:**
- `buildDonut({ segments, centerMain, centerSub })` — pure SVG donut
  via `stroke-dasharray` on `<circle>` elements, no external deps.
- `renderEngineerProgressCircles()` — called first in `renderTodayScreen`;
  creates/hides `#engineer-progress-row` based on assignment presence.
- Legend (Done / In Progress / Open colour key) sits to the right of
  the donuts inside the same card row.
- Docs rule added to `AI_PROMPT.md` and memory: updating README,
  HANDOFF, TASKS, docs.html, CHANGELOG is mandatory before every commit.

---

## v2.0.2 (2026-06-04) — Move sentry trend chart below burndown

The sentry trend card (`#sentry-trend-card`) now renders inside
`insights-content` between the burndown/support-breakdown row (row 1)
and the filter control bar (Me/Squad or engineers DDL), so the order is:

  Sprint progress bar
  Burndown chart | Support board summary
  **Sentry trend chart**            ← moved here
  [Filter row: scope toggle / DDL]
  Time logged | Estimate vs Actual

Implementation: removed the static `sentry-trend-card` placeholder from
`insights-body` in popup.html; the placeholder is now injected as part of
`content.innerHTML` in `renderInsights()`, and `renderSentryTrend()` is
called (fire-and-forget) at the end of `renderInsights()` to populate it.

---

## v2.0.1 (2026-06-04) — Fix: restore deleted buildScopeToggleHtml + wireScopePills

The Python body-removal script in v1.9.9 (which cleaned up the duplicate
`renderRoleSelectScreen` body) accidentally deleted `buildScopeToggleHtml()`
and `wireScopePills()` — they fell between the old function body end and the
`renderInsights` comment that served as the removal boundary.

Result: `ReferenceError: buildScopeToggleHtml is not defined` whenever the
dashboard tried to render in engineer mode (called from `renderExtraBoards`).

Both helpers re-added at module level between `renderRoleSelectScreen` and
`renderInsights`.

---

## v2.0.0 (2026-06-04) — Fix: theme-aware logo on welcome screen

**Bug fix:** `renderRoleSelectScreen()` used a hardcoded `<img src="icons/cap-color.png">`
which always displayed the navy cap regardless of theme. In dark mode the white cap never
appeared. Replaced with the `theme-logo` dual-image span (`logo-light` / `logo-dark`) so
the CSS theme-switching rules apply correctly.

Also bumped to v2.0.0 to mark the completion of the dual-role architecture milestone
(Phases 1–3 complete: welcome screen, Me/Squad scope filters, settings split, EM squad
management, 9 alert rules, section reorder, popup.html deduplication).

---

## v1.9.9 (2026-06-04) — Welcome screen redesign + HTML deduplication

**Root cause fixed: duplicate screens in popup.html**
Three rounds of Python reorder scripts had progressively duplicated ALL screen
divs (auth, role-select, today, sprint-health, reliability) and ultimately
produced two full copies of the entire screen-container. This made the
"scaled-up header" appear below any active screen — the duplicate auth screen
and its theme-logo-72 caps were always partially visible. Rebuilt popup.html
atomically with exactly one copy of each screen.

**Unified welcome screen**
Both the "no role set" and "no credentials" cases now route to a single
\ screen instead of two different screens:
- When no role is set: shows role cards with "What's your role?" label above.
- When role is set but no credentials: shows greeting + "Go to Settings →"
  without role cards.
- The "Built at Zeal" footer removed from screen-auth (was bleeding through).

**Visual changes:**
- Greeting: "Hello, Zealer! 👋" replaces "How are you using this?"
- Logo: 120 px (3× previous) via .welcome-logo img tag (no theme-logo class).
- EM icon: ascending bar chart SVG (analytics/management feel).
- Engineer icon: code brackets </> (unchanged, already clean).
- Role cards: square (aspect-ratio 1:1), icon centred above title,
  max-width 160 px, centred in row.

---

## v1.9.8 (2026-06-04) — Fix section order, scope filter on charts/boards

**Section order (Today screen — correct this time):**
Alerts → Insights → Extra boards → Sentry Issues → Current Sprint.
Previous attempt (v1.9.7) accidentally put Sentry Issues first and created a
duplicate sentry-section. Rebuilt the entire screen-today body atomically.

**Sentry trend chart position:**
The sentry trend card now appears at the TOP of the Insights body (before
insights-content), so it renders above the burndown, time logged, and
estimate charts — no scope filter applies to it.

**Me/Squad scope filter now works on Time Logged + Estimate charts:**
Root cause: `wireScopePills(contentEl)` in renderInsights used `contentEl`
but the variable is named `content`. Undefined container → silent no-op.
Fixed to `wireScopePills(content)`.

**Me/Squad filter on extra boards (HRM Support etc.):**
- renderExtraBoards now applies the isEngineerMe scope filter to each
  board's story list.
- A full-width filter row (board name left, Me/Squad pills right) is
  rendered at the top of each board's section body in engineer mode.
- Scope pills in each board section are wired via wireScopePills.
- Ticket count badge shows "X MINE" vs "X OPEN" to reflect filtered state.

---

## v1.9.7 (2026-06-04) — UX: section reorder, filter row, scope fix, welcome icons

**Section order (Today screen):**
Sentry Issues → Insights (burndown / time / estimate) → Extra boards → Current Sprint.
Sentry moved first since filters don't apply to it. Current Sprint moved last.

**Me / Squad scope toggle — charts now update:**
`wireScopePills` previously only called `renderCurrentScreen()` (story list), missing
`renderInsights()` (time logged + estimate charts). Both are now called on every
scope change so the two charts update immediately.

**Sprint filter row:**
Replaced the inline scope toggle inside the ticket-count label with a full-width
header row at the top of the sprint section body: sprint name + date range on the
left, Me / Squad pills on the right — matching the Insights section header style.

**Welcome screen icons:**
Replaced 👔 / 💻 emoji with clean mono-colour SVG icons (people group for EM,
code brackets for Engineer). Removed the description text below each card — title
and icon only, cleaner layout.

**Test fix:**
`alerts.test.js` "first 2 days → early" used a hardcoded June 1 start date that
became stale. Replaced with today-relative date so the test is always valid.

---

## v1.9.6 (2026-06-04) — Code review: 6 bugs fixed (v1.8.7–v1.9.5 audit)

Full audit of all changes since v1.8.7. Six bugs identified and fixed:

| # | Severity | File | Bug | Introduced |
|---|----------|------|-----|-----------|
| 1 | Critical | `background.js` | `const squadKey = settings.squad?.key` was deleted by the Phase 1 `getCurrentUser` insert. Every Jira fetch threw `ReferenceError: squadKey is not defined`, breaking all data loading. | v1.9.2 |
| 2 | High | `popup.js` | `totalCount` used before declaration inside `memberFilterHtml` template in `renderInsights`. | v1.9.3 (patched v1.9.5) |
| 3 | Medium | `popup.js` | Engineer "me" timesheet filter: if `state.currentUser` not yet loaded, `ts.filter(m => m.name === undefined)` → empty timesheet silently. Now falls back to full list. | v1.9.3 |
| 4 | Medium | `popup.js` | Engineer story filter: same null-currentUser issue. `isEngineerMe` now gates on `!!state.currentUser?.accountId`. | v1.9.3 |
| 5 | Low | `popup.js` | Welcome screen `Continue` saved `settings.role` but not `settings.viewScope`, so a subsequent settings Save could collapse an engineer's scope to 'squad'. | v1.9.2 |
| 6 | Low | `settings.js` | Save handler used `settings.viewScope \|\| 'squad'` regardless of role. Changed to role-aware default so engineers always default to 'me'. | v1.9.4 |

No logic errors found in: burndown committed-baseline, alert rules, scope pill wiring, 
parsers (`assigneeAccountId` confirmed present), `todayIndex` propagation to alerts, or 
extra-board/support-board scoping (correctly excluded from me/squad filter — team charts).

---

## v1.9.5 (2026-06-04) — Fix: totalCount ReferenceError in renderInsights

**Bug fix:** The Phase 2 refactor left `totalCount` undefined in the member filter template, causing a ReferenceError on every analytics render. Added the missing `const totalCount = discoveredMembers.length` before the filter block.

---

## v1.9.4 (2026-06-03) — Phase 3: settings split + EM squad management

**Settings page split by role**
- All `.em-only` sections (extra boards, squad member management) are hidden
  in Engineer mode. Role toggle immediately shows/hides the relevant sections.
- `role` and `viewScope` are now preserved across Settings saves (they were
  previously wiped, causing the role selection to reset on save).

**EM squad member management (new section)**
- EMs see a new "Squad members" section in Settings with all discovered team
  members shown as removable tags. Names can be added manually (type + Add or Enter).
- Saving with a curated list sets `squadMembersCurated: true` in analytics —
  background auto-discovery then stops overriding the EM's intentional list.
- Removing the EM role or clearing the list re-enables auto-discovery.

---

## v1.9.3 (2026-06-03) — Phase 2: Me / Squad scope filter for engineer mode

**New: engineer mode view scoping**
- A **Me / Squad** pill toggle appears in engineer mode on:
  - Sprint tickets (next to the ticket count in the header)
  - Time tracking / Actual vs Estimate (in the analytics section header, replacing the EM squad DDL)
- **Me** (default): shows only stories assigned to the signed-in engineer
  (`assigneeAccountId` match) and that engineer's timesheet / estimate data.
- **Squad**: shows the full team view — identical to EM mode for those sections.
- Chosen scope persists across sessions via `settings.viewScope`.
- EM mode is unchanged: DDL squad filter stays as-is; no scope toggle shown.
- `wireScopePills()` + `buildScopeToggleHtml()` shared helpers ensure both
  sections always stay in sync (one click re-renders both).

---

## v1.9.2 (2026-06-03) — Phase 1: role foundation + welcome screen

**New: dual-role support plumbing**
- First-launch welcome screen — shown automatically when no role is configured.
  Two clickable role cards (Engineering Manager / Engineer) with descriptions;
  "Continue →" saves the role and navigates appropriately (credentials already
  set → dashboard, new user → Settings).
- `settings.role` stored in local settings; `state.viewScope` derived from it
  (`'me'` for Engineer, `'squad'` for EM) — ready for Phase 2 filters.
- Role pill toggle added to the top of Settings so the user can switch roles
  at any time without going through the welcome screen again.
- `JiraClient.getCurrentUser()` — fetches `/rest/api/3/myself`; stores
  `{ accountId, displayName, emailAddress }` in local storage as `currentUser`
  and in `state.currentUser`. Used in Phase 2 for the engineer "me" scope.

---

## v1.9.1 (2026-06-03) — Phase 2 alerts: 9 rules, all grounded in real data

**New & enhanced alert rules:**

| Rule | Trigger | Severity |
|------|---------|----------|
| `sprint_goal_at_risk` *(enhanced)* | Working-day-aware projection using committed baseline; distinguishes scope vs throughput | high/medium |
| `scope_creep` *(new)* | Points added after sprint start exceed 10 % of commitment | high/medium |
| `stalled_burndown` *(new)* | No points completed in last 2+ working days | high/medium |
| `due_date_risk` *(new)* | Open pointed tickets due on/before sprint end | high/medium |
| `unassigned_work` *(new)* | Open pointed tickets with no assignee | high/medium |
| `reopened_tickets` *(new)* | Tickets that reached Done then moved back to open | medium |
| `sentry_trend_spike` *(new)* | Day-over-day count increase in a tracked Sentry view | high/medium |
| `velocity_drop` *(gated)* | >15 % velocity drop over 2 sprints — fires only when history is populated | medium |
| `support_sla_breach` *(gated)* | Support tickets past SLA — fires only when ticket data is available | high |

**Supporting additions:**
- `metrics.countWorkingDays(from, to, days)` — accurate per-schedule working-day count.
- `metrics.committedBurnPrediction(sprint, workingDays)` — committed-baseline projection.
- `metrics.sentryDayOverDaySpike(currentCount, trendSamples)` — trend-grounded spike detection.
- `state.settings` and `state.sentryTrendSamples` now passed to `checkAlerts`.
- `currentSprint.todayIndex` and `currentSprint.scopeByDay` added for alert consumption.
- `checkAlerts` wraps each rule in try/catch so a single rule error never silences the rest.
- **Tests:** +22 (alerts.test.js) across 9 suites.

---

## v1.9.0 (2026-06-03) — Committed baseline burndown + engineers filter fix

**Burndown: committed baseline (matches Jira)**
- The burndown now anchors its guideline to the **sprint-start committed scope**
  instead of the live current total. Points are reconstructed from each issue's
  changelog, so estimate edits and mid-sprint additions appear as scope-change
  steps rather than silently rebasing the chart.
- Remaining-work line segments are colour-coded: green = work completed,
  amber = scope added mid-sprint, blue dashed = scope removed or estimate reduced.
- Hover tooltips now include scope info when relevant, e.g.
  "Jun 3 · 2 points removed · +6 scope added".
- Sprint header and progress bar denominator both use the committed baseline so
  every surface agrees with Jira (e.g. 47 pts, not the live 44).
- Legend updated: "Committed", "Done", "+Scope".

**Engineers filter fix**
- The 👥 badge now shows how many members are **selected** (e.g. 8/14) instead
  of how many of those selected have timesheet rows (which could show 3/14 for
  an 8-member selection and was very confusing).
- Selecting all members and clicking Apply now correctly stores null ("show all")
  instead of a full-name array, preventing the filter from looking active when
  it isn't.
- The filter button highlights in primary colour when a filter is active.

**Tests:** +13 new (estimateAtSprintStart, wasAddedAfterSprintStart, committed
baseline series); 63 total, all timezone-safe.

---

## v1.8.7 (2026-06-02) — Fix: burndown day-bucketing for mid-afternoon sprint starts

**Bug fix (root cause of "today shows no change"):**
- Days were bucketed by raw 24-hour windows measured from the exact sprint-start
  instant, not by calendar date. Sprints usually start mid-afternoon (e.g. 13:41),
  so a ticket closed the next morning fell *within* the first 24h window and was
  attributed to **day 0** instead of day 1. Combined with the same skew on "today",
  this collapsed each day's completed points onto the sprint start and made the
  current day read "no change".
- `dayIndex` now compares **calendar dates** (local midnight to midnight), and the
  burndown's total days, elapsed days, and today marker all use the same basis.
  Points completed today now land on today's point, matching Jira and the sprint
  progress bar.

This supersedes the v1.8.6 ceil/floor adjustment, which addressed the wrong layer.

---

## v1.8.6 (2026-06-02) — Fix: burndown not reflecting today's completed points

**Bug fix:**
- The burndown "Actual" line was drawn one day too far into the future, so points
  completed **today** rendered on the previous day's slot and hovering today's
  point read "No change" — even though the sprint header / progress bar correctly
  counted those points as done. Cause: the actual line's end-of-line index used a
  ceiling day count while completions are bucketed with a floor day count, an
  off-by-one. The actual line now ends on the true current day, so today's burn
  shows up immediately.
- Custom done-category status names (e.g. "Deployed", "Merged") are now recognised
  by their changelog transition, giving an accurate close day instead of relying
  on the last-edited date. This keeps the burndown's notion of "done" in step with
  the progress bar (which uses Jira's status category).

---

## v1.8.5 (2026-06-02) — Burndown: Jira-style hover tooltips

**Enhancement:**
- Hovering a point on the burndown "Actual" (remaining work) line now shows a
  Jira-style tooltip with the date and that day's change in remaining work —
  e.g. "Jun 2, 2026 / 4 points removed" (or "N points added" when scope grew,
  "No change" on flat days). Day 0 shows the starting points to go.
- Each point has a larger invisible hit-area for easy hovering, with a subtle
  highlight; the tooltip flips below the point near the top of the chart so it
  never clips.

---

## v1.8.4 (2026-06-02) — Fix: member filter showing only time-loggers

**Bug fix:**
- The engineers list in the timesheet member filter could collapse to only the
  handful of people who had logged time in the current sprint (e.g. 5 instead of
  the full 13–14), most often after the extension was reloaded from a new folder
  (which resets local storage and the accumulated member list).
- Members are now discovered from **sprint assignees as well as worklog authors**,
  so the filter shows everyone with a ticket in the sprint and repopulates the
  full team immediately after any storage reset.
- Defensive: saving Settings now re-reads the discovered-members list fresh from
  storage instead of the page-load snapshot, so a Save can never overwrite members
  the background discovered while the Settings page was open.

---

## v1.8.3 (2026-06-02) — Sentry chart: point hover tooltips + mid-span date

**Enhancements:**
- **Hover tooltips** — hovering any point on a trend line now shows a small
  tooltip with the view label, date, and issue count (e.g. "HRM All Issues · 2 Jun · 19").
  Each point has a larger invisible hit-area so the tiny dots are easy to hover,
  with a subtle highlight on hover.
- **Mid-span x-axis label** — when the chart spans more than 2 days, a middle
  date is shown between the first date and "today", giving the timeline a
  reference point instead of just the two ends.

---

## v1.8.2 (2026-06-02) — Sentry chart: dots on every point

**Enhancement:**
- The multi-view Sentry trend chart now draws a small dot on **every** data
  point (previously only the latest point of each line had a dot), matching the
  PDF/print view. Dots are smaller (r=1.5) to stay clean in the compact panel,
  with a slightly larger dot (r=2.2) on each line's latest reading so "today"
  still stands out.

---

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
