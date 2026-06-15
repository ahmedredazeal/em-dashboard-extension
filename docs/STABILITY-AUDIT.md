# Zealer Dashboard — Stability Audit

**Version audited:** v2.8.6 (commit `3aac2b3`)
**Date:** 2026-06-13
**Scope:** whole product — UX & layout, data representation, architecture & code health.
**Status:** findings only. No code changes in this pass. Remediation is sequenced at the end for plan-approve-ship execution.

---

## 0. Snapshot (the numbers)

| Area | Measure |
|---|---|
| Total JS (app + src) | ~7,490 (top-level) + 4,051 (src) = **~11,500 lines** |
| Largest file | **popup.js — 3,457 lines** |
| Largest functions | `renderInsights` ~560 lines, `fetchJiraData` 476 lines, `renderTodayScreen` ~380 lines |
| `src/` modules | 18 files, 12 with tests, **6 untested** |
| Test suites | 12, all green; ~2,265 lines of tests |
| Inline `style=` in popup.js | **238** occurrences |
| `state.` references in popup.js | 164 (single mutable module-global) |
| Empty/loose `catch` blocks | 22 in background.js, 15 in popup.js |
| Render entry points in popup.js | 23 call sites across 5 render fns |

The product **works** and ships fast. The risk is not correctness today — it's that the cost of each new change is rising, and a class of silent bugs (we've shipped four) keeps recurring. This audit names the structural causes.

---

# HAT 1 — UX / Layout

Reviewed in render order: app bar → alerts → sprint-at-a-glance → Insights (progress bar, burndown, Sentry trend, milestone summary, progress circles, timesheet, estimate-vs-actual, Gantt) → extra boards → milestone cards.

### 1.1 Information architecture is a single long scroll
Everything lives on one Today screen as stacked collapsibles. There are **three other screens** (`renderSprintHealthScreen`, `renderReliabilityScreen`, role-select) but the Today screen carries ~9 distinct sections. **Finding:** the scroll is long and the eye has no anchor for "where do I look first." Severity ranking (alerts) is at top, which is right, but burndown (the daily-decision chart) sits below the fold under sprint-at-a-glance.
**Recommendation:** consider a fixed priority order driven by "what does an EM check first each morning?" — Alerts → Burndown → Timesheet → everything else. Validate with the actual user (you) rather than assume.

### 1.2 Milestones appear twice
A milestone summary row renders inside Insights (v2.7.3) **and** full milestone cards render below extra boards (v2.7.0). **Finding:** this is intentional (summary → click → scroll to detail), but two representations of the same data on one screen is a redundancy worth a deliberate "yes, keep both" decision rather than an accident of incremental shipping.
**Recommendation:** confirm the summary→detail jump is discoverable; if users don't realize the summary is clickable, the duplication is pure noise.

### 1.3 Visual hierarchy is flat
238 inline `style=` attributes means spacing, color, weight, and size are decided per-element, ad hoc. **Finding:** there's no consistent type scale or spacing rhythm, so "what's important" is encoded inconsistently — some section headers are 10px uppercase muted, some 11px, some 12px. The eye can't learn the system because there isn't one.
**Recommendation:** a small set of design tokens (heading / subhead / body / caption; 4 spacing steps; the existing CSS vars for color) applied via classes, not inline. This is also the single biggest maintainability lever (see Hat 3).

### 1.4 Empty / loading / error states are uneven
Some sections have thoughtful empty states ("No active sprint" soft indigo banner; "add due date in Jira" Gantt hint). Others (milestone summary, estimate-vs-actual) just vanish when empty, which can read as "broken" rather than "nothing to show."
**Recommendation:** a consistent empty-state pattern (icon + one line + optional action) applied everywhere.

### 1.5 Density vs. clarity
The Gantt, timesheet, and burndown are dense SVG in a ~360px-wide side panel. The new full-tab Gantt (T-GT-1) will relieve the Gantt; the timesheet and burndown remain cramped. **Finding:** the side-panel width is a hard constraint we keep fighting with clamps and ellipsis.
**Recommendation:** treat ~360px as the design budget explicitly — anything that needs more gets a "expand to tab" affordance (the T-GT-1 pattern, generalized).

---

# HAT 2 — Data representation / analyst

For each chart: does it answer a real question, and is the encoding honest?

### 2.1 Burndown — strong, now that scope is correct
After the v2.7.x fixes it reconstructs committed baseline + scope changes from changelogs and matches Jira. **Finding:** this is the most analytically sound chart. One gap: it shows *what happened* but not *projection* prominently — the `sprint_goal_at_risk` alert computes a projection (`committedBurnPrediction`) that the chart itself doesn't draw.
**Recommendation:** consider drawing the projected finish line on the burndown, so the "at risk" alert and the chart tell the same story visually.

