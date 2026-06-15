# TASKS.md — Shared Task List

> Last updated: 2026-06-04 (v2.0.0)

---

## 🔄 In Progress

_Nothing currently in progress._

---

## 📋 Backlog (approved, sequenced)

| Phase | # | Task | Size | Notes |
|---|---|---|---|---|
| ~~5~~ | ~~T-P5-1~~ | Engineer sprint progress circle (pts, multi-status donut) | M | Always "me"-scoped; hidden if no assigned sprint stories; colors: Open=slate, In Progress=blue, QA=amber, Done=green; center = pts / ticket count hint |
| ~~5~~ | ~~T-P5-2~~ | Engineer support board progress circle (count, QA Accepted = done) | M | Count-based donut; QA Accepted is "done" (Closed excluded from API fetch) |
| ~~5~~ | ~~T-P5-3~~ | Hide both circles when no assignments | S | Check assigneeAccountId in sprint stories AND support board tickets |
| ~~Alert settings~~ | ~~T-AS-1~~ | Per-rule enable/disable toggle in Settings | M | `settings.alerts.rules[ruleId].enabled`; gate in `checkAlerts`; default all enabled |
| ~~Alert settings~~ | ~~T-AS-2~~ | Per-rule threshold config (scope creep %, stalled days, spike delta) | M | Input fields per rule in Settings alerts section; read in each rule |
| ~~Alert settings~~ | ~~T-AS-3~~ | Per-rule desktop notification override | S | `notifyDesktop: boolean` per rule; read in `notifyHighSeverity` |
| ~~6~~ | ~~T-P6-1~~ | ~~Splash screen with logo + animation~~ | — | Discuss style, timing, skip-on-reload when we reach this phase |
| Charts | T-BR-1 | Bug reports charts (ideation pending) | L | Define what identifies a bug in Jira; incoming-vs-resolved, open-bug age, reopen rate, per-component; EM trend + engineer "my bugs". Planned alongside Gantt full-tab. |
| Gantt | T-GT-1 | Open Gantt in full-tab view + export to PDF | M | Like Sprint Planner's expanded view (gantt-print.html pattern); button in the Gantt header → new tab with wide layout; "Save as PDF" via print stylesheet. Pair with T-BR-1. |
| Distribution | T-DIST-1 | Auto-update from latest GitHub release (controlled, not every sub-version) | L | Self-update so users don't get a zip each time. KEY CONSTRAINT: only *promoted* versions reach users, not every patch. Chrome Web Store does this natively (the proper path) — or a self-hosted `update_url` manifest + a "stable channel" pointer file the extension polls. Security: must be signed/controlled so we can't be impersonated. Needs design discussion — several approaches with very different tradeoffs. |
| UX | T-DND-1 | Drag-and-drop reorder of Insights cards | M | Let users sort the Insights sections to taste; persist order in storage. Build AFTER the S-3 render extraction + a render scheduler (S-4), since reorder needs sections to be independent, individually-rendered units — doing it before the refactor would fight the current monolithic renderInsights. |
| Charts | T-EBD-1 | Engineer personal burndown by due dates | M | A "my burndown" for an individual engineer driven by their tickets' due dates (not sprint commitment). Reuses src/render/burndown-svg.js (already extracted) + the existing due-date data. Scope: per-engineer remaining-work line vs an ideal line derived from due dates. |
| Export | T-EXP-1 | Scheduled auto-export of tracked Sentry views to a configurable destination (append/merge, not overwrite) | L | Settings: pick a destination + cadence (e.g. daily); a chrome.alarms job exports tracked-view data automatically and MERGES into the existing file (append new rows/dates, don't replace). KEY CONSTRAINT: MV3 extensions CANNOT silently write to an arbitrary filesystem path — chrome.downloads can't append (it creates new files), and the File System Access API needs a user-granted directory handle + may re-prompt per session. Real options to design through: (a) File System Access API with a persisted directory handle (best for true append, but permission/persistence caveats); (b) chrome.downloads writing timestamped files + a separate merge step; (c) export to a cloud destination (Google Sheet/Drive API, or append to a Sentry-adjacent store) instead of a local path. Needs a design discussion — the "merge into one file on a schedule, locally" ask collides with browser sandboxing, so we pick the closest workable model. |
| Timesheet | T-CAP-1 | Time-logged capacity cap line at 6h/day (not 7h) | XS | The dashed amber capacity line in the Time Logged chart should use 6h/day. NOTE: the rate moved 8h→7h in v2.8.8; this lowers it again to 6h. One-constant change in buildTimesheetSVG's capacity calc + the label; re-verify the over-capacity ⚠ threshold and edge-clamp still read correctly. Quick — can ride along with another version. |
| Gantt | T-SPL-1 | Sprint Planner launch button in the Gantt header (open if installed → else store/GitHub page) | M | Add an icon button in the Gantt view header that opens the Sprint Planner extension if installed, else falls back to its Chrome Web Store listing (if published) or its GitHub page. Doubles as promotion for the Planner. Icon: take from the sprint-planner-extension repo. TECH NOTES: cross-extension "is it installed?" detection in MV3 needs either chrome.management permission (heavy — lists all the user's extensions, privacy-sensitive) OR a chrome.runtime.sendMessage handshake to the Planner's known extension id with externally_connectable configured on the Planner side. Cleanest: try a sendMessage ping to the Planner id; on no response, open the fallback URL. Needs the Planner's stable extension id + a tiny listener added there. Design discussion before build. |

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
