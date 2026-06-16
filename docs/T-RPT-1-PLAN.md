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

## 2.1 Architectural principles

- **Single writer.** Only `background.js` mutates the report store; the popup
  reads. (Mirrors how Sentry trend + jira data already flow — avoids the storage
  races the project has been bitten by before.)
- **Pure core, tested.** All roll-up / finalize / metric math lives in a pure
  module (`src/monthly-report.js`) with no chrome/DOM deps, unit-tested like
  `bug-reports.js` and `burndown.js`.
- **Built from existing data.** No new Jira/Sentry calls. The accumulator reads
  the same `state` the dashboard already assembles each fetch.
- **Render reuses existing builders.** The HTML view composes the SVG/HTML
  builders already written (burndown, timesheet, bug-reports) where useful.
- **Rollover by comparison, not by timer.** Detect month change by comparing the
  stored current-month key to today's — robust to the worker sleeping.

## 2.2 Per-metric model **[DECIDED: mixed]**

| Metric | Type | Stored how |
|---|---|---|
| Hours logged (total + per engineer) | flow | daily point (cumulative-to-date value per day) |
| Bugs opened / resolved | flow | daily point |
| Support tickets opened / closed | flow | daily point |
| Open bug count, median bug age | state | month-end snapshot (+ first-seen of month) |
| Velocity, sprint completion % | state | snapshot at each sprint close within the month |
| Sprints closed this month | event list | appended as sprints close |
| Reopen rate, net bug flow, completion % | derived | computed at finalize |

## 2.3 Data model (chrome.storage.local)

```
reportStore = {
  schemaVersion: 1,
  currentMonth: "2026-06",            // local YYYY-MM
  current: <MonthBucket>,             // in-progress, mutated each fetch
  history: {                          // finalized, immutable
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
  // FLOW — keyed by local date, latest-wins per day:
  daily: {
    "2026-06-01": { hoursLogged: 12.5, perEngineer: {accId: hrs,...},
                    bugsOpened: 2, bugsResolved: 1,
                    supportOpened: 0, supportClosed: 3 },
    ...
  },
  // STATE — latest snapshot + first of month:
  stateFirst: { openBugs: 14, medianBugAgeDays: 9, capturedAt: <iso> },
  stateLatest:{ openBugs: 11, medianBugAgeDays: 7, capturedAt: <iso> },
  // EVENTS:
  sprintsClosed: [ { name, closedAt, committedPts, completedPts,
                     velocity, completionPct } ],
  appVersion: "x.y.z"
}

FinalizedMonth = MonthBucket + {
  finalizedAt: <iso>,
  derived: {
    totalHours, perEngineerHours,
    bugsOpened, bugsResolved, netBugFlow,
    supportOpened, supportClosed,
    openBugsEnd, medianBugAgeEnd,
    reopenRate,                       // computed over month's bugs
    velocityAvg, completionPctAvg,
    sprintCount
  }
}
```

Why daily flow stores the *cumulative-to-date* value (not a per-fetch increment):
multiple fetches per day overwrite the same date key with the latest cumulative
reading, so re-fetching is idempotent — no double counting. Month total for a
flow = sum over days of the per-day deltas, or simply the last day's cumulative
value when the source itself is cumulative (e.g. sprint-to-date hours). The pure
module documents which per source.

## 2.4 Components & files

**New:**
- `src/monthly-report.js` — pure. `updateBucket(bucket, snapshot, today)`,
  `shouldRollover(storedMonth, today)`, `finalizeMonth(bucket)`,
  `pruneHistory(history, retentionMonths)`, `computeDerived(bucket)`,
  `emptyBucket(month, squad)`. No chrome/DOM.
- `src/report-html.js` — pure. `buildReportHTML(finalizedMonth)` → full standalone
  HTML string (reuses palette + bar/row helpers; self-contained for export).
- `tests/monthly-report.test.js` — covers rollover boundaries, idempotent daily
  writes, partial-month, finalize math, retention pruning.
- `report.html` + `report.js` — the in-app viewer page (month list → rendered
  view + "Export JSON" / "Export HTML" buttons).

**Modified:**
- `background.js` — after each successful `fetchJiraData` (and support/sentry as
  relevant), build a `snapshot` from `state` and call the accumulator; run the
  rollover check; on rollover, finalize + prune + (if B enabled) trigger download.
- `settings.html` / `settings.js` — a "Monthly report" section: enable/disable
  auto-download (model B), retention months, and a "download this month now"
  button.
- `popup.js` — an entry point to open `report.html` (a button in the header or
  insights footer).
- `manifest.json` — already has `downloads`? if not, add it for model B. (verify)
- The six docs + version bump on ship.

## 2.5 Control flow

```
fetch cycle (background, existing):
  fetchJiraData() → state updated
        │
        ▼
  buildSnapshot(state)               // pure: pull the metrics we track
        │
        ▼
  shouldRollover(store.currentMonth, today)?
        ├─ yes → finalizeMonth(store.current)         // compute derived
        │        history[oldMonth] = finalized
        │        pruneHistory(history, retentionMonths)
        │        if (settings.report.autoDownload) downloadMonth(finalized)  // model B
        │        store.current = emptyBucket(thisMonth, squad)
        │        notify popup "month-finalized"
        ▼
  store.current = updateBucket(store.current, snapshot, today)   // model C, always
  chrome.storage.local.set({ reportStore: store })
```

Rollover is evaluated **before** applying today's snapshot, so the new month's
first data point lands in the fresh bucket, not the one being finalized.

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
- **Retention:** history longer than N → oldest pruned, newest kept.
- **HTML builder:** smoke-render a fixture, assert key sections present.
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
