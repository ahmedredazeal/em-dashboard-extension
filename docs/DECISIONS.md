# Design Decisions & Backlog Context

A running log of design discussions and the decisions/constraints they produced.
This is the layer between the one-line backlog entries in `TASKS.md` and the full
working history — it captures the *why* so anyone opening the repo (or future me)
can see the reasoning, not just the outcome.

Newest first. Each entry: the decision, the options weighed, and any hard
constraint discovered.

---

## T-RPT-1 — Monthly report, stored locally, configurable destination (PROPOSED, not yet designed)
**Status:** backlog; needs a design discussion at its time.
**Ask:** generate a report on a monthly cadence, persist it locally so history
accumulates, and let the user pick the destination/path from Settings.
**Known constraint (carried from T-EXP-1):** MV3 extensions can't silently write
to an arbitrary filesystem path. `chrome.downloads` can't append or overwrite a
chosen file; the File System Access API needs a user-granted, persisted directory
handle and may re-prompt per session. So "pick a destination once and keep writing
there monthly" has to be designed around those limits — candidates: a persisted
FS Access directory handle, a cloud destination (Drive/Sheets), or timestamped
monthly files.
**Open:** report contents (which metrics), exact storage mechanism, destination
model, monthly trigger (chrome.alarms). Heavy overlap with T-EXP-1 — likely design
them together.

## T-BR-1 — Bug Reports (DECIDED + shipped, v2.14.0–v2.15.2)
- **Bug definition:** issue type `Bug` OR `QA Bug` (confirmed against the team's
  Jira usage, not assumed).
- **Phase 1:** incoming-vs-resolved trend + open-bug age snapshot. **Phase 2:**
  reopen rate + per-App breakdown.
- **Trend bucketing:** by *actual* sprint `[start, end)` windows (not calendar
  fortnights), so bars match sprint names. Must use the **most recent** closed
  sprints + the active sprint — the Agile endpoint returns oldest-first, which
  caused an empty chart until fixed (v2.14.1).
- **"Per-component" became "per-App Name":** components are unreliable/mostly empty
  in this Jira, but the `App Name` field is always filled. Field id resolved by
  display name at fetch time (no hardcoded customfield id).
- **Reopen rate window:** last 6 sprints (bounds the per-issue changelog fetch).
- **Changelog can't come from bulk search:** the `/search/jql` endpoint doesn't
  return changelog via `expand`; must fetch per-issue via `/issue/{key}/changelog`
  (v2.15.1).
- **Reopen detection is workflow-independent:** detect a `resolution` field cleared
  (set → empty), not just status-name matching, so non-standard "done" status
  names still register reopens (v2.15.2).

## T-DIST-1 — Controlled auto-update (phase 1 shipped, phase 2 deferred)
- **Hard constraint:** an MV3 extension **cannot** replace its own files or
  self-install from code. Chrome owns updates entirely. The originally-requested
  "download the release and replace our files" is impossible.
- **Phase 1 (shipped, v2.12.1):** an in-app *nudge* — checks GitHub Releases for
  the newest release with `promoted` in its tag/name that's newer than the running
  version, shows a dismissible banner. "Promoted" = the maintainer adds that token
  after trying a build.
- **Phase 2 (deferred):** Chrome Web Store unlisted listing → native auto-update.
  The proper long-term path; ends the manual-zip handoff. Needs a Google dev
  account.
- **Check cadence:** on every open, with a 30-min network floor to respect GitHub's
  60 req/hour/IP limit (shared across one office IP) (v2.12.4).

## Multi-team support (DECIDED + shipped, v2.13.0)
- The tool is not hard-wired to Zeal. Sentry base URL is editable; host
  permissions widened to `*.sentry.io` so any org works.
- **Telemetry vs user-configured Sentry are fully isolated and must never cross:**
  the tool's own usage/error telemetry always goes to the fixed write-only
  `zealer-dashboard` ingest DSN (no tokens, no issue contents); the user's
  configured Sentry views use their own org/token, read-only, stored locally. So
  another team's *usage* reaches the maintainer's project while their *own Sentry
  data* stays in their account.

## Capacity line — fixed cap + pace marker (DECIDED + shipped, v2.12.2–2.12.3)
- The Time Logged chart shows TWO 6h/working-day reference lines: a fixed
  full-sprint **cap** (total sprint working days × 6h, drives the over-capacity ⚠)
  and a moving **pace** marker (elapsed working days × 6h). The original single
  line was pace-to-date mislabeled as "cap".

## Stability audit S-1…S-9 (DONE)
See `docs/STABILITY-AUDIT.md` for the full audit. Notable: `fetchJiraData` was
decomposed 476→42 lines; a single render scheduler was introduced; pre-flight now
runs the *entire* test suite (it previously ran only 7 hard-coded files, which let
v2.12.3 ship with red tests).
