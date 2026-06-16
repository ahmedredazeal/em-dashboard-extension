# T-RPT-1 — Monthly Report: Business & Technical Plan

**Status:** design complete, pending approval to build
**Owner:** Ahmed (EM, HRM squad)
**Last updated:** 2026-06-16

This document has two halves: a **business plan** (why, who, what value, scope,
risks) and a **technical architecture plan** (data model, components, control
flow, file-by-file work). Decisions already locked during ideation are marked
**[DECIDED]**; everything else is a proposal open to revision before build.

---

# PART 1 — BUSINESS PLAN

## 1.1 Problem statement

The dashboard is a *real-time* cockpit: it shows the current sprint, current open
bugs, current time logged. The moment a sprint closes or a month turns, that
picture is gone — there is no durable record of "how did the squad do in May?"
An EM who wants to see trends across months, prepare a monthly stakeholder
update, or look back at a quarter has nothing to draw on. Everything the tool
knows is ephemeral and current-state only.

## 1.2 Goal

Produce a **monthly report** that is generated from the data the dashboard
already collects, **accumulated continuously and finalized at month end**, and
**persisted locally so history is never lost**. The EM can read it in-app and,
optionally, have a copy written out to disk each month.

## 1.3 Target users & primary use cases

- **Primary:** the EM (squad lead) preparing a monthly update or reviewing trends.
- **Secondary:** an engineer wanting their own monthly footprint (time logged,
  bugs handled) — scoped to "me," same as the rest of the tool.

Use cases:
1. "What did my squad deliver in May?" — points completed, velocity, bug flow,
   hours, support load, in one view.
2. "Show me the last 6 months of velocity / bug net-flow." — month-over-month
   trend, only possible once history accumulates.
3. "I need a file to paste into the monthly stakeholder deck." — export the
   month's HTML/JSON.

## 1.4 Value proposition

- **Continuity:** turns an ephemeral dashboard into a system of record.
- **Zero extra effort:** the report builds itself from data already fetched;
  the EM does nothing during the month.
- **Trend visibility:** month-over-month comparison the live view can't give.
- **Stakeholder-ready:** a clean HTML artifact each month.

## 1.5 Scope

### In scope (v1)
- Continuous in-month accumulation of squad metrics. **[DECIDED]**
- Automatic roll-up + finalize at month boundary. **[DECIDED: accumulate
  continuously, roll up at month end]**
- Durable in-extension history (the source of truth). **[DECIDED: model C]**
- Optional auto-download of a timestamped monthly file, toggleable in Settings.
  **[DECIDED: model B, configurable]**
- Both JSON (data of record) and HTML (readable view). **[DECIDED: both]**
- An in-app report viewer (list of months → open one).
- Report contents = a broad monthly snapshot ("everything initially").
  **[DECIDED: start broad]**

### Out of scope (v1) — candidates for later
- Writing to a user-chosen folder via the File System Access API (model A). This
  is the one piece of the original "pick a destination" ask that collides with MV3
  sandboxing; deferred as a phase 2 enhancement on top of the reliable C+B core.
- Cloud destinations (Drive/Sheets).
- Cross-squad / multi-squad aggregation.
- PDF generation (HTML is print-to-PDF-able by the user for now).
- Configurable report contents (v1 reports everything; trimming/selection later).

## 1.6 The destination question (honest framing)

The original ask was "pick the destination from Settings." MV3 cannot silently
write to an arbitrary path. The three models and the decision:

| Model | What it is | Reliability | Chosen? |
|---|---|---|---|
| **C** | Accumulate inside the extension (chrome.storage); view + export in-app | Highest — no FS permissions | **Yes — core / source of truth** |
| **B** | Auto-download timestamped monthly files to Downloads | High — `chrome.downloads`, no path choice | **Yes — optional, Settings toggle** |
| **A** | File System Access API + persisted directory handle → write to a chosen folder | Medium — may re-prompt per session, side-panel quirks | **Deferred to phase 2** |

Rationale: C guarantees "never lose this data"; B gives an off-extension copy
with near-zero complexity; A is the only one that satisfies "choose the folder"
literally, but its permission/persistence caveats make it the wrong thing to
gate v1 on. Build C+B now; layer A on later without rework (the report bytes are
the same; only the sink changes).