### 2.2 Timesheet (Time Logged) — honest, now hoverable
Cross-project hours by person, stacked. The v2.8.6 hover fixed discoverability. **Finding:** it answers "who logged time where" well. It does **not** answer "is this person over/under capacity" — there's no expected-hours baseline. The quarter view has a daily-estimate concept; the sprint view doesn't surface it.
**Recommendation:** if capacity is a question EMs ask, add an expected-hours reference; if not, leave it (don't add chart junk).

### 2.3 Estimate vs Actual — question is unclear
**Finding:** this card compares estimate to logged time, but for a team that points in story points and logs in hours, the two axes aren't directly comparable without a points→hours assumption. Risk of an apples-to-oranges read.
**Recommendation:** clarify in the ideation what decision this drives. If it's "are our estimates accurate," it needs estimate-at-close vs actual, not estimate vs time-logged.

### 2.4 Sentry trend — clear
Daily issue counts per tracked view, day-over-day spike alert. Honest encoding. The v2.8.5 robustness fix (date|day) means the spike rule now actually fires. **No change needed.**

### 2.5 Progress circles / progress bar — good, "me"-scoped
Multi-status donuts, clearly labelled "MY TASKS" (v2.8.1). Honest. **No change needed.**

### 2.6 Milestones — count-based, appropriate
Ticket-count progress (not points, since backlog tickets are unpointed) is the right call for OKR/Dev-Plan tracking. **No change needed** beyond the Hat 1 duplication question.

### 2.7 The gap: bug-reports charts (T-BR-1, queued)
This is the one analytic area with **no** representation yet. The ideation (still pending) should answer: what identifies a bug in Jira; incoming-vs-resolved rate; open-bug age; reopen rate; per-component; EM-trend vs engineer-"my-bugs." **This is the natural first new-build after stability.**

### 2.8 Cross-cutting: no "so what?" layer
Most charts show data; few state a takeaway. The alerts engine *is* the takeaway layer, but it's separate from the charts. **Finding:** an EM scanning the panel has to interpret each chart. **Recommendation:** small caption lines ("on track" / "2 days behind pace") under key charts, derived from the same metrics the alerts use — reuse, don't recompute.

---

# HAT 3 — Architecture & code health

### 3.1 🔴 popup.js is a 3,457-line monolith — the central risk
It holds boot, data-loading, message handling, **all** rendering, **all** SVG chart builders, hover wiring, formatters, and utility helpers. `renderInsights` alone is ~560 lines.
**Why it matters:** every bug we've shipped recently lived here (chevron-wipe v2.8.2, TDZ v2.7.1, cache-staleness v2.8.6). It's untestable (DOM-bound), so these bugs can only be caught by manual clicking. Change cost rises with every line.
**Recommendation (sequenced below):** extract pure logic out, split rendering by section into modules, leave popup.js as a thin orchestrator.

### 3.2 🔴 The render layer is almost entirely untested
12 suites cover `src/` pure modules. **Zero** tests cover popup.js or background.js — i.e. rendering, message handling, the snapshot/restore machinery, data-loading. **Finding:** the bugs we keep shipping are exactly in the untested layer. Tests for pure modules are necessary but not sufficient.
**Recommendation:** (a) extract render-helpers into pure, testable functions (return HTML strings, take data) — `buildBurndownSVG`, `buildTimesheetSVG`, the alert HTML builder, `snapshotOpenSections`/`restoreOpenSections` are all pure-able; (b) add a lightweight DOM test harness (jsdom) for the wiring.

### 3.3 🔴 Dead/duplicate module: chart-svg.js
`src/chart-svg.js` exports `renderBurndownChart` + `renderTimesheetChart`. popup.js re-implements both as `buildBurndownSVG` + `buildTimesheetSVG`, with a comment: *"popup.js cannot import src/ at runtime in MV3."* **This claim is false** — popup.js imports from `src/` 8 times (metrics, gantt, mock-data, alerts, …) and `settings.js` imports 5. The module is dead code and the duplication is unnecessary.
**Recommendation:** delete `chart-svg.js` (or make it the single source and import it), and delete the misleading comment. Low-risk, high-clarity win.

### 3.4 🟠 fetchJiraData is a 476-line function
Sprint fetch, subtasks, scope reconstruction, worklogs (two-pass), milestones, extra boards, caching — all in one function in background.js. **Finding:** this is where the TDZ/ordering bugs originate (v2.7.1) because so much sequential state lives in one scope.
**Recommendation:** extract `buildScopeFromChangelogs`, `fetchSprintWorklogs`, `fetchMilestones` into named functions (pure where possible). Each becomes independently testable.

### 3.5 🟠 Duplicated domain maps
Priority order/colors exist in **3 places**: `gantt.js` (`PORD`, `priorityBg/Fg`), `parsers.js` (`knownPriorities`), `popup.js` (`PRIORITY_DOT`, `TICKET_STATUS_COLORS`). Status→color likewise. **Finding:** when "Urgent" was added we had to touch multiple maps (and the HANDOFF notes exactly this pain).
**Recommendation:** one `src/domain-constants.js` (priority order, priority colors, status categories, status colors) imported everywhere.

### 3.6 🟠 Single mutable global `state` with 164 ad-hoc mutations
No single place owns a state transition; any function can mutate any field. **Finding:** the cache-staleness bug (v2.8.6) and the scope-default bugs (v2.6.10) were both "who set this field, and when" problems.
**Recommendation:** not a full state library — just funnel mutations through a few setters (`setSprint`, `setAlerts`, `setScope`) so transitions are greppable and the fingerprint/render-trigger logic has one place to hook.

### 3.7 🟠 23 render entry points, fan-out triggers flicker
Five render functions are called from 23 sites; the background fires `partial-update` per source. The v2.8.0/v2.8.5 anti-flicker work (debounce + fingerprint + snapshot/restore + trend fingerprint) is **compensating machinery bolted on after the fact**. **Finding:** the flicker class of bug recurs because rendering isn't centralized — there's no single "render is requested → coalesce → paint once" pipeline.
**Recommendation:** one render scheduler that all triggers go through (the debounce already exists; make it the *only* path). Then the fingerprint/snapshot logic lives in one place, not scattered.

### 3.8 🟠 22 silent catches in background, 15 in popup
Many are intentional ("non-fatal"), but the v2.8.5 Sentry bug proved a swallowed error can hide a real failure for weeks. **Finding:** `catch {}` with no log is indistinguishable from "this can't happen."
**Recommendation:** every catch logs at least `console.warn` with context (most already do; audit the silent ones). Consider a tiny `safe(fn, label)` wrapper.

### 3.9 🟢 What's healthy (keep doing)
- `src/` pure modules are well-factored and well-tested (parsers, burndown, changelog-parser, gantt, alerts, worklog-aggregator).
- `pre-flight.sh` gating (syntax, CSP, element-id audit, version consistency, tests) is genuinely good discipline.
- The six-doc update rule keeps docs from rotting.
- Mock/demo mode is a real asset for testing render paths without APIs.
- Changelog-based scope reconstruction is sophisticated and correct.

---

# Prioritized remediation backlog

Sequenced for plan-approve-ship. Each is independently shippable; none blocks the bug-reports charts.

| # | Item | Hat | Size | Risk | Reward |
|---|---|---|---|---|---|
| S-1 | Delete dead `chart-svg.js` + the false "cannot import" comment | 3 | S | none | clarity |
| S-2 | One `src/domain-constants.js` (priority/status order + colors); replace the 3 duplicated maps | 3 | S | low | stops the "add a priority, touch 3 files" pain |
| S-3 | ✅ DONE (v2.9.1–v2.10.6) Extract pure render-helpers from popup.js into `src/render/*` + unit tests | 3 | M | low | DONE: burndown, timesheet, donut+progress, support-board, sentry-trend, estimate-actual, personal-bars → src/render/; ticketCounts → src/ticket-stats. popup.js 3,457→2,843 (−18%). DOM-coupled helpers (renderTicketRow/emptyState/collapsedBoardSummary) intentionally left in popup. |
| S-4 | 🔶 PHASE 1 DONE (v2.11.0) Single render scheduler — screen renders funnel through requestRender(reason, {immediate}); coalesced by default, immediate for direct user actions. Pure timing logic in src/render-scheduler.js (tested). PHASE 2 PENDING: fold the ~8 renderInsights() triggers in too. Centralize rendering: one scheduler all 23 triggers go through; move fingerprint/snapshot into it | 3 | M | med | kills the flicker class structurally |
| S-5 | Split `fetchJiraData` into named (pure-where-possible) steps + tests | 3 | M | med | kills the TDZ/ordering class |
| S-6 | Design tokens: type scale + spacing + section-header class; migrate inline styles section by section | 1 | L | low | consistent hierarchy + huge maintainability win |
| S-7 | Consistent empty/loading/error state component | 1 | S | low | "looks broken" → "nothing to show" |
| S-8 | Audit silent catches; add context logs / `safe()` wrapper | 3 | S | low | no more multi-week hidden failures |
| S-9 | Add untested-module tests: **metrics.js first** (powers all alerts + burndown projection), then jira-api, sprint-cache | 3 | M | low | covers the critical untested core |
| S-10 | Chart "so what?" caption layer (reuse alert metrics) | 2 | M | low | turns data into decisions |
| S-11 | Burndown projection line (reuse `committedBurnPrediction`) | 2 | S | low | chart + alert tell one story |

**Suggested first three:** S-1 (trivial cleanup, immediate clarity), S-2 (small, removes a recurring pain), S-9/metrics.js (covers the most critical untested code). These are all low-risk and build momentum before the larger S-3/S-4/S-6 refactors.

**Note on sequencing vs. backlog:** none of this blocks T-BR-1 (bug charts) or T-GT-1 (Gantt tab/PDF). A reasonable interleave: do S-1, S-2, S-9 first (quick foundation), then build T-BR-1 *on the new domain-constants + tested-metrics base*, then return for S-3/S-4 (the big refactors) once we've felt where the seams should be.
