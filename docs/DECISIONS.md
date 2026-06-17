# Design Decisions & Backlog Context

A running log of design discussions and the decisions/constraints they produced.
This is the layer between the one-line backlog entries in `TASKS.md` and the full
working history — it captures the *why* so anyone opening the repo (or future me)
can see the reasoning, not just the outcome.

Newest first. Each entry: the decision, the options weighed, and any hard
constraint discovered.

---

## Bug attribution — squad-level, not per-engineer (DECIDED v2.16.1)
The monthly report (and bug metrics generally) count bugs at the SQUAD level. We
deliberately do NOT attribute opened/resolved bugs to an individual.
**Why:** a bug's assignee changes as it moves through the workflow (developer →
QA engineer during testing → done), so the assignee at any moment is workflow
position, not ownership or cause. Attributing to the current assignee was
misleading and unstable (same bug → different people on different days). The
reporter field is usually QA/PM, so it can't attribute cause either. Bug volume
is a property of the squad + codebase.
**What stays per-engineer:** HOURS (from authored worklogs — genuinely
individual). In the report's "Me" scope, hours are personal but bug/support
counts are squad-wide, with a note saying so.
This reversed the earlier T-RPT-1 "F3 per-engineer bug flow" design after it
shipped in v2.16.0; removed in v2.16.1.

## T-WL-1 — White-label for public distribution (PROPOSED, strategic fork open)
**Status:** backlog; needs a design discussion. Decide the fork FIRST.
**Ask:** publish a Chrome Web Store version other companies can install and brand
(custom display name + logo instead of Zealer/Zeal), with Zeal as the default
theme. Most config is already dynamic; branding is the main new surface.

**Strategic fork — DECIDED: option (B), clone.** A separate PUBLIC repo will be
the white-label/store build; this repo stays the private Zeal build. Public
changes land in the clone. The two codebases must be kept in sync for shared
fixes — consider a shared-core strategy if drift becomes painful. (Rejected (A)
white-labeling this repo in place, to avoid public concerns — telemetry, secrets,
Zeal defaults — living in the repo used internally every day.)

**Action list:** `docs/T-WL-1-ACTIONS.md` (built from project history — what to keep/change/discard with justification; ordered for the dedicated WL chat).

**Points to consider (carry into the design discussion):**
- **Telemetry is the big one.** The hardcoded write-only Sentry usage DSN reports
  to Zeal's project. A public build must NOT silently phone home to Zeal —
  remove it, make it opt-in, or point it at the installing company. Shipping
  identified/anonymous usage to Zeal from other companies' installs is a serious
  trust/privacy problem and likely the single most important thing to get right.
- **Sentry Insights feature** — keep / change / discard for public? It already
  assumes the user supplies their own Sentry org/token (multi-team work, v2.13.0),
  so it can stay as an optional feature; just decide explicitly.
- **Secrets audit** — no hardcoded tokens/PATs/DSNs may ship in a public build.
- **Branding surface** — in-app display name, logo, splash, theme colors as a
  config with Zeal as the default. (manifest name/icons are fixed per CWS listing,
  so the themeable brand is the in-app one.)
- **Zeal-specific defaults** — squad HRM, support board 176, the App Name field
  id, Sun–Thu work week: strip or gate behind first-run setup for a public build.
- **CWS publishing** needs the Google dev account ($5) noted in T-DIST-1 phase 2.

## T-EO-1 — Engineering-overview build (PROPOSED, separate clone)
**Status:** backlog; design discussion before build. A SECOND clone, distinct
from the public white-label (T-WL-1).
**Aim:** re-frame the dashboard from single-squad to an engineering-wide overview.
In each Insights chart, show the **3 squads side by side** (grouped series per
squad) instead of one squad at a time — sprint progress, velocity/burndown, bugs,
time, support. Plus a **separate progress chart for the Cloud team** (stories /
boards — different shape, e.g. kanban not sprint-based). The **Sentry trend chart
stays as-is**, managed via Sentry views (already view-based), so no special
cross-squad work there.
**Open / ideas (Ahmed open to ideas):**
- How to define the 3 squads — a config list of squad keys + their boards?
- Aggregate-only overview vs. drill-into-one-squad.
- "Side by side" means each metric is computed PER squad then rendered as grouped
  series → the per-squad fetch/compute runs N times and merges, so the fetch
  layer needs a multi-squad loop (today it is single-squad).