## 1.7 Success criteria

- After a month turns, the prior month appears in the in-app history with correct
  totals, and (if B enabled) a file lands in Downloads.
- History survives browser restart and extension update.
- No measurable impact on dashboard load time; storage stays well within quota.
- Zero new network calls (the report is built from already-fetched data).

## 1.8 Risks & mitigations

| Risk | Mitigation |
|---|---|
| Month rollover missed (extension not open at midnight on the 1st) | Rollover is checked on every fetch, not via a wall-clock event — the first fetch after the month turns finalizes the prior month. No reliance on the extension being open at a specific instant. |
| `chrome.storage` quota growth | Daily points only for flow metrics; state metrics snapshot-only; cap retained history (12 months, with advance export warning — see 2.10) and prune oldest. Estimate < 50 KB/month → years fit in the local quota. |
| Partial-month data (feature shipped mid-month) | Mark a month `partial: true` if accumulation started after the 1st; the report notes it. |
| Double-counting across fetches within a day | Flow metrics are stored as a per-day *latest-wins snapshot of the cumulative source value*, not incremented per fetch (see 2.3). |
| Time zone / "what is today's month" ambiguity | Use the user's local date consistently; store the month key as `YYYY-MM` from local time. |
| Storage write races (popup + background) | Single writer: only the background service worker mutates the report store. |

---

# PART 2 — TECHNICAL ARCHITECTURE PLAN

> **REVISED 2026-06-16** to incorporate the Part 3 review. Changes: rollover
> semantics corrected to match the real fetch trigger (F1); per-metric reducer
> registry replaces the contradictory "cumulative daily" rule (F2); per-engineer
> bug flow added to the model (F3); single-writer hardened with an in-flight lock
> and persist-before-download (F6); migration seam (F5), permission-light export
> (F4), palette-injected HTML (F8) folded in. Superseded text is kept only where
> noted; the sections below are authoritative.

## 2.1 Architectural principles

- **Single writer, serialized.** Only `background.js` mutates the report store;
  the popup reads. Accumulate + finalize run under an in-flight promise lock so two
  overlapping fetch cycles cannot interleave a read-modify-write (F6). The store is
  written with a single `chrome.storage.local.set` at the end of the cycle.
