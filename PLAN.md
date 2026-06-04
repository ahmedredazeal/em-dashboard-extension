# Zealer Dashboard — Chrome Extension Plan

> **Status:** Approved decisions baked in — final review before Phase 1 starts
> **Repo:** https://github.com/ahmedredazeal/em-dashboard-extension
> **Source charter:** `Process - Engineering Management v1.0` (Moayad Fouad, approved 20/4/2026)
> **Sibling app:** Sprint Planner (Zeal Chrome Extension) — patterns reused verbatim
> **Guidelines:** `GUIDELINES.md` — followed without exception

---

## 1. Purpose

A Chrome side-panel extension that helps an Engineering Manager:

1. **Always-on watch** — continuously monitors Jira + Sentry + Leapsome against the thresholds in the EM charter and alerts when any squad metric goes out of band.
2. **Auto-compiles the monthly brief** — the 5-section report (Delivery, Reliability, People, Technical, Top Risks & Asks) is assembled from cached data, addressing the charter's directive: *"Automate reporting. If you are manually pulling metrics from Jira every week, set up dashboards instead."*
3. **Tracks the human side privately** — 1:1 cadence, people log, growth plans, promotion cycle — local-only, with a one-click privacy mode for screen sharing.

---

## 2. Name & repo

- **Name:** Zealer Dashboard
- **Repo:** `github.com/ahmedredazeal/em-dashboard-extension`
- Once the first push lands, GitHub Pages will host `docs.html` and `changelog.html` for clickable in-app links (matches Sprint Planner's pattern).

---

## 3. Scope

### In scope (v1.x)
- Read-only **Jira** integration (sprints, stories, subtasks, statuses, assignees, comments, worklogs)
- Read-only **Sentry** integration on `https://zeal.sentry.io/` (issues, events, trend)
- Read-only **Leapsome** integration (OKRs, learning paths, vacations / time off)
- Local-only people log, 1:1 tracker, growth plans, promotion cycle
- Alert rules engine driven by charter thresholds
- Toolbar badge + in-extension inbox + optional desktop notifications
- Monthly Brief auto-builder with PDF export and copy-as-markdown
- **Squad selector** — each EM picks their own squad on first run; switchable from settings
- **Screen-share privacy mode** — one-click toggle that masks personal/1:1/promotion content while keeping dashboards visible

### Out of scope (for v1)
- Writing back to Jira / Sentry / Leapsome — read-only by design
- **Multi-squad rollup view** for senior EM / CTO — explicitly deferred to a later phase (v2.0+) once single-squad UX is solid
- Slack / email push — local notifications only; opt-in webhook later
- EazyBI integration — only if Jira raw data proves insufficient
- eNPS pulse — deferred until EMs decide on the source
- Mobile companion — Chrome extension only

### Decisions baked in
| Decision | Value | Reason |
|---|---|---|
| Data sources | Jira + Sentry + Leapsome | All three are the EM's canonical tools per the charter; Leapsome owns OKRs/learning/vacations |
| Sentry instance | `https://zeal.sentry.io/` | Confirmed by user |
| Alert model | Toolbar badge + in-app inbox; desktop notifications opt-in for high-severity | Lightweight, matches charter tone |
| Background poll cadence | 30 min default, configurable (15/30/60 min or off) | Catches Sentry's 24h triage window with margin |
| Storage | `chrome.storage.local` only | Same posture as Sprint Planner |
| Auth | API tokens (Jira + Sentry + Leapsome) | No OAuth — same justification as Sprint Planner |
| People-log encryption | Chrome's at-rest encryption only | User accepted; privacy mode covers the screen-share threat |
| PM cycle dates | Computed: H1 = Jan 1 – Jun 30, H2 = Jul 1 – Dec 31 | User-confirmed; no per-cycle entry |
| Squad model | Single squad selected on first run; switchable in settings | User-confirmed; multi-squad is v2 |

---

## 4. Architecture

```
em-dashboard-extension/
├── manifest.json              ← v3 · sole source of truth for version · CSP declared
├── background.js              ← service worker · chrome.alarms · notifications · toolbar badge
├── popup.html                 ← side-panel UI · all screens · linked to styles.css
├── popup.js                   ← app controller · ES modules · imports from src/
├── styles.css                 ← shared tokens (extends Sprint Planner palette)
├── theme-loader.js            ← theme + version loader for secondary pages
├── settings.html / settings.js
├── docs.html                  ← matches Sprint Planner's docs.html structure
├── changelog.html             ← matches Sprint Planner's changelog.html structure
├── privacy.html               ← required for store submission
├── GUIDELINES.md              ← copied verbatim, untouched without approval
├── README.md                  ← installation, features, architecture
├── CHANGELOG.md               ← repo-level dev changelog (separate from in-app changelog.html)
├── DOCS.md                    ← architecture & developer notes
├── PLAN.md                    ← this file
├── src/
│   ├── jira-api.js            ← read-only Jira REST client
│   ├── sentry-api.js          ← Sentry REST client (issues, events, stats)
│   ├── leapsome-api.js        ← Leapsome REST client (OKRs, learning, time off)
│   ├── metrics.js             ← pure functions: velocity, goal-hit, SLA, utilization
│   ├── alerts.js              ← pure rules engine (threshold checks → alert objects)
│   ├── brief.js               ← compiles the monthly brief from cached state
│   ├── people.js              ← people-log / 1:1 / growth-plan / promotion CRUD
│   └── privacy-mode.js        ← masks personal content for screen sharing
├── brief-export.html          ← print-ready monthly brief (PDF via browser Save as PDF)
├── brief-export.js
└── icons/                     ← 16 / 32 / 48 / 128
```

### Pure-logic rule
`metrics.js`, `alerts.js`, `brief.js`, `privacy-mode.js` have **zero DOM dependencies** — same rule as Sprint Planner. Lets us run `node --check` and a tiny test harness on them.

### Background service worker
Owns the alarm + the toolbar badge + the notification dispatch. The popup never polls; it only reads what background has cached.

---

## 5. Screen flow

Two-row sticky header (per `GUIDELINES.md` §4):

```
App bar:      [icon] Zealer Dashboard v1.0.0                    🔒  ⚙   ?
Context bar:  ←  [SQUAD]  Squad Name  ·  Sprint 47  Day 4/10   ↻   ⎙
                                                            └─ privacy mode toggle (new)
```

| # | Screen | Purpose | Affected by privacy mode |
|---|---|---|---|
| 0 | **Auth** | First run: Jira + Sentry + Leapsome creds, squad selection. "Built at Zeal" lockup. | — |
| 1 | **Today** (home) | Alert inbox · today's blockers from Jira · 1:1s due this week · fresh Sentry spikes · sprint sparkline. | 1:1 names + reasons masked |
| 2 | **Sprint Health** | 5-sprint velocity, goal-hit %, carry-over, scope changes, stale tickets. | No |
| 3 | **Reliability** | Sentry 7-day trend, untriaged spikes with age, support SLA, security tickets, incident trend. | No |
| 4 | **People** | Roster grid · per-engineer card: utilization gauge (6±1h, vacation-aware), days since last 1:1, growth-plan badge, learning-path progress. | Names visible, sensitive sub-text masked |
| 5 | **People Log** *(private)* | Per-engineer journal: wins / concerns / feedback / goals. | Fully masked |
| 6 | **OKRs** | KR list from Leapsome with status pills · "at-risk for N weeks" counters. | No |
| 7 | **Promotions** | PM cycle phase (kick-off / mid-cycle / close, computed from H1/H2 dates), candidates, expectations, evidence. | Fully masked |
| 8 | **Monthly Brief** | All 5 sections auto-compiled. ⎙ export PDF, 📋 copy markdown. | Personal sub-sections masked when in privacy mode |

### Screen-share privacy mode (the 🔒 toggle)

- One click in the app bar toggles ON/OFF; persists across sessions.
- ON state: app bar shows an unmistakable amber strip *"🔒 Privacy mode — personal content hidden"* so it's impossible to forget you're in it (lifted from Sprint Planner's replay-mode banner pattern, v2.6.0).
- Affects: people-log entries, 1:1 notes, promotion evidence/expectations, individual eNPS scores. Replaces with `•••` blocks and the message *"Hidden in privacy mode."*
- Does **not** affect: aggregate metrics, names, utilization gauges, sprint dashboards, Sentry, OKR status, monthly brief metric snapshots — the parts you'd actually want to share.
- Implemented in `src/privacy-mode.js` as a CSS-class toggle on `<body>` (`.privacy-on`) plus an explicit data-attribute on each maskable element. Pure CSS does the masking; no JS re-renders.

---

## 6. Alert rules catalog

Each rule is a pure function in `alerts.js`: `(state) => Alert | null`. All thresholds quoted directly from the charter.

| ID | Severity | Trigger | Charter source |
|---|---|---|---|
| `velocity_drop` | medium | Velocity drops >15% for 2 consecutive sprints | Delivery Metrics → Sprint Velocity |
| `sprint_goal_at_risk` | high | Mid-sprint burndown trajectory predicts goal miss | Daily/Weekly → "Sprint health check (mid-sprint)" |
| `stale_ticket` | low | Assigned in-progress Jira ticket, no update 2+ days | Daily rhythm |
| `sentry_spike_untriaged` | high | New Sentry issue, age >24h, no triage | Reliability → "New spikes triaged within 24 hours" |
| `support_sla_breach` | high | Support ticket aged past agreed SLA | Reliability → ≥90% SLA |
| `security_ticket_overdue` | high | Security ticket past stated ETA | Reliability ownership section |
| `one_on_one_overdue` | medium | No 1:1 logged in cadence (vacation-aware via Leapsome) | People → "weekly or bi-monthly 1:1" |
| `developmental_one_on_one_overdue` | low | No developmental-tagged 1:1 in past 30 days | People → "At least one 1:1 per month should be purely developmental" |
| `utilization_out_of_band` | medium | Engineer logging <5h or >7h/day for 3+ days **excluding vacation days from Leapsome** | People Metrics → "6±1 hours per working day" |
| `okr_at_risk_2_weeks` | medium | Leapsome OKR marked delayed/off-track 2 consecutive weeks | OKRs → "If an OKR is at-risk for two consecutive weeks" |
| `growth_plan_missing` | medium | Engineer with no active development plan | People Metrics → 100% with active dev plan |
| `learning_path_stalled` | low | Leapsome learning path has had no progress in 30+ days | New — covers the learning-paths data Leapsome provides |
| `retro_action_stale` | low | Retro action item un-actioned >2 sprints | Sprints → "track action items and follow up" |
| `promotion_midcycle_due` | low | Candidate's mid-cycle check-in reached (Month 3 of H1/H2) | Promotion Guidelines → Mid-cycle check-in |

Vacation-aware logic is shared: `metrics.js` exposes `effectiveWorkingDays(engineerId, range)` that subtracts Leapsome time-off entries before any utilization or 1:1-cadence math runs. This single helper prevents an entire class of false positives.

Alert object: `{id, ruleId, severity, message, evidenceLink, createdAt, acknowledged}`. Background fires them; popup renders the inbox.

---

## 7. Data model (chrome.storage.local)

```jsonc
{
  "settings": {
    "jira":     { "baseUrl":"...", "email":"...", "token":"..." },
    "sentry":   { "baseUrl":"https://zeal.sentry.io", "org":"zeal", "project":"...", "token":"..." },
    "leapsome": { "baseUrl":"...", "token":"..." },
    "squad":    { "key":"ATH", "name":"Athena", "boardId":42 },
    "team":     { "workingWeek":"sun-thu", "ceremonyDay":"monday" },
    "alerts":   { "cadenceMin":30, "desktopNotifications":false, "severityFloor":"medium" },
    "ui":       { "theme":"browser", "privacyMode":false }
  },
  "roster":         [{ "id":"...", "displayName":"...", "jiraAccountId":"...", "leapsomeId":"...", "level":"L4" }],
  "peopleLog":      { "<engineerId>": [{ "date":"...", "type":"win|concern|feedback|goal", "text":"..." }] },
  "oneOnOnes":      { "<engineerId>": [{ "date":"...", "type":"tactical|developmental", "notes":"..." }] },
  "growthPlans":    { "<engineerId>": { "expectations":[...], "active":true, "lastUpdated":"..." } },
  "vacations":      { "<engineerId>": [{ "from":"...", "to":"...", "type":"vacation|sick|other" }] },
  "learningPaths":  { "<engineerId>": [{ "id":"...", "name":"...", "progress":0.65, "lastActivity":"..." }] },
  "okrs":           [{ "id":"...", "title":"...", "krs":[...], "status":"on-track|delayed|off-track", "history":[...] }],
  "promotionCycle": { "id":"H2-2026", "phase":"mid-cycle", "startsAt":"2026-07-01", "endsAt":"2026-12-31", "candidates":[...] },
  "sprintHistory":  [{ "sprintId":"...", "name":"...", "velocity":42, "goalAchieved":true, "carryOver":3 }],
  "alerts":         [{ /* see §6 */ }],
  "cache":          { "lastFetch":{ "jira":"...", "sentry":"...", "leapsome":"..." } }
}
```

### Privacy posture
- Local only, encrypted at rest by Chrome, never transmitted anywhere except directly to your Jira / Sentry / Leapsome instances.
- Privacy policy will explicitly enumerate the people-log + 1:1 notes + promotion evidence as the most sensitive categories.
- Screen-share privacy mode is the day-to-day defense; deletion path is "remove the extension."

---

## 8. Build phases

### Phase 1 — Foundation (v1.0.0)
- Manifest, CSP, side-panel + service worker scaffolding
- Settings page (Jira + Sentry creds, theme, squad selection)
- Two-row header, theme system, Zeal footer — copied from Sprint Planner
- `src/jira-api.js` and `src/sentry-api.js` read-only clients
- **Today**, **Sprint Health**, **Reliability** screens
- 4 highest-value alert rules: `sprint_goal_at_risk`, `sentry_spike_untriaged`, `support_sla_breach`, `velocity_drop`
- Toolbar badge + alert inbox
- **Screen-share privacy mode** scaffold (toggle works, nothing yet to mask)
- docs.html, changelog.html, privacy.html, README.md, CHANGELOG.md, DOCS.md

### Phase 2 — People + Leapsome (v1.1.0)
- `src/leapsome-api.js` client
- Settings: Leapsome credentials
- Roster (auto-pulled from Jira sprint assignees + Leapsome IDs, editable)
- People screen with vacation-aware utilization gauges
- People Log (private, masked in privacy mode)
- 1:1 tracker
- Growth Plans
- Learning paths progress display
- Adds rules: `one_on_one_overdue`, `developmental_one_on_one_overdue`, `utilization_out_of_band`, `growth_plan_missing`, `learning_path_stalled`

### Phase 3 — Monthly Brief auto-builder (v1.2.0)
- OKRs screen pulling live from Leapsome
- Brief screen with all 5 sections auto-compiled
- PDF export (mirrors `gantt-print.html` pattern)
- Copy-as-markdown for paste-into-Leapsome
- Adds rule: `okr_at_risk_2_weeks`

### Phase 4 — Promotions (v1.3.0)
- PM cycle tracker with auto-computed H1/H2 dates
- Candidate management with expectations doc (masked in privacy mode)
- Mid-cycle check-in flow
- Promotion case builder pulling from people log + sprint contributions
- Adds rule: `promotion_midcycle_due`

### Phase 5 — Polish & depth (v1.4.0+)
- Remaining alert rules (`stale_ticket`, `security_ticket_overdue`, `retro_action_stale`)
- EazyBI integration if needed
- Optional Slack webhook (opt-in)

### Phase 6 — Senior-EM rollup (v2.0.0)
- Multi-squad selection
- Cross-squad rollup dashboards (CTO / senior EM view)
- Calibration helpers for promotion cycles across squads

---

## 9. GUIDELINES.md compliance checklist

Pre-flight before every release — same checklist Sprint Planner uses:

- [ ] **§1 Version** — only `manifest.json`, read dynamically
- [ ] **§2 Build checklist** — `node --check`, changelog, docs version line, manifest bump, element audit
- [ ] **§3 CSP** — zero inline scripts/handlers
- [ ] **§4 Header** — two-row sticky, identical app bar
- [ ] **§5 Design language** — typography/spacing/radii from Sprint Planner
- [ ] **§6 Dark mode** — all CSS custom props; tested in light/dark/browser
- [ ] **§7 Zeal branding** — full 9-path SVG footer; "Built at Zeal" on auth
- [ ] **§8 Changelog** — every release, newest first, specific descriptions
- [ ] **§9 Documentation** — `docs.html` updated on every user-facing change
- [ ] **§10 Store compliance** — privacy.html on GitHub Pages
- [ ] **§11 File structure** — pure logic in `src/`
- [ ] **§12 Element audit** — zero missing references before zip

---

## 10. Lessons applied from Sprint Planner

| Lesson | How Zealer Dashboard handles it from day one |
|---|---|
| Stale `getElementById` refs caused multiple hotfix releases | Element audit script in `package.json` from v1.0.0 |
| Inline scripts/handlers tripped CSP repeatedly | Pre-commit grep for `onclick=`, inline `<script>`, `javascript:` URLs |
| Theme tokens hardcoded in JS | All JS-emitted HTML uses `var(--token)` from line one |
| Test suite imported from a stale copy | Tests use relative imports (`./src/...`); CI verifies no duplicate copies |
| Sprint Planner replay-mode banner (v2.6.0) | Pattern reused for privacy-mode banner |

---

## 11. What happens next

On your green light:

1. I create the repo skeleton in `/mnt/user-data/outputs/em-dashboard-extension/`:
   - `manifest.json`, `popup.html`, `popup.js`, `styles.css`, `theme-loader.js`
   - `settings.html` / `settings.js` (Jira creds + theme + squad picker)
   - `background.js` (alarm + badge scaffolding)
   - `docs.html`, `changelog.html` with v1.0.0 entry, `privacy.html`
   - `README.md`, `CHANGELOG.md` (repo dev log), `DOCS.md`, `GUIDELINES.md` (copy), `PLAN.md` (this)
   - `src/jira-api.js`, `src/sentry-api.js`, `src/metrics.js`, `src/alerts.js`, `src/privacy-mode.js`
   - `icons/` placeholders
2. You pull the folder, push it to `github.com/ahmedredazeal/em-dashboard-extension`, enable GitHub Pages.
3. We test Phase 1 end-to-end (load unpacked in Chrome, settings round-trip, dashboards populate, alerts fire).
4. Each subsequent phase: feature branch → changelog entry → docs update → manifest bump → element audit → zip.

No code until you've confirmed this updated plan.