- Per-squad legend/colour; consistent ordering.
- How the Cloud team differs (likely kanban boards, no sprints) → its own chart.
**Relationship to T-WL-1:** both are clones but DIFFERENT products. Decide whether
the eng-overview is built from the Zeal private build or from the white-label base.

## T-SLA-1 — Support-ticket SLA tracking (PARKED, reference data captured)
**Status:** backlog; design discussion before build. The valuable artifact right
now is the SLA matrix itself (from the team SLA doc), recorded here so it isn't
lost:

| Priority | CS Response | Tech Response | Resolution SLA | Release Time |
|---|---|---|---|---|
| Urgent | 1 hour | 1 hour | 4 hours | Same day |
| High | 2 hours | 4 hours | 8 hours | 2 business days |
| Medium | 1 business day | 3 business days | 7 business days | Periodic sprint release |
| Low | 1 business day | 5 business days | 14 business days | Periodic sprint release |

**Key implementation note (don't lose this):** the matrix mixes **clock hours**
(Urgent/High response + resolution) with **business days** (Medium/Low, and every
Release-time cell). Any SLA elapsed-time calculation must therefore respect
business hours/days and the team **work week (Sun–Thu at Zeal)** — a naive
wall-clock diff will over-count by including weekends/off-hours. Also needs:
ticket created / first-response / resolved timestamps (first-response likely
requires per-issue changelog or a status-transition signal — same machinery as the
bug reopen detection), and a mapping of support statuses → responded / resolved /
released. Overlaps the existing support-board fetch and the bug-reports changelog
work. Idea: surface breaches + at-risk in the support board view and roll SLA
attainment into the monthly report (T-RPT-1).


**Status:** full business + technical plan written → `docs/T-RPT-1-PLAN.md`.
Design locked; ready to build on approval.
**Decisions:**
- **Storage = C + B.** In-extension accumulation is the source of truth (model C,
  "never lose this data"); optional auto-download of timestamped monthly files
  (model B) toggled in Settings. Folder-picking (model A, File System Access) is
  deferred to phase 2 — its per-session re-prompt caveat makes it wrong to gate v1
  on. v1 writes to Downloads.
- **Capture = accumulate continuously, roll up at month end.** Background updates
  an in-progress month bucket each fetch; rollover detected by comparing stored
  month key to today's (robust to the worker sleeping — not a wall-clock timer);
  on rollover the prior month is finalized into history.
- **Per-metric model = mixed.** Flow metrics (hours, bugs in/out, support in/out)
  → daily points, summed; state metrics (open bug count, median age, velocity,
  completion %) → month-end snapshot (+ first-of-month); derived (reopen rate, net
  flow) → computed at finalize. Daily flow stored as cumulative-to-date so
  re-fetches are idempotent (no double count).
- **Format = both** JSON (data of record) + HTML (readable view).
- **Contents = broad** ("everything initially"): sprint/delivery, bugs, time,
  support, meta. Trimming/selection is later.
- **Scope = squad AND engineer "me"** in v1 (per-engineer flow tracked by
  accountId so a "my report" can be sliced at finalize).
- **Entry point = header button** next to Settings.
- **Retention = 12 months WITH an advance export warning.** Pruning is bounded but
  never silent: when 12 months are held and the next finalize will prune the
  oldest, the UI warns the user a full month ahead to export first. Exported files
  are the permanent record beyond 12 months.
- **Single writer:** only background mutates the report store (avoids the storage
  races the project has hit before). Pure core (`src/monthly-report.js`) +
  `report-html.js` unit-tested like the other pure modules.
**Built from existing data — no new Jira/Sentry calls.**



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
