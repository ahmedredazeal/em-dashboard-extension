# TASKS.md — Shared Task List

> Last updated: 2026-06-29 (v2.24.0)

---

## 🔄 In Progress

- **Time Utilization** — completed v2.22.0 (overlay + Google-powered Today's Meetings, iCal hybrid). DevPulse port pending. Was: Phase 1 done: tested compute
  (`src/utilization.js`) + auth/fetch helper (`src/gcal-auth.js`). Phase 2: Settings UI
  (client-ID + Connect + member→email map), `fetch-freebusy` handler, chart overlay +
  rename, popup wiring, manifest perms. Then port to DevPulse. (docs/DECISIONS.md)

- **Time Utilization** — v2.24.0 added OOO/vacation handling (full-day busy blocks are
  excluded from meeting hours and shown as a 🌴N days-off badge beside the name) and ALPHA
  badges on the rougher sections. DevPulse port of the whole feature still pending.

_Nothing currently in progress._

---

## 📋 Backlog (approved, sequenced)

| Phase | # | Task | Size | Notes |
|---|---|---|---|---|
| Metrics | T-EVA-1 🔶 | Estimate vs Actual — fix estimate over-counting | M | `worklog-aggregator.js` accumulates `acc.estimateSeconds += wl.estimateSeconds` ONCE PER WORKLOG, but each worklog carries its issue's whole `timeoriginalestimate` → an issue with N worklogs (or logged by K people) counts its estimate N/K× → inflated "Estimated". FIX: sum each issue's original estimate ONCE (dedupe by issue key) + decide attribution across contributors (the estimate is per-issue, not per-author). Actual (Σ timeSpentSeconds) is correct. Parked per Ahmed until a solid story; section marked ALPHA in v2.24.0. |
| ~~5~~ | ~~T-P5-1~~ | Engineer sprint progress circle (pts, multi-status donut) | M | Always "me"-scoped; hidden if no assigned sprint stories; colors: Open=slate, In Progress=blue, QA=amber, Done=green; center = pts / ticket count hint |
| ~~5~~ | ~~T-P5-2~~ | Engineer support board progress circle (count, QA Accepted = done) | M | Count-based donut; QA Accepted is "done" (Closed excluded from API fetch) |
| ~~5~~ | ~~T-P5-3~~ | Hide both circles when no assignments | S | Check assigneeAccountId in sprint stories AND support board tickets |
| ~~Alert settings~~ | ~~T-AS-1~~ | Per-rule enable/disable toggle in Settings | M | `settings.alerts.rules[ruleId].enabled`; gate in `checkAlerts`; default all enabled |
| ~~Alert settings~~ | ~~T-AS-2~~ | Per-rule threshold config (scope creep %, stalled days, spike delta) | M | Input fields per rule in Settings alerts section; read in each rule |
| ~~Alert settings~~ | ~~T-AS-3~~ | Per-rule desktop notification override | S | `notifyDesktop: boolean` per rule; read in `notifyHighSeverity` |
| ~~6~~ | ~~T-P6-1~~ | ~~Splash screen with logo + animation~~ | — | Discuss style, timing, skip-on-reload when we reach this phase |
| ~~Charts~~ | ~~T-BR-1~~ ✅ | Bug reports charts (ideation pending) | L | Define what identifies a bug in Jira; incoming-vs-resolved, open-bug age, reopen rate, per-component; EM trend + engineer "my bugs". Planned alongside Gantt full-tab. |
| Calendar | T-CAL-1 (ph1 done) | Google Calendar sync: today meetings + next-meeting countdown + 30-min alert (phase 1) | L | Phase 1: show the signed-in engineer today meetings in the side panel with a countdown that turns red / flashing alert when a meeting is within 30 min. Phase 2 (deferred): show meeting hours ALONGSIDE logged sprint hours for visibility — NOT subtracted from the 6h/day capacity line (avoids double-counting + an availability model we cannot validate). CONSTRAINT: Zeal absence/approvals/leave are in Leapsome (needs super-admin, not granted to all) — so Calendar gives MEETINGS, never approved leave; design must not imply otherwise. AUTH DECIDED: (A) private iCal/ICS URL pasted in settings (light, no Google Cloud project/OAuth, serves Zeal + white-label identically, poll-based; countdown ticks client-side, poll ~5min for added/moved meetings). Option B (OAuth) kept as a documented fallback only; UI is auth-agnostic so a later switch would not touch the meetings UI. No new background alarm (panel-triggered, like the rest). Plan: docs/T-CAL-1-PLAN.md. |
| Gantt | T-GT-1 | Open Gantt in full-tab view + export to PDF | M | Like Sprint Planner's expanded view (gantt-print.html pattern); button in the Gantt header → new tab with wide layout; "Save as PDF" via print stylesheet. Pair with T-BR-1. |
| Distribution | T-DIST-1 🔶 | Auto-update from latest GitHub release (controlled, not every sub-version) | L | Self-update so users don't get a zip each time. KEY CONSTRAINT: only *promoted* versions reach users, not every patch. Chrome Web Store does this natively (the proper path) — or a self-hosted `update_url` manifest + a "stable channel" pointer file the extension polls. Security: must be signed/controlled so we can't be impersonated. Needs design discussion — several approaches with very different tradeoffs. |
| UX | T-DND-1 | Drag-and-drop reorder of Insights cards | M | Let users sort the Insights sections to taste; persist order in storage. Build AFTER the S-3 render extraction + a render scheduler (S-4), since reorder needs sections to be independent, individually-rendered units — doing it before the refactor would fight the current monolithic renderInsights. |
| ~~Charts~~ | ~~T-EBD-1~~ ✅ | Engineer personal burndown by due dates | M | A "my burndown" for an individual engineer driven by their tickets' due dates (not sprint commitment). Reuses src/render/burndown-svg.js (already extracted) + the existing due-date data. Scope: per-engineer remaining-work line vs an ideal line derived from due dates. |
| Export | T-EXP-1 | Scheduled auto-export of tracked Sentry views to a configurable destination (append/merge, not overwrite) | L | Settings: pick a destination + cadence (e.g. daily); a chrome.alarms job exports tracked-view data automatically and MERGES into the existing file (append new rows/dates, don't replace). KEY CONSTRAINT: MV3 extensions CANNOT silently write to an arbitrary filesystem path — chrome.downloads can't append (it creates new files), and the File System Access API needs a user-granted directory handle + may re-prompt per session. Real options to design through: (a) File System Access API with a persisted directory handle (best for true append, but permission/persistence caveats); (b) chrome.downloads writing timestamped files + a separate merge step; (c) export to a cloud destination (Google Sheet/Drive API, or append to a Sentry-adjacent store) instead of a local path. Needs a design discussion — the "merge into one file on a schedule, locally" ask collides with browser sandboxing, so we pick the closest workable model. |
| ~~Timesheet~~ | ~~T-CAP-1~~ ✅ | Time-logged capacity cap line at 6h/day (not 7h) | XS | The dashed amber capacity line in the Time Logged chart should use 6h/day. NOTE: the rate moved 8h→7h in v2.8.8; this lowers it again to 6h. One-constant change in buildTimesheetSVG's capacity calc + the label; re-verify the over-capacity ⚠ threshold and edge-clamp still read correctly. Quick — can ride along with another version. |
| Gantt | T-SPL-1 | Sprint Planner launch button in the Gantt header (open if installed → else store/GitHub page) | M | Add an icon button in the Gantt view header that opens the Sprint Planner extension if installed, else falls back to its Chrome Web Store listing (if published) or its GitHub page. Doubles as promotion for the Planner. Icon: take from the sprint-planner-extension repo. TECH NOTES: cross-extension "is it installed?" detection in MV3 needs either chrome.management permission (heavy — lists all the user's extensions, privacy-sensitive) OR a chrome.runtime.sendMessage handshake to the Planner's known extension id with externally_connectable configured on the Planner side. Cleanest: try a sendMessage ping to the Planner id; on no response, open the fallback URL. Needs the Planner's stable extension id + a tiny listener added there. Design discussion before build. |
| ~~Reports~~ | ~~T-RPT-1~~ ✅ | Monthly report, generated + stored locally, with a Settings-configurable destination | L | A monthly report (cadence: monthly) generated from dashboard data and persisted locally over time, so history accumulates rather than being a one-off view. User picks WHERE it's kept from Settings (a destination/path). KEY CONSTRAINT (same family as T-EXP-1): MV3 cannot silently write to an arbitrary filesystem path — chrome.downloads can't append/overwrite a chosen path, and the File System Access API needs a user-granted, persisted directory handle (may re-prompt per session). So "pick a destination in Settings + keep writing there monthly" must be designed against those limits — likely a persisted FS Access directory handle, or a cloud destination, or timestamped monthly files. Heavy overlap with T-EXP-1 (scheduled auto-export) — consider designing them together. WHAT GOES IN THE REPORT is still open (sprint/bug/time metrics? which?). DESIGN COMPLETE — full business + technical plan in docs/T-RPT-1-PLAN.md; decisions logged in docs/DECISIONS.md. Locked: storage C+B (Downloads for v1, folder-pick deferred), accumulate+rollup, mixed per-metric model, JSON+HTML, squad+me scope, header entry point, 12-month retention with advance export warning. Ready to build on approval. |
| Support | T-SLA-1 | Support-ticket SLA tracking (response / resolution / release vs the SLA matrix by priority) | L | Track support tickets against the team SLA matrix and surface breaches/at-risk in the support board view + monthly report. SLA MATRIX (verbatim from the team SLA doc): Urgent — CS response 1h, Tech response 1h, Resolution 4h, Release same day. High — CS 2h, Tech 4h, Resolution 8h, Release 2 business days. Medium — CS 1 business day, Tech 3 business days, Resolution 7 business days, Release periodic sprint release. Low — CS 1 business day, Tech 5 business days, Resolution 14 business days, Release periodic sprint release. KEY IMPLEMENTATION NOTE: SLAs mix CLOCK hours (Urgent/High response+resolution) with BUSINESS days (Medium/Low + all Release times), so elapsed-time math MUST respect business hours/days and the team work week (Sun–Thu at Zeal) — naive wall-clock elapsed will be wrong. Needs: a business-time elapsed calc, ticket created/first-response/resolved timestamps (first-response likely needs changelog or a status-transition signal — same per-issue changelog approach as the bug reopen detection), and a definition of which support statuses map to "responded"/"resolved"/"released". Design discussion before build. Overlaps the existing support board fetch + the bug-reports changelog machinery. |
| Distribution | T-WL-1 🔶 | White-label the tool for public Chrome Web Store distribution (configurable name + logo; Zeal theme stays the default) | XL | GOAL: publish a version other companies can install from the Chrome Web Store, where an engineer at company A can set a custom display name (instead of "Zealer") and a custom logo (instead of Zeal's), with the Zeal branding remaining the built-in DEFAULT. Most other config is already dynamic (Jira/Sentry URLs, squad, boards), so the branding layer is the main new surface. FORK DECIDED: option (B) — CLONE to a separate PUBLIC repo; this repo stays the private Zeal build. Public changes land in the clone; the two codebases must be kept in sync for shared fixes (consider a shared-core strategy later). POINTS TO CONSIDER: (1) TELEMETRY — the hardcoded write-only Sentry usage DSN currently phones home to Zeal's project; for a public build this must be removed, made opt-in, or pointed at the installing company (shipping a public tool that silently reports usage to Zeal is a serious trust/privacy problem). (2) SENTRY INSIGHTS feature — keep / change / discard for the public build? It assumes the user has their own Sentry; fine to keep as optional (already is), but decide. (3) SECRETS — no hardcoded tokens/PATs/DSNs may ship publicly; audit. (4) BRANDING surface — display name, logo, splash, theme colors as a config (default = Zeal); manifest name/icons are static per CWS listing so the in-app brand is what's themeable. (5) DEFAULTS — strip Zeal-specific defaults (squad HRM, support board 176, App Name field) or gate them behind first-run setup. (6) CWS publishing — needs the Google dev account ($5) from T-DIST-1 phase 2. Fork decided (clone). ACTION LIST: docs/T-WL-1-ACTIONS.md (telemetry-off + secrets audit are the blockers; configurable field IDs next; then branding config; then store listing). To be built in a dedicated chat against that list. |
| Distribution | T-EO-1 | Engineering-overview build (separate clone): cross-squad view, multiple squads side by side per chart | XL | A SECOND clone (separate repo, like T-WL-1's public clone but distinct) that re-frames the dashboard from one-squad to an ENGINEERING-WIDE overview. AIM: in each Insights chart, show the 3 squads' numbers SIDE BY SIDE (grouped/series per squad) rather than one squad at a time — applies to sprint progress, velocity/burndown, bugs, time, support. ADDITIONAL: a separate progress chart for the CLOUD team's stories/boards (different shape from the squad charts). SENTRY: the Sentry trend chart stays the same and is managed via Sentry VIEWS (already view-based), so no special cross-squad work there — just configure the relevant views. OPEN/IDEAS (Ahmed open to ideas): how to pick/define the 3 squads (config list of squad keys + boards?); whether overview is read-only aggregate vs drill-into-one-squad; per-chart "side by side" needs each metric computed PER squad then rendered as grouped series — the existing per-squad fetch/compute would run N times (one per squad) and merge, so the fetch layer needs a multi-squad loop; legend/colour per squad; how cloud team differs (no sprints? kanban boards?). RELATIONSHIP TO T-WL-1: both are clones; the public white-label (T-WL-1) and the eng-overview (T-EO-1) are DIFFERENT products — decide if eng-overview is built from the Zeal private build or from the white-label base. NEEDS A DESIGN DISCUSSION before build. |

---

## 📋 Backlog (older / lower priority)

| # | Task | Type | Size | Notes |
|---|---|---|---|---|
| T-09 | Slack webhook for high-severity alerts | feature | M | Optional, configured in settings |
| T-10 | Show error in UI when Jira/Sentry credentials fail | fix | S | Red banner with actionable message |
| T-14 | Loading skeleton on initial boot | fix | S | Shimmer while first fetch runs |
| T-17 | Add dashboard screenshot to README.md | docs | S | — |

---

## ✅ Done

| Version | What shipped |
|---|---|
| v2.20.0 | Phase-sequenced subtask Gantt: subtasks laid out impl→review per function (BE/FE/POS lanes in parallel), QA on a lane after all functions; bar width = effort estimate. Detection handles bracketed + bare team naming. Ported from DevPulse, detection corrected, no generic data. |
| v2.19.9 | Fixed time-logged chart showing only cap (pace now uses same date source as rest of chart + clamped to sprint end); richer demo Gantt — 16 subtasks across 6 parents (was 7/3). |
| v2.19.8 | Demo data realism: burndown now computed by the real computeBurndownSeries engine (ideal/estimate/actual diverge) instead of hand-rolled arrays; +5 Gantt subtasks. Ported from DevPulse without its data genericization. |
| v2.19.7 | Ported mock-role-preview buttons (Mock as EM/Engineer, session-only) + My-Tasks role gating from DevPulse; skipped icon refresh (already present); Today Meetings card now collapsed by default. |
| v2.19.6 | Ported SLA breach surfacing in Support Board Breakdown from DevPulse fork (red per-row marker + summary; demo flags; +3 tests). Other fork commits reviewed and intentionally skipped (icons already done; role-preview-dependent; white-label-only). |
| v2.19.5 | Calendar: fixed the real fetch failure — replaced the background dynamic import of the parser (unreliable in MV3) with a static import; card now surfaces the actual error detail. |
| v2.19.4 | Calendar: fixed the 1s countdown tick clobbering the real fetch error with a catch-all "not configured" message; error reason now held in state and mapped to specific text (incl. HTTP codes). |
| v2.19.3 | Calendar: fixed "not configured" with a saved URL — popup passes the iCal URL in the fetch message (no more popup/background storage mismatch); added diagnostics. |
| v2.19.2 | Calendar fixes: iCal field styled like other inputs; card shows on URL presence (removed enable toggle); broadened Google host perms for iCal redirects; specific fetch-error messages. |
| v2.19.1 | Calendar: fixed live ICS not rendering (init-before-settings), renamed to Today Meetings, made collapsible with countdown in header. Icons: Monthly Report uses the EM role chart SVG; Settings role pills reuse role-picker EM/Engineer icons. |
| v2.19.0 | T-CAL-1 phase 1: Today meetings card (Google Calendar via ICS URL) with live countdown + 30-min alert; demo data; Settings Calendar section. |
| v2.18.0 | T-UA-1 phase 2: usage-analytics enrichment. Rolling per-user profile (`foldAppOpen`/`bumpCounter`, pure+tested) attached to `app_opened` — days_active/total_opens/first_version tags + full `usage_stats` extra. Action tracking: `action_taken` events (`export_report`, `scope_toggled`, `ticket_clicked`). `section`/`role` verified healthy (no fix). 25 telemetry tests. Phase 1 (Sentry dashboard widgets + rollout disclosure) delivered alongside. |
| v2.17.0 | Usage analytics: section_viewed fires for all major views + app.session duration; docs/USAGE-ANALYTICS.md setup guide. Rollout-readiness. |
| v2.16.1 | Monthly Report: bug counts squad-level (not per-engineer); per-engineer hours retained. |
| v2.16.0 | T-RPT-1 Monthly Report: self-building monthly report (delivery/bugs/support/hours, squad+me), in-app viewer + JSON/HTML export, optional auto-download, 12-month retention with advance warning, demo-mode data. |
| v2.15.2 | Bug Reports UI rebuilt as a 2x2 grid; reopen detection now also uses resolution-cleared (workflow-independent). |
| v2.15.1 | Fix: reopen rate 0% — bulk search does not return changelog; now fetched per-issue (bounded). |
| v2.15.0 | T-BR-1 phase 2: reopen rate (changelog, 6-sprint window) + open-bugs-by-App breakdown (App Name field). T-BR-1 complete. |
| v2.14.1 | Fix: Bug Reports trend was empty (used oldest sprints + dropped active-sprint bugs). |
| v2.14.0 | T-BR-1 phase 1: Bug Reports card (incoming-vs-resolved trend + open-bug age snapshot), EM + my-bugs scope. Reopen rate + per-component deferred to phase 2. |
| v2.13.0 | Multi-team Sentry (editable base URL + *.sentry.io perms), Sentry-isolation audit, full README rewrite, security/privacy audit for publishing. |
| v2.12.1 | T-DIST-1 phase 1: in-app "update available" nudge (reads GitHub promoted releases). CWS auto-update = deferred phase 2. |
| v2.12.0 | T-CAP-1 (capacity line 6h/day) + T-EBD-1 (engineer personal burndown in My Tasks card). |
| v2.11.4 | S-6/S-7/S-8 complete: token migration, empty-state unification, popup error audit. Full S-1..S-9 done. |
| v2.11.3 | S-5 complete: fetchJiraData decomposed into named helpers (476→42 lines). |
| v2.11.2 | S-5 batch 1: extracted sprint-history/support/milestones helpers from fetchJiraData. |
| v2.11.1 | S-4 phase 2 (complete): insights renders join the scheduler (per-target timers). |
| v2.11.0 | S-4 phase 1: single render scheduler (requestRender) + pure src/render-scheduler.js. |
| v2.10.6 | S-3 COMPLETE: ticketCounts → src/ticket-stats.js; refactor closed out. |
| v2.10.5 | S-3 step 7: personal bars chart → src/render/personal-bars-svg.js (pure + tested). |
| v2.10.4 | S-3 step 6: estimate-vs-actual card → module; removed dead buildFocusSplitCard. |
| v2.10.3 | S-3 step 5: Sentry trend card → src/render/sentry-trend-svg.js (pure + tested). |
| v2.10.2 | S-3 step 4: support board chart → src/render/support-board-svg.js (pure + tested). |
| v2.10.1 | Sentry view retry-once + handled-error log-level audit (S-8 partial). |
| v2.10.0 | Sentry usage telemetry replaces Google Sheet logging (events + transactions, no SDK). |
| v2.9.4 | S-3 step 3: donut + progress bar builders → src/render/progress-svg.js (pure + tested). |
| v2.9.3 | My Tasks title moved inside card wrapper (layout consistency). |
| v2.9.2 | S-3 step 2: timesheet builder → src/render/timesheet-svg.js (pure + tested). |
| v2.9.1 | S-3 step 1: burndown builder → src/render/burndown-svg.js (pure + tested). |
| v2.9.0 | Hat 3 foundation: deleted chart-svg.js (S-1), domain-constants.js (S-2), metrics.js tests (S-9). |
| v2.8.8 | Gantt header button reorder; timesheet capacity label visibility + 7h/day. |
| v2.8.7 | Stability Hat 1&2: milestone breakdown, design tokens + empty-state foundation, Gantt full-tab+PDF, timesheet capacity line. |
| v2.8.6 | Time Logged hover tooltip; alerts recompute on load (detail/links always show); removed privacy button. |
| v2.8.5 | Alert redesign (snooze-to-tomorrow × button, compact+expandable, ticket links); Time Logged headroom + hover; Sentry-trend flicker fix; spike-rule date/day robustness. |
| v2.8.4 | Gantt per-subtask hover tooltip (summary/assignee/estimate/status). |
| v2.8.3 | Gantt parent-row + child sub-lane layout (Sprint Planner parity). |
| v1.1.x | Board auto-discovery, multi-view Sentry, sprint story list, privacy mode, refresh timer, due dates, extra boards |
| v1.2.x–v1.3.4 | Sprint analytics: burndown (3 series), timesheet, worklog fetch, sprint cache, sprint-change prompt |
| v1.8.7 | Burndown calendar-day bucketing fix (tz-safe). 63 tests. |
| v1.9.0 | Committed-baseline burndown, scope-change segments, progress bar. Engineers filter badge fix. |
| v1.9.1 | Phase 2 alerts: 9 rules (sprint_goal_at_risk enhanced, scope_creep, stalled_burndown, due_date_risk, unassigned_work, reopened_tickets, sentry_trend_spike, velocity_drop gated, support_sla_breach gated). New metrics: countWorkingDays, committedBurnPrediction, sentryDayOverDaySpike. |
| v1.9.2 | Phase 1 role foundation: welcome screen, settings.role, viewScope primitive, getCurrentUser(). |
| v1.9.3 | Phase 2 me/squad scope filter: tickets, timesheet, estimate vs actual. wireScopePills. |
| v1.9.4 | Phase 3 settings split + EM squad management. em-only CSS, applyRoleToSettings, curated member list. |
| v1.9.5–v1.9.6 | Code review: 6 bugs fixed. Critical: squadKey ReferenceError (broke all Jira fetching). |
| v1.9.7–v1.9.8 | Section reorder, sprint filter row, Me/Squad on charts + extra boards. Fixed wireScopePills(contentEl) undefined. |
| v1.9.9 | popup.html deduplication (Python scripts created 2× all screens). Merged auth+role-select screens. Hello Zealer greeting, 120px logo, square role cards, chart EM icon. |
| v2.4.1 | Splash polish: correct white logo, cap +20%, title -40%, Dashboard regular weight. |
| v2.4.1 | Splash polish: correct white logo (wing cutout), cap +20%, title −40%, Dashboard regular weight. |
| v2.4.0 | Phase 6: launch splash screen (ripple animation, once per session, bundled DM Sans, Nohemi slot). |
| v2.3.0 | Alert Settings: T-AS-1 (enable/disable), T-AS-2 (thresholds), T-AS-3 (per-rule desktop notif), migration, reset button. |
| v2.2.0 | Rebrand to "Zealer Dashboard" everywhere user-facing. Toolbar icon circular badge fix (visible light+dark). |
| v2.1.3 | Fix engineer Me filter showing squad data (never fall back to squad chart; accountId match; stale-cache/no-data states). byDate test added. |
| v2.1.2 | Fix sprint progress % (mixed points/tickets unit bug). Use totalPoints denominator. Add pts done/to-go. |
| v2.1.1 | Engineer me-mode personal time-series charts (daily bars for sprint, monthly for quarterly; grouped estimate vs actual per period). byDate added to aggregateWorklogs. |
| v2.1.0 | Phase 5: engineer progress circles (sprint donut + support donut, SVG stroke-dasharray, hidden when no assignments, always me-scoped) |
| v2.0.0 | Fixed welcome screen logo (hardcoded navy → theme-aware dual-image span). |