- **Pure core, tested.** All roll-up / finalize / metric / reducer math lives in a
  pure module (`src/monthly-report.js`) with no chrome/DOM deps, unit-tested like
  `bug-reports.js` and `burndown.js`. `buildSnapshot(state)` is the one impure
  boundary (it reads the dashboard's `state` shape) and gets its own fixture test.
- **Built from existing data.** No new Jira/Sentry calls in the common path. The
  accumulator reads the same `state` the dashboard already assembles each fetch.
  (Exception: month hours may be derived from a date-bounded worklog read at
  finalize — see 2.2/F2 — which is a once-a-month call, not per-fetch.)
- **Render reuses builders via injected palette.** The HTML view composes shared
  builders, but because an exported file has no access to the live `var(--...)`
  tokens, builders take an explicit palette argument; the exported HTML inlines
  resolved colours + SVG so it stands alone (F8).
- **Lazy rollover by comparison.** Month change is detected by comparing the stored
  month key to today's, evaluated on each fetch cycle. **Honest semantics (F1):**
  the only fetch trigger is the popup opening (no periodic alarm exists — alarms
  were deliberately removed). So finalize is *lazy*: it fires on the first panel
  open after the month turns, and in-month accumulation only covers days the panel
  was opened. v1 documents this ("data for N of M days"); a daily alarm heartbeat
  is a deferred option (2.8) if true calendar coverage is later wanted.

## 2.2 Metric reducer registry **[REVISED — F2]**

The original "store cumulative-to-date daily, sum the deltas OR take last value"
rule was self-contradictory and wrong for hours (sprint-to-date hours cross the
month boundary, so neither summing daily values nor taking the last works). It is
replaced by an explicit **reducer registry**: each tracked metric declares its
type and how it rolls up to a month total. Adding a metric later is a one-line
registry entry + (if new) a reducer — the single highest-leverage maintainability
move.

```
// src/monthly-report.js
export const METRICS = [
  // key                source field on snapshot    reducer
  { key:'bugsOpened',    src:'bugsOpenedToday',      reducer:'sumDailyDelta' },
  { key:'bugsResolved',  src:'bugsResolvedToday',    reducer:'sumDailyDelta' },
  { key:'supportOpened', src:'supportOpenedToday',   reducer:'sumDailyDelta' },
  { key:'supportClosed', src:'supportClosedToday',   reducer:'sumDailyDelta' },
  { key:'openBugs',      src:'openBugCount',         reducer:'latestSnapshot' },
  { key:'medianBugAge',  src:'medianBugAgeDays',     reducer:'latestSnapshot' },
  // hours: NOT accumulated daily — derived at finalize from a date-bounded
  // worklog read for [monthStart, monthEnd], so the sprint-boundary problem
  // disappears. Marked reducer:'finalizeQuery'.
  { key:'hoursLogged',   src:null,                   reducer:'finalizeQuery' },
];
```

**Reducer definitions (pure):**
- `sumDailyDelta` — the metric is a true per-day count (e.g. "bugs created on
  date D", which Jira can answer). Stored per day; month total = sum of the daily
  values. Re-fetching the same day overwrites that day's entry (idempotent).
- `latestSnapshot` — a point-in-time state value. Stored as `stateLatest` (and
  `stateFirst` on first capture of the month). No daily history. Month value =
  `stateLatest`; optional `delta = latest − first`.
- `finalizeQuery` — not accumulated at all; computed once at finalize from a
  bounded query (hours = worklogs in `[monthStart, monthEnd]`). Avoids the
  cumulative-across-boundary trap entirely. This is the *only* metric needing a
  (monthly, not per-fetch) network read; if that read fails, the month records
  `hoursLogged: null` and the report notes it rather than guessing.

| Metric | Type | Reducer |
|---|---|---|
| Bugs opened / resolved | flow | `sumDailyDelta` |
| Support opened / closed | flow | `sumDailyDelta` |
| Open bug count, median bug age | state | `latestSnapshot` |
| Velocity, completion % | state (per sprint close) | event list, `latestSnapshot` per closed sprint |
| Sprints closed | event | appended as sprints close |
| Hours logged (total + per engineer) | flow | `finalizeQuery` (date-bounded worklog read) |
| Reopen rate, net flow, completion-avg | derived | computed at finalize from the above |

## 2.3 Data model (chrome.storage.local) **[REVISED — F3, F5]**

```
reportStore = {
  schemaVersion: 1,                   // migrated via src/migrations.js (F5)
  currentMonth: "2026-06",            // local YYYY-MM
  current: <MonthBucket>,             // in-progress, mutated each fetch cycle
  history: {                          // finalized, immutable, max 12 (retention)
    "2026-05": <FinalizedMonth>,
    "2026-04": <FinalizedMonth>,
    ...
  },
  retentionMonths: 12
}

MonthBucket = {
  month: "2026-06",
  partial: false,                     // true if accumulation started mid-month
  startedAt: <iso>,
  squad: "HRM",
  observedDays: 7,                    // # of distinct days the panel was opened
                                      //   (F1 — report shows "data for N of M days")
  // FLOW — keyed by local date, each value is that day's PER-DAY DELTA
  // (sumDailyDelta reducer). Latest-wins per day → idempotent re-fetch.
  // SQUAD-LEVEL counts only — bugs are NOT attributed per engineer (see note below).
  daily: {
    "2026-06-01": {
      bugsOpened: 2, bugsResolved: 1,
      supportOpened: 0, supportClosed: 3
    },
    ...
  },
  // STATE — latestSnapshot reducer (+ first capture of month for deltas):
  stateFirst:  { openBugs: 14, medianBugAgeDays: 9, capturedAt: <iso> },
  stateLatest: { openBugs: 11, medianBugAgeDays: 7, capturedAt: <iso> },
  // EVENTS — appended as sprints close in-month:
  sprintsClosed: [ { name, closedAt, committedPts, completedPts,
                     velocity, completionPct } ],
  appVersion: "x.y.z"
  // NOTE: hours are NOT stored here — finalizeQuery computes them at finalize
  // (date-bounded worklog read), total + perEngineer, written into derived.
}

FinalizedMonth = MonthBucket + {
  finalizedAt: <iso>,
  hoursAvailable: true,               // false if the finalize worklog read failed
  derived: {                          // the FROZEN contract both renderers consume
    totalHours, perEngineerHours,     // from finalizeQuery (null if unavailable)
    bugsOpened, bugsResolved, netBugFlow,   // SQUAD-LEVEL (not per engineer)
    byEngineer: { "<accId>": { hours } },   // HOURS ONLY — bugs are not attributed
    supportOpened, supportClosed,
    openBugsEnd, medianBugAgeEnd, openBugsStart,   // from stateLatest/stateFirst
    reopenRate,                       // computed over the month's bugs (changelog)
    velocityAvg, completionPctAvg, sprintCount
  }
}
```

**Storage semantics (corrected — supersedes the old "cumulative-to-date" note):**
flow metrics are stored as **per-day deltas** (the `sumDailyDelta` reducer), so a
month total is a plain sum and a re-fetch on the same day overwrites that day's
entry rather than adding to it (idempotent). Hours are deliberately *not* in
`daily` — they are derived at finalize from a date-bounded worklog read, which is
why the cumulative-across-the-sprint-boundary problem (F2) does not arise.
`derived` is the **frozen contract**: a typedef comment + a shared test fixture
used by both the finalize test and the HTML/JSON renderers, so producer and
consumers cannot drift (maintainability).

**Migration (F5):** `migrateReportStore(store)` is added to `src/migrations.js`
from day one (a no-op for schemaVersion 1) so the seam exists before there is
12 months of data a careless v1→v2 could destroy.

## 2.4 Components & files **[REVISED — F4, F5, F6, F8]**

**New:**
- `src/monthly-report.js` — pure. `emptyBucket(month, squad)`,
  `buildSnapshot(state)` (impure boundary, fixture-tested), `updateBucket(bucket,
  snapshot, today)`, `shouldRollover(storedMonth, today)`, `finalizeMonth(bucket,
  hoursResult)`, `computeDerived(bucket, hoursResult)`, `pruneHistory(history,
  retentionMonths)`, `retentionWarning(history, currentMonth, retentionMonths)`,
  and the **`METRICS` reducer registry** + reducer fns (F2). No chrome/DOM.
- `src/report-html.js` — pure, **palette-injected** (F8): `buildReportHTML(
  finalizedMonth, palette)` returns a standalone HTML string with **inlined,
  resolved CSS colours and inlined SVG** (no `var(--...)`, no external stylesheet),
  so an exported file opens correctly outside the extension. Shared bar/row helpers
  are forked here in palette-arg form rather than importing the live-theme builders.
- `tests/monthly-report.test.js` — rollover (incl. year boundary + skipped-month
  gap), per-reducer correctness (sumDailyDelta idempotency, latestSnapshot,
  finalizeQuery-unavailable), per-engineer slicing (F3), finalize math vs fixture,
  retention prune + `retentionWarning`, `buildSnapshot` against a `state` fixture.
- `report.html` + `report.js` — thin viewer (month list → rendered view). **Export
  is permission-free** via a `blob:`/`<a download>` click (F4); the viewer holds no
  report logic, only selection + calling the pure builders.

**Modified:**
- `background.js` — in the existing fetch cycle, under an **in-flight lock** (F6):
  `buildSnapshot(state)` → rollover check → (on rollover) `finalizeMonth` →
  **persist history first**, *then* (if B enabled) auto-download (F6) → reset
  current → notify popup; always `updateBucket` then a single `set`. The monthly
  `finalizeQuery` hours read happens here at finalize only.
- `src/migrations.js` — add `migrateReportStore` seam (F5), no-op for v1.
- `settings.html` / `settings.js` — "Monthly report" section: auto-download toggle
  (model B), retention (default 12), "download this month now" (uses the
  permission-free export path).
- `popup.js` — "Monthly report" button in the **header, next to Settings** (decided
  2.9) → opens `report.html`.
- `manifest.json` — add `downloads` **only** for the auto-download-on-finalize path
  (F4). Manual/in-app export needs no permission. NOTE in release notes: adding a
  permission can re-prompt/disable on update for installed users.
- The six docs + version bump on ship.

## 2.5 Control flow **[REVISED — F1, F6]**

```
fetch cycle (background) — runs when the popup opens (no periodic alarm; F1):
  acquire in-flight lock (skip if a cycle is already running)          // F6
  fetchJiraData() → state updated
        │
        ▼
  snapshot = buildSnapshot(state)         // pure: today's deltas + state values
        │
        ▼
  shouldRollover(store.currentMonth, today)?
        ├─ yes → hoursResult = <date-bounded worklog read for the closing month>
        │        finalized = finalizeMonth(store.current, hoursResult)  // derived
        │        history[oldMonth] = finalized
        │        pruneHistory(history, retentionMonths)
        │        store.currentMonth = thisMonth
        │        store.current = emptyBucket(thisMonth, squad)
        │        chrome.storage.local.set({ reportStore })   // PERSIST FIRST (F6)
        │        if (settings.report.autoDownload) downloadMonth(finalized) // then
        │        notify popup "month-finalized"
        ▼
  store.current = updateBucket(store.current, snapshot, today)   // model C, always
  chrome.storage.local.set({ reportStore })     // single write, end of cycle
  release in-flight lock
```

Two ordering guarantees: rollover is evaluated **before** applying today's
snapshot (the new month's first data lands in the fresh bucket), and finalized
history is **persisted before** the fallible download is kicked off (a failed or
slow download can never cost finalized data — F6). If the panel is not opened for
days into a new month, finalize simply fires lazily on the next open; in-month
`daily` only has entries for opened days, and `observedDays`/`partial` record that
honestly (F1).

## 2.6 Model B (auto-download) details

- Uses `chrome.downloads.download` with a `data:` or `blob:` URL.
- Filenames: `zealer-report-2026-05.json` and `zealer-report-2026-05.html`.
- Fires only on finalize, only if the Settings toggle is on.
- Also exposed as a manual "download this month now" button (works on the
  in-progress month too, marked partial).
- No path choice (Downloads folder) — that's the model-A phase-2 enhancement.

## 2.7 Testing strategy

Pure modules are the safety net (the project's established pattern):
- **Rollover:** same month → no finalize; month change → exactly one finalize;
  year boundary (Dec→Jan); the new month's first snapshot is not lost.
- **Idempotent daily writes:** two snapshots same day → one day entry, latest wins,
  no double count.
- **Partial month:** bucket started mid-month → `partial:true`, derived notes it.
- **Finalize math:** totals/derived match hand-computed fixtures.
- **Retention:** history longer than N → oldest pruned, newest kept;
  `retentionWarning` fires one month ahead.
- **Reducer registry (F2):** each reducer correct in isolation — `sumDailyDelta`
  idempotent on same-day re-write, `latestSnapshot` keeps first+latest,
  `finalizeQuery` records `null`/`hoursAvailable:false` when the read fails.
- **Per-engineer slicing (F3):** a fixture with two assignees → the "me" slice
  pulls only that accountId's bug flow + hours.
- **buildSnapshot boundary:** a representative `state` fixture → expected snapshot,
  so dashboard `state` shape changes are caught by a failing test, not silently.
- **HTML builder:** smoke-render a fixture, assert key sections present; assert no
  `var(--` leaks into the exported string (palette fully resolved — F8).
- Full suite + `pre-flight.sh` green before tag.

## 2.8 Rollout / phasing

- **Phase 1 (this build):** C + B, both formats, in-app viewer, Settings toggle,
  the pure core + tests. Ships as a **minor** version bump (new feature).
- **Phase 2 (later):** model A (File System Access folder handle) as an optional
  "advanced destination" in Settings, layered on without touching the core.
- **Possible phase 3:** configurable contents, cross-squad aggregation, charts in
  the HTML view, scheduled export convergence with T-EXP-1.

## 2.9 Decisions locked (were open questions)

1. **Report entry point** — **[DECIDED]** a "Monthly report" button in the
   dashboard header, next to Settings.
2. **Engineer scope** — **[DECIDED]** v1 includes BOTH a squad report and an
   engineer "my monthly report" (time logged + my bugs), mirroring the tool's
   existing squad/me scoping. The accumulator therefore tracks per-engineer flow
   (already planned via `perEngineer` hours) and must also accumulate per-engineer
   bug flow keyed by assignee accountId so a "me" report can be sliced at finalize.
3. **Retention** — **[DECIDED]** 12 months, with an **advance export warning**:
   when the store holds 12 months and the next finalize will prune the oldest,
   surface a warning telling the user to export the oldest month(s) before they
   are removed. Pruning never happens silently. See 2.10.
4. **Support-board source** — **[DECIDED]** include the extra/support boards'
   opened/closed in the monthly support numbers (the dashboard already tracks
   them), summed across boards.

## 2.10 Retention + export-warning behavior (12 months)

The whole feature exists so data is never lost, so pruning must be loud:

- `history` retains at most 12 finalized months. A 13th finalize would prune the
  oldest.
- **One month before** that happens — i.e. when `history` reaches 12 months and
  the *current* in-progress month will become the 13th at next finalize — the
  report viewer + dashboard show a warning: "Month YYYY-MM will be removed when
  the current month closes. Export it now to keep it." with an Export button.
- The warning state is computed purely (`retentionWarning(history, currentMonth,
  retentionMonths)` → `{ willPrune, monthsAtRisk }`) so it is testable and the UI
  just reflects it.
- Pruning still executes at finalize (storage is bounded), but only after the
  user has had a full month of warning. Exported files (model B / manual) are the
  permanent record beyond 12 months.
- Edge case: if the user never exports and ignores the warning, data IS pruned at
  the boundary (storage can't grow unbounded) — but never without the prior
  month-long, explicit warning. This trade is called out in the in-app help.

## 2.11 Open questions — none

All design decisions are locked. Ready to build on approval.

---

# PART 3 — ARCHITECTURE & MAINTAINABILITY REVIEW

A critical self-review of Part 2, done after inspecting the current codebase.
Findings are ordered by severity. Each has a recommendation; the ones marked
**[MUST FIX]** change the design before build.

## 3.1 Findings that change the design

### F1 — Rollover depends on the panel being opened **[MUST FIX]**
The plan says "rollover is checked on every fetch, robust to the worker sleeping."
Inspection shows the only trigger for `fetchJiraData` is `checkDashboard()`, called
from the `refresh-dashboard` message **the popup sends when it opens**. There is no
periodic alarm (the code calls `chrome.alarms.clearAll()` — scheduled fetches were
removed). Consequence: if the user does not open the side panel for the first
several days of a new month, the prior month is not finalized until they do. Worse
edge: if they never open it during a month at all, that month's *accumulation*
never happens either — there are no fetches to accumulate from.

This does not break correctness (finalize still fires on the next open, and
accumulation only reflects days the panel was opened — which is arguably honest),
but the plan oversells it. Two honest options:
- **(a) Accept + document:** the report reflects "days you used the dashboard,"
  finalize is lazy on next open. Simplest; no new permissions. Add a per-day
  `observed` flag so the report can say "data for N of 30 days."
- **(b) Add a daily `chrome.alarms` heartbeat** that wakes the worker, runs a
  fetch, and accumulates even when the panel is closed. More faithful monthly
  data, but: reintroduces the alarm that was deliberately removed, costs a daily
  background fetch, and needs the worker to re-auth/rebuild settings outside the
  popup flow.
**Recommendation:** ship (a) in v1 (document the semantics honestly), offer (b) as
a later option. Either way, **the plan's "robust to worker sleeping" claim must be
corrected** — it is robust to *finalize* being late, not to *missing data*.

### F2 — "Latest-wins cumulative daily" is wrong for some flows **[MUST FIX]**
2.3 says each daily flow stores "cumulative-to-date" so re-fetches are idempotent,
then says "month total = sum over days of per-day deltas, or last day's cumulative
value." These are two *different* storage semantics and the plan conflates them:
- **Hours logged** from the timesheet is **sprint-to-date cumulative**, and a sprint
  spans the month boundary — so "last day's cumulative value" is not the month's
  hours, and "sum of daily values" double-counts massively. Neither stated rule is
  correct for it.
- **Bugs opened/resolved** are naturally *count-in-period*; the dashboard can be
  asked "created in [day]" — those are true per-day deltas, summable.
The single "cumulative-to-date" rule cannot cover both. **Fix:** define per-metric
*reducers* explicitly — each tracked metric declares whether it is `sumOfDailyDeltas`
or `latestSnapshot` or `maxToDate`, and `finalizeMonth` applies the declared reducer.
For hours specifically, store the per-day *incremental* hours (today's cumulative −
yesterday's cumulative within the same sprint), or better, derive month hours from a
date-bounded worklog query at finalize rather than accumulating at all.

### F3 — Per-engineer bug flow is required but not modeled **[MUST FIX]**
2.9 decision 2 commits to an engineer "my monthly report" (time + my bugs), but the
data model (2.3) only stores per-engineer *hours* (`perEngineer`), not per-engineer
*bug flow*. As written, a "my bugs opened/resolved this month" cannot be produced
from the stored bucket. **Fix:** either (a) store `bugsOpened`/`bugsResolved` keyed
by assignee accountId in the daily record, or (b) accept that "my report" covers
time + a month-end *open my-bugs* snapshot only (no my-bug flow). Pick before build;
(a) is the honest fulfillment of the decision, at more storage.

## 3.2 Findings that harden the design (not blockers)

### F4 — `downloads` permission is absent
Confirmed: `manifest.json` has no `downloads` permission. Model B needs it. Adding a
permission to an *installed* extension can trigger a re-prompt / re-enable on update
for users — call this out in the release notes. Alternatively, model B can use an
`<a download>` blob click from the report page (no permission), which is the lighter
path for a user-initiated export; the *automatic* finalize-time download is what
truly needs the permission. **Recommendation:** make manual export permission-free
(blob anchor in report.js); only the auto-download-on-finalize path uses
`chrome.downloads`, so users who never enable B never trigger the permission.

### F5 — No schema migration path, despite `schemaVersion: 1`
The project has a real `src/migrations.js` discipline. The plan stamps
`schemaVersion: 1` but never says how a future schema change migrates an existing
`reportStore`. Given this store accumulates for 12 months, a v1→v2 change must not
nuke history. **Fix:** add a `migrateReportStore(store)` to the existing migrations
flow from day one (even if it is a no-op for v1), so the seam exists before there is
data to lose.

### F6 — Single-writer holds only if finalize is atomic
2.1's single-writer principle is correct, but finalize is a read-modify-write of a
large object across an `await` (the model-B download). If a second fetch lands mid
-finalize, the later `set` can clobber. **Fix:** guard `checkDashboard`/accumulate
with a simple in-flight promise lock (the codebase already serializes some work this
way), and do the `chrome.storage.local.set` once at the end of the cycle, never
interleaved with the download. Also: persist the finalized history *before* kicking
off the (fallible, slow) download, so a failed download never costs finalized data.

### F7 — Storage growth not bounded within a month
Retention caps *months* (12), but a single month's `daily` map with `perEngineer`
sub-maps is unbounded by team size × days. For a big squad this is still small, but
the plan should state a ceiling and the failure mode if `chrome.storage.local` quota
(5 MB default) is approached. **Fix:** `getBytesInUse` check at finalize; if near
quota, the export-warning escalates. Document the realistic ceiling (≈ tens of KB/
month even for 20 engineers → years fit).

### F8 — `report.html` reuse vs duplication tension
2.4 wants `report-html.js` to be "self-contained for export" yet "reuse palette +
bar/row helpers." Those pull in opposite directions: an exported HTML file opened
outside the extension has no access to `styles.css` tokens or the render modules.
**Fix:** the exported HTML must inline its own CSS (resolved values, not
`var(--...)`) and inline any SVG — so `report-html.js` cannot import the live render
builders that emit `var(--...)`. Either fork minimal self-contained builders, or have
the builders take an explicit palette argument (so the same code serves both the live
theme and the exported static palette). Decide this seam explicitly; it is the most
likely place for future drift/bugs.

## 3.3 Maintainability assessment

**Strengths (keep):**
- Pure-core-with-tests matches the established project pattern (`bug-reports.js`,
  `burndown.js`) — high-value, low-regression.
- Building from existing `state` (no new network) keeps the blast radius small.
- Decisions are logged in `DECISIONS.md` — the "why" is captured.

**Maintainability risks to address in the build:**
- **Snapshot coupling.** `buildSnapshot(state)` reads the shape of the dashboard's
  `state` object. If `state` changes, the report silently drifts. **Mitigation:**
  give `buildSnapshot` its own small test with a representative `state` fixture, and
  treat it as the one impure boundary — everything downstream is pure and tested.
- **Metric reducer registry.** Per F2, model metrics as a declared list
  `{ key, type, reducer }` in one place, so adding a metric later is a one-line
  registry entry + a reducer, not edits scattered across accumulate/finalize/render.
  This is the single highest-leverage maintainability move.
- **Report schema as the contract.** `FinalizedMonth.derived` is what the HTML/JSON
  consume. Freeze it as the documented contract (a typedef comment + a fixture used
  by both the finalize test and the html test), so the producer and the two
  renderers can't drift apart.
- **Keep `report.js` (viewer) thin.** All logic in the pure modules; the viewer only
  selects a month and calls builders. Mirrors the popup/render split already in place.

## 3.4 Revised file plan (net of the review)

- `src/monthly-report.js` — pure: `emptyBucket`, `buildSnapshot`(impure-boundary,
  but kept here + fixture-tested), `updateBucket`, `shouldRollover`,
  `finalizeMonth`, `computeDerived`, `pruneHistory`, `retentionWarning`, and a
  **`METRICS` reducer registry** (F2). 
- `src/report-html.js` — pure, **palette-injected** (F8), no `var(--...)`, inlines
  CSS/SVG for standalone export.
- `src/migrations.js` — add `migrateReportStore` seam (F5).
- `tests/monthly-report.test.js` — rollover (incl. year boundary + skipped-month
  gap, F1), per-reducer correctness (F2), per-engineer slicing (F3), finalize math,
  retention + warning, quota ceiling sanity.
- `report.html` / `report.js` — thin viewer; manual export via blob anchor
  (permission-free, F4).
- `background.js` — in-flight lock around accumulate/finalize (F6); persist history
  before download (F6).
- `manifest.json` — `downloads` only for auto-download-on-finalize (F4); note the
  update re-prompt.

## 3.5 Verdict
The core architecture (single-writer, pure core, rollover-by-comparison, build-from
-existing-data) is sound and matches the codebase's grain. Three items
(**F1 rollover-trigger reality, F2 flow reducer semantics, F3 per-engineer bug
flow**) were real design defects that must be resolved before coding, not during.
The rest are hardening. Recommend updating Part 2 to reflect F1–F3, then build.

> **UPDATE 2026-06-16:** Part 2 has been revised to incorporate all of this. F1
> (honest lazy-rollover semantics + `observedDays`), F2 (the `METRICS` reducer
> registry + hours via `finalizeQuery`), and F3 (per-engineer bug flow in the
> model + derived) are folded in; F4 (permission-light export), F5 (migration
> seam), F6 (in-flight lock + persist-before-download), F8 (palette-injected,
> self-contained HTML) are reflected in 2.4/2.5. Sections 2.1–2.7 are now the
> authoritative, internally-consistent design. **The plan is ready to build.**

> **UPDATE 2026-06-16 (v2.16.1) — F3 REVERSED.** After shipping, the per-engineer
> bug flow (F3) was removed. A bug's assignee changes through the workflow
> (developer → QA engineer during testing → done), so attributing bug counts to
> the current assignee measured workflow position, not ownership, and was unstable
> across fetches. The reporter is usually QA/PM, so it can't attribute either.
> **Bug counts (opened/resolved/net) are now squad-level only.** Per-engineer
> HOURS remain (worklogs are genuinely authored by individuals). `byEngineer` in
> the model is hours-only; the daily record has no per-engineer bug fields. The
> data-model snippets above have been corrected to match.
