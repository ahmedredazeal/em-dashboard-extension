# TASKS.md — Shared Task List

> **Single source of truth for all work on this project.**
> Check this before starting anything. Claim a task before writing a single line of code.
> Last updated: 2026-05-16

---

## How to use this

| Symbol | Meaning |
|---|---|
| 📋 Backlog | Available — anyone can pick this up |
| 🔄 In progress | Claimed — do not start until it moves to Done |
| ✅ Done | Shipped — version + commit listed |

**Claiming a task:**
1. Move it from Backlog → In Progress
2. Add your name and date: `[Claude – 2026-05-16]`
3. Commit this file change FIRST, before any code
4. Branch: `feature/your-name-task-slug`

---

## 🔄 In Progress

_Nothing currently in progress._

---

## 📋 Backlog

### v1.2.0 — Board Manager UI
| # | Task | Type | Size | Notes |
|---|---|---|---|---|
| T-01 | Board Manager UI in settings — add/edit/delete boards with custom names | feature | L | Replace single squad form. Drag-to-reorder later. |
| T-02 | Render each board as its own dashboard section | feature | M | Loop through boards[], collapsible, sorted by order |
| T-03 | Persist board section collapse state per user | feature | S | Save to chrome.storage.local preferences |
| T-04 | Auto-fetch Sentry project IDs from saved view config | feature | M | So user doesn't have to copy project IDs from URL |

### v1.3.0 — Monthly Brief
| # | Task | Type | Size | Notes |
|---|---|---|---|---|
| T-05 | Monthly brief auto-builder | feature | XL | Summarise sprint velocity, Sentry trend, SLA for the month |
| T-06 | Export monthly brief as PDF | feature | L | Use pdf skill |

### v1.4.0 — Alert improvements
| # | Task | Type | Size | Notes |
|---|---|---|---|---|
| T-07 | Alert rule: stale ticket (open > N days with no activity) | feature | S | Configurable threshold |
| T-08 | Alert rule: carry-over rate > threshold | feature | S | Tickets that move sprint to sprint |
| T-09 | Slack webhook for high-severity alerts | feature | M | Optional, configured in settings |

### Bugs & polish
| # | Task | Type | Size | Notes |
|---|---|---|---|---|
| T-10 | Show error in UI when Jira/Sentry credentials fail (not just console) | fix | S | Red banner with actionable message |
| T-11 | Sprint story points showing 0 on some Jira instances | fix | M | Board config returns wrong field — need fallback UX |
| T-12 | Extra boards: each board should use its own project key for stories JQL | fix | M | Currently falls back to main squad key |
| T-13 | Settings: validate Sentry views on save (show error if view ID invalid) | fix | S | |
| T-14 | Loading skeleton state on initial boot (not just on refresh) | fix | S | Show shimmer while first fetch runs |

### Docs & process
| # | Task | Type | Size | Notes |
|---|---|---|---|---|
| T-15 | Enable branch protection on main in GitHub settings | chore | XS | Ahmed to do manually: Settings → Branches → Add rule |
| T-16 | Delete scripts/create-issues.sh — not needed | chore | XS | Retro issues not required |
| T-17 | Add screenshot of the working dashboard to README.md | docs | S | |

---

## ✅ Done

| # | Task | Version | Commit | Shipped by |
|---|---|---|---|---|
| — | Side panel not opening (sidePanel.open error) | v1.0.0 | 115582c | Claude |
| — | Settings auto-reload after save | v1.1.0 | 4aa8da4 | Claude |
| — | Dashboard showing no data (storage pipeline broken) | v1.1.0 | 26537f4 | Claude |
| — | Jira sprint API 404 (wrong API family — agile vs REST) | v1.1.2 | 07299de | Claude |
| — | Auto-discover Jira board from project key | v1.1.2 | 07299de | Claude |
| — | Sentry multi-view sections with per-view counts | v1.1.3 | 5fcb946 | Claude |
| — | Sprint story list with assignee + points | v1.1.3 | e39c7b0 | Claude |
| — | Story points auto-detected from board config API | v1.1.3 | e39c7b0 | Claude |
| — | All Sentry views showing same count (project filter bug) | v1.1.3 | e39c7b0 | Claude |
| — | Sprint at risk on Day 1 (false positive) | v1.1.3 | 47a2742 | Claude |
| — | Alert section hidden when empty | v1.1.3 | 7d196c8 | Claude |
| — | Sprint section collapsible, collapsed by default | v1.1.3 | 7d196c8 | Claude |
| — | Collaboration files + GitHub Pages (index.html) | v1.1.4 | 04ec5c8 | Claude |
| — | On-demand fetching — removed background alarm | v1.1.6 | 9d22367 | Claude |
| — | Refresh timer (elapsed / countdown / auto-refresh) | v1.1.7 | 3fa34c4 | Claude |
| — | Due dates on sprint stories (colour coded) | v1.1.8 | 2787f4a | Claude |
| — | Extension icon corrupted (regenerated RGBA PNG) | v1.1.8 | 2787f4a | Claude |
| — | Expected velocity decimal noise (4.076923... → 4.1) | v1.1.8 | 2787f4a | Claude |
| — | Extra boards fully working (fetch + save + render) | v1.1.9 | 2c4688b | Claude |
| — | TASKS.md + workflow in GUIDELINES.md | v1.1.9 | — | Claude |
