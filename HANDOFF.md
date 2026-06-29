# HANDOFF.md — Session State

> **Read this before starting any work.**
> Update this at the end of every session.

---

## Current version: v2.21.1

> **Phase 2b shipped (v2.21.0): the visible overlay.** timesheet-svg.js draws a hatched
> slate busy sub-bar (+ busy total + legend) under each logged bar when a member has
> busyHours; popup.js fetches free/busy lazily per sprint range (refreshUtilization),
> attaches busy via attachBusyToMembers, and renames the card to TIME UTILIZATION when
> active. Off by default; squad + sprint scope. Render test added. **Next: port to DevPulse.**


## Last session: Ahmed + Claude — 2026-06-17

> **Time Utilization (in progress).** Phase 1 landed: `src/utilization.js` (all-busy
> compute, merges overlaps) + `src/gcal-auth.js` (Google free/busy auth via implicit
> launchWebAuthFlow — no secret, client ID comes from Settings at runtime) + tests
> (anchored to real freebusy data). No version bump yet (not user-visible).
> **Auth reworked → getAuthToken (Chrome Extension OAuth client).** Implicit/web-app
> flow was blocked by Google; switched to chrome.identity.getAuthToken. manifest now has
> `key` (stable ID `ilmemiomepdmbfiohjfeejbbaagfgcfd`) + `oauth2{client_id PLACEHOLDER, scopes:[freebusy]}`.
> **User action:** create a Google Cloud OAuth client of type *Chrome Extension*, Item ID =
> that extension ID, then paste the generated Client ID into manifest.oauth2.client_id and
> reload → Settings ▸ Time Utilization ▸ Connect. **Then phase 2b:** the chart overlay.

> **Phase 2a landed (connect capability):** manifest perms (`identity` +
> `https://www.googleapis.com/*`), `fetch-freebusy` background handler, and a Settings
> section (Client ID + Connect button + per-member email map) wired to gcal-auth
> (`getCachedToken` added). Client ID stored in settings only, never in code. No version
> bump yet (chart not visible). **Next (phase 2b):** Settings UI (client ID, Connect button, member→email map),
> `fetch-freebusy` background handler, chart overlay in src/render/timesheet-svg.js +
> rename to “Time Utilization”, popup wiring, manifest perms (`identity` +
> `https://www.googleapis.com/*`). Then bump version + changelog. See docs/DECISIONS.md.


### Usage analytics arc (T-UA-1)

Goal: the `zealer-dashboard` Sentry project wasn't showing useful usage insights.
Diagnosed live from Sentry screenshots — **ingestion was healthy all along**
(16 releases tracked; `app_opened` events carrying user/release/squad). The real
situation: ~21 of 22 events were Ahmed's own dev-reloads (versions 2.10→2.17 in
two days) + one real user (`i.mohamed`), so there was simply almost no real usage
yet, viewed through the wrong lens (the perf/Release-Health overview, on the
Unhandled tab). `section` and `role` tags were both verified present on real
events — the "missing in dropdown" was Sentry not surfacing low-volume tags.

**Phase 1 (no app code):** built four Sentry Dashboard widgets with Ahmed
(Active Users line, Version Adoption table, Feature Usage, Usage by Squad).
Learnings now in docs/USAGE-ANALYTICS.md: use Dataset=Errors; Table beats Bar
(Categorical) which throws "Something went wrong"; X-Axis IS the group-by on
categorical bars; low-volume tags need `tags[key]` or Discover; switching chart
type clears the Filter; dashboard project/time filters only apply after save.
Rollout disclosure message drafted (leads with what the tool is, then the
analytics notice) — Ahmed to send with an install link.

**Phase 2 (this release, v2.18.0):**
- Rolling per-user profile: `foldAppOpen` + `bumpCounter` (pure, in
  src/usage-telemetry.js), folded in `maybeLogUsage`, stored in
  `chrome.storage.local.usageStats`, attached to `app_opened` as tags
  (`days_active`, `total_opens`, `first_version`) + `usage_stats` extra.
- Action tracking: `action_taken` events (`action` tag) for `export_report`
  (report.js exportCurrent, demo-guarded), `scope_toggled` (wireScopePills),
  `ticket_clicked` (insights data-jira-key handler + wireTicketClicks).
  `trackAction` helper in popup.js (NOT deduped); `track-action` handler +
  `trackAction` in background.js; section counts also bumped in trackSectionView.
