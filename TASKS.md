# TASKS.md — Shared Task List

> Last updated: 2026-06-04 (v2.0.0)

---

## 🔄 In Progress

_Nothing currently in progress._

---

## 📋 Backlog (approved, sequenced)

| Phase | # | Task | Size | Notes |
|---|---|---|---|---|
| 5 | T-P5-1 | Engineer sprint progress circle (pts, multi-status donut) | M | Always "me"-scoped; hidden if no assigned sprint stories; colors: Open=slate, In Progress=blue, QA=amber, Done=green; center = pts / ticket count hint |
| 5 | T-P5-2 | Engineer support board progress circle (count, QA Accepted = done) | M | Count-based donut; QA Accepted is "done" (Closed excluded from API fetch) |
| 5 | T-P5-3 | Hide both circles when no assignments | S | Check assigneeAccountId in sprint stories AND support board tickets |
| Alert settings | T-AS-1 | Per-rule enable/disable toggle in Settings | M | `settings.alerts.rules[ruleId].enabled`; gate in `checkAlerts`; default all enabled |
| Alert settings | T-AS-2 | Per-rule threshold config (scope creep %, stalled days, spike delta) | M | Input fields per rule in Settings alerts section; read in each rule |
| Alert settings | T-AS-3 | Per-rule desktop notification override | S | `notifyDesktop: boolean` per rule; read in `notifyHighSeverity` |
| 6 | T-P6-1 | 2-second splash screen with logo + animation | — | Discuss style, timing, skip-on-reload when we reach this phase |

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
| v1.0.0 | Initial extension: side panel, Jira + Sentry integration, 4 alert rules, 3 screens |
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
| v2.0.0 | Fixed welcome screen logo (hardcoded navy → theme-aware dual-image span). |