- 10 new unit tests (25 total in usage-telemetry suite). Role/section fixes
  dropped from scope — both confirmed healthy.

### What's next
- Ahmed sets the dashboard project/time scope and evaluates the four widgets.
- After real rollout traffic, add Feature Usage + Action Usage widgets (the
  `section`/`action` tags will appear in the dropdown once they have volume).
- Optional later: exclude Ahmed's own account from per-user widgets.

---

## Prior session: Ahmed + Claude — 2026-06-04

### Completed (v1.8.7 → v2.0.0)

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
| v2.20.0 | Ported the phase-sequenced subtask Gantt from DevPulse (e781371 v1.1.0), with detection corrected for the team naming. WHAT: subtasks in the Sprint Timeline lay out by phase — each function (BE/FE/POS) on its own lane, impl→review sequential within the lane, functions parallel, QA on one lane AFTER all function work; bar width = effort (estimateHours/6, per-phase default for unestimated, MIN 0.25d floor). Presentation-only, NOT a capacity scheduler (Sprint Planner keeps that). FILES: (1) src/gantt.js — added getFunctionPrefix/detectPhase/scheduleChildren near dayColIndex; CORRECTED detection vs DevPulse: getFunctionPrefix matches bracketed [BE] OR bare BE/FE/POS (^\s*\[?\s*(BE|FE|POS)\s*\]?\b), detectPhase handles bare QA + [QA] + qa word, review|cr. Render: replaced one-lane-per-assignee with scheduleChildren — schedule computed per row, nLanes drives dynRowH, bars drawn from leftPct/widthPct/lane, still assignee-coloured, phase shown via ↳ + label (review·/QA·) + tooltip, QA bars dashed border. Removed now-unused childAssignees. (2) src/parsers.js normalizeStory emits estimateHours from timeoriginalestimate (s→h, /3600, 2dp, null when 0/absent). (3) src/jira-api.js added timeoriginalestimate to BOTH story (getSprintStories ~415) and subtask (getSprintSubtasks ~442) field lists. (4) src/mock-data.js relabelled all 16 demo subtasks to the convention (BE implementation/BE Review/FE/POS/QA…) + estimateHours, so phasing shows in Demo. (5) tests/gantt-schedule.test.js NEW (12 tests incl. bare-prefix cases); parsers.test.js shape updated (+estimateHours:null). VERIFIED scheduling: DEMO-5 BE impl→review then QA after; DEMO-9 BE+FE parallel; DEMO-2 BE+POS parallel, QA after. 30 suites + pre-flight green. NOT ported: DevPulse generic demo data; scrubbed headers (no DevPulse refs in touched files). |
| v2.19.9 | Two fixes. (1) PACE/CAP LINE: user reported the time-logged chart showed only the cap line, not pace. Root cause found: the capFixed/capPace block guarded on state.currentSprint?.startDate and read start/end ONLY from currentSprint, while sprintStart/sprintEnd (used by the rest of renderTimesheet) fall back to sprintAnalytics.startDate/endDate. So a sprint whose dates live in sprintAnalytics (or with currentSprint.startDate absent) computed capPace=0 → pace line hidden while cap could still come from elsewhere. FIX: the block now guards on the derived sprintStart and builds start/end from sprintStart/sprintEnd (same fallback as the rest). Also clamped pace elapsed: paceCutoff = (end && today>end) ? end : today, so after sprint close the pace marker rests at the budget instead of drifting past it. Verified renderer draws BOTH lines given {fixed,pace} (e.g. fixed 60 / pace 42); could not reproduce the user’s exact real-data case from sandbox (no network) — if still cap-only, need their sprint startDate/endDate values. (2) RICHER GANTT SUBTASKS (user chose richer breakdown over dependency arrows — the Gantt has NO dependency-arrow rendering, only parent→child sub-lanes + date sequence; line 349 confirms). Added 9 subtasks (DEMO-1a/b/c done, DEMO-2a/b/c done, DEMO-8a/b/c mixed) → 16 total across 6 parents (was 7 across 3). All have Zeal assignees, valid parents, dates within parent windows; verified attachChildren wires them (DEMO-1:3,2:3,5:3,7:2,8:3,9:2). 29 suites + pre-flight green. |
| v2.19.8 | Demo-data realism ported from DevPulse (the held item from v2.19.6), per user noticing the burndown + gantt mock data differed. BURNDOWN: Zealer hand-rolled BD_IDEAL/BD_ESTIMATE/BD_ACTUAL arrays where BD_ESTIMATE_NUMS = [...BD_IDEAL_NUMS] (estimate line was a copy of ideal → they overlapped). Replaced with MOCK_BURNDOWN = computeBurndownSeries(MOCK_SPRINT, STORIES) — the SAME engine the live app uses. Verified Zealer STORIES already carried the exact fields the engine reads (s.closedDay for actual, s.dueDate for estimate), so it was a clean wire-up. Added static import of computeBurndownSeries from ./burndown.js at top of mock-data.js; removed the BD_* arrays + hand-rolled object; defined MOCK_BURNDOWN AFTER MOCK_SPRINT (engine needs the sprint) and before MOCK_ANALYTICS. Output now byte-identical to DevPulse: ideal smooth 59..0, estimate due-date-stepped, actual close-stepped — all diverge. GANTT: added 5 subtasks (DEMO-5c, DEMO-7a/b, DEMO-9a/b) to MOCK_SPRINT.subtasks (was 2, now 7). KEPT Zeal assignees (Ahmed/Sara/Omar) rather than DevPulse genericized form — DevPulse 82c0666 also genericized the demo data (C3, white-label) which we deliberately did NOT take. Verified: node --check; all parents (DEMO-5/7/9) exist; full suite 29 green; pre-flight PASSED. |
| v2.19.7 | Ported the mock-role-preview system from DevPulse (per user: clone the mock buttons + their conditions; skip icon refresh as already present) + made calendar collapsed by default. CHANGES: (1) settings.html — added #mock-role-row with Mock as EM/Engineer buttons (.mock-role-btn, data-mock-role, EM bar-chart + Engineer code-brackets SVGs) between the demo toggle and demo-mode-active-note. (2) styles.css — appended .mock-role-btn / :disabled / .active rules (excluded DevPulse .settings-links which is part of the settings-redesign Zealer did not take). (3) settings.js — replaced the demo block with the mockRole-aware applyDemoUI(on,role): buttons enable/disable + .active toggle; demo toggle sets session {mockModeEnabled,mockRole:em default}; each Mock-as button sets session {mockModeEnabled:true, mockRole} and sends mock-mode-changed. (4) popup.js — added state.mockRole; boot() reads session mockRole, defaults to em when mock on, sets state.settings.role + viewScope, injects mock, no longer requires a saved role; mock-mode-changed listener reads mockRole, sets role/viewScope, calls injectMockState()+initCalendar(); renderEngineerProgressCircles guard changed from (role===engineer || state.mockMode) to (role===engineer) — the My-Tasks gating fix, now valid because mockRole sets the role in demo (was SKIPPED in v2.19.6 precisely because Zealer lacked these buttons). (5) popup.js initCalendar — calendar card now COLLAPSED by default: after section reveal, a per-session section.dataset.calCollapsedInit guard sets calendar-card display:none + chevron ▶ once, so a user expand is not undone by refresh/tick; header + countdown remain visible. Tested: node --check on popup.js+settings.js; full suite (29) green; gating logic spot-checked (EM hides, Engineer shows My-Tasks); mock-as-em ID matched HTML(1)/JS(1); pre-flight PASSED. |
| v2.19.6 | Cross-port from DevPulse (the-dashboard white-label fork) — reviewed commit-by-commit per user instruction NOT to take commits blindly. PORTED: SLA breach surfacing (DevPulse 1846b37) — src/render/support-board-svg.js counts BreachedSLA labels per status, red per-row marker + summary banner mirroring blocked-external; base was byte-identical so it applied cleanly; SCRUBBED the DevPulse header comment back to Zealer Dashboard on the copied file. Ported the matching test file (3 new SLA tests, 14 total) — no white-label content. Added BreachedSLA label to SUP-3 (In Progress) + SUP-7 (Open) in mock-data so the indicator demos. INTENTIONALLY SKIPPED: (1) icon refresh v0.6.2#3 — already in Zealer v2.19.1; (2) My-Tasks gating v0.6.2#2 (removed ||state.mockMode) — DevPulse-specific: it has EM/Engineer preview buttons that set role in demo; Zealer has NO mockRole preview (uses real saved role), so porting would break Zealer demo; (3) default-to-EM mock v0.6.2#1 — same preview-button dependency; (4) work-week selector v0.5.0 + branding.js + telemetry removal — white-label-only by design. HELD (user judgment): realistic MOCK_BURNDOWN via computeBurndownSeries (v0.6.1) — demo-only cosmetic, not a clean copy (depends on Zealer MOCK_SPRINT/STORIES shapes), left out to keep port low-risk. DevPulse is at v1.0.0; calendar (T-CAL-1) flowed OUT from Zealer to DevPulse, not new. 29 suites + pre-flight green. |
| v2.19.5 | Calendar — REAL fetch failure fixed. The default "Calendar unavailable" came from reason:error (outer catch, background.js ~1396). Cause: `await import(./src/calendar.js)` (DYNAMIC import) inside the background service worker — unreliable in MV3 and a documented trap in this project (dynamic import fails silently in worker/options contexts → use static imports). FIX: added top-level static import { parseICS as parseCalendarICS, todaysMeetings as calendarTodaysMeetings } from ./src/calendar.js (background.js line ~19) and the fetch-calendar handler now uses those; removed the dynamic import (verified 0 remaining). ALSO: popup now carries resp.message into _calErrorMsg and the default branch shows the actual error text (msg + detail) instead of a generic line, so any future unexpected throw is visible. Cleared _calErrorMsg on success. CAVEAT: still not live-verifiable in sandbox (no network), but this removes the most probable real cause (the only un-handled exception path) and surfaces detail if anything else throws. NOTE on Google side: the secret iCal URL may need the calendar public; propagation can lag minutes; making a work calendar public exposes meeting titles (policy consideration) — discussed with user. 29 suites + pre-flight green. |
| v2.19.4 | Calendar "not configured despite valid URL" — REAL ROOT CAUSE found. Log fromMsg:true fromStore:true proved the bg HAD the URL and passed the not-configured check; the fetch was failing downstream BUT renderCalendarCard had a trailing catch-all `if(!_calView){...Calendar not configured.}` AND the 1s _calTickTimer called renderCalendarCard with NO args every second → within 1s the tick overwrote the real error message (network/http-NNN/not-ics) with the catch-all "not configured". FIX: added module-level _calError state; refreshCalendar sets _calView+_calError explicitly on each outcome (success clears error; failure sets _calView=null + _calError=reason); renderCalendarCard() now takes NO param, renders from _calError (covers not-configured/network/not-ics/http-*/default + a Loading state when neither view nor error yet); tick wrapped as ()=>renderCalendarCard(). NET: the card now shows the ACTUAL failure reason; the real live-fetch failure (still unverifiable in sandbox — no network) is now surfaced for the user. Likely real reason is network (host perm/redirect) or http-NNN — user will now see which. 29 suites + pre-flight green. |
| v2.19.3 | Calendar "not configured despite saved URL" fix. SYMPTOM: section visible (popup state.settings.calendar.icsUrl truthy) but card showed not-configured (background fetch-calendar read settings.calendar.icsUrl as falsy) — popup and background resolving the setting independently and disagreeing at fetch time. FIX: refreshCalendar now sends { type:fetch-calendar, icsUrl: state.settings.calendar.icsUrl }; background prefers message.icsUrl, falls back to chrome.storage.local settings.calendar.icsUrl, then fetches the resolved icsUrl. Removes the cross-context mismatch entirely. Added console logs + a diag payload (hasSettings/calendarKeys/calPresent) on the not-configured branch so any residual mismatch is visible. CAVEAT: still cannot run a live fetch in the sandbox (no network); this removes the most likely cause (state mismatch) and the prior v2.19.2 host-permission breadth + error surfacing remain. If it STILL says not-configured after this, the diag payload will show whether storage even has the calendar key. 29 suites + pre-flight green. |
| v2.19.2 | Calendar render robustness + field styling. (1) STYLING: iCal field used nonexistent CSS classes (.field-label/.text-input) → rewrote to the standard pattern: <div class=field><label><input><span class=field-hint>. (2) SHOWING UP: removed the calendar-enabled checkbox entirely (settings.html + settings.js load/save); the card now shows whenever cal.icsUrl is set (initCalendar gates on URL presence not the toggle); stored shape keeps enabled:!!icsUrl derived at save. Removing the toggle fixes the gotcha of URL-pasted-but-toggle-off → blank card. (3) REACH: broadened manifest host_permissions to https://*.google.com/* + https://*.googleusercontent.com/* (was only calendar.google.com) since Google secret-iCal URLs can redirect to another host the single perm did not cover — likely root cause of live fetch failing. May re-prompt on update. (4) DIAGNOSTICS: background fetch wraps the network call, returns reason network/not-ics/http-NNN; renderCalendarCard maps reasons to specific messages instead of blank. CAVEAT: live fetch still not verifiable from sandbox (no network) — but errors are now surfaced so the user can see WHY if it still fails. 29 suites + pre-flight green. |
| v2.19.1 | Calendar fixes + icon consistency. BUG FIX: live ICS card rendered nothing (worked in mock) because initCalendar() ran inside setupEventHandlers() BEFORE state.settings loaded (boot order: setupEventHandlers at line ~190, settings assigned ~194). Moved initCalendar() out of setupEventHandlers into boot(): after showScreen(today) on the live path, and after injectMockState() on the mock path. #1 renamed section to Today Meetings. #3 made collapsible: new #calendar-header (chevron #calendar-chevron) toggles #calendar-card display; header countdown #calendar-header-countdown stays visible when collapsed (renderCalendarCard writes both the header countdown and the body banner each tick). #4 icons: replaced the colored chart emoji on the Monthly Report (popup header report-btn, report.html h1, settings.html report h2 + text refs) with the EM role chart SVG (the bar-chart path from popup.js roleCards em). ALSO copied both role-select SVGs (EM bar-chart + Engineer code-brackets, fill=currentColor) into settings.html role pills (#role-pill-em/#role-pill-eng), replacing the 👔/💻 emojis, for consistency. styles.css +.cal-header-countdown. 29 suites + pre-flight green. |
| v2.19.0 | T-CAL-1 phase 1 — Today/meetings card (Google Calendar via ICS). NEW src/calendar.js (PURE: unfold/parseIcsDate/parseICS [VEVENT, all-day VALUE=DATE, UTC Z, floating-local, minimal RRULE expansion for today: DAILY + WEEKLY/BYDAY + UNTIL guard, CANCELLED skip, attendee count], todaysMeetings [today filter via dayKey, all-day separated, timed sorted, pickNext = upcoming else in-progress], countdownState [status none/in_progress/upcoming, alert when 0<minsUntil<=30 inclusive], formatCountdown/timeLabel; 22 tests). background.js: fetch-calendar handler (reads settings.calendar.{enabled,icsUrl}, fetch ICS, dynamic-import parseICS/todaysMeetings, cache in chrome.storage.session calendarCache, sendResponse view). popup: import calendar core + generateMockMeetings; initCalendar() on boot (demo→generateMockMeetings, else sendMessage fetch-calendar); _calTickTimer setInterval 1s recompute countdown; _calPollTimer 5min refetch (not in mock); renderCalendarCard (banner: none/in-progress/upcoming, cal-alert class + cal-flash dot when alert; timed + all-day rows; reuses existing escapeHtml). popup.html: #calendar-section + #calendar-card before insights. settings.html: Calendar section (#calendar-enabled, #calendar-ics-url password). settings.js: load+save settings.calendar.{enabled,icsUrl}. styles.css: .cal-* card styles + cal-blink keyframe (literal #dc2626 red — no danger token exists). mock-data generateMockMeetings (in-progress + within-30m + later + all-day). manifest +calendar.google.com host_permission, v2.19.0. AUTH = ICS URL (Option A, locked). CAVEATS: (1) ICS floating/TZID times treated as LOCAL — full IANA tz conversion out of scope phase 1; (2) RRULE expansion is minimal (daily/weekly-byday only); (3) not live-smoke-tested against a real Google ICS feed from sandbox (no network); logic is unit-tested. 29 suites. Phase 2 (meeting hours alongside logged, NOT subtracted) deferred. Leapsome owns leave → meetings only. |
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
