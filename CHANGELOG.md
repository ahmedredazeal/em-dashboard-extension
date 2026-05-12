# Changelog

## v1.1.5 (2026-05-12) — Refresh Countdown Timer

**Added:**
- Countdown timer in context bar beside ↻ button — shows `mm:ss` until next auto-refresh
- Timer reads `lastFetch` from cache storage to compute accurate remaining time
- Resets to 30:00 on manual refresh click
- Hidden on auth screen, shown on all dashboard screens

---

## v1.1.4 (2026-05-12) — Collaboration Infrastructure + GitHub Pages

**Added:**
- GitHub Pages site: index.html landing page with docs + changelog links
- CONTRIBUTING.md: full contributor workflow, versioning rules, code rules
- HANDOFF.md: session state log — current version, known issues, next steps
- AI_PROMPT.md: onboarding prompt for new Claude sessions
- GitHub Issue templates: bug report, feature request, docs update
- Versioning policy added to GUIDELINES.md (mandatory on every push)

**Changed:**
- All future pushes must bump manifest.json version + update both changelog files

---

## v1.1.3 (2026-05-12) — Per-View Sentry Sections + Auto Story Points

**Fixed:**
- Sentry issues now display in separate collapsible sections per view (not mixed together)
- Story points auto-detected from board configuration (`/rest/agile/1.0/board/{id}/configuration`)
- Version number now correctly reflects build (manifest.json is source of truth)
- Loading indicator shows while data is being fetched
- Tags no longer shown on issues (replaced by per-section grouping)

**Added:**
- Per-view issue counts in section headers
- Collapsible Sentry view sections (click header to expand/collapse)
- Assignee shown per issue
- Project slug shown per issue

---

## v1.1.0 (2026-05-11) — Dynamic Boards & Multi-Project Sentry

**Added:**
- Dynamic board configuration: multiple boards with custom names
- Drag-and-drop board reordering in settings
- Per-board active sprint detection and display
- Collapsible dashboard sections (per-board)
- Multi-project Sentry integration via saved view IDs
- Sentry view configuration: total count + detailed listings per view
- Settings auto-reload: changes apply immediately without closing side panel
- Migration logic: v1.0.0 single-squad → v1.1.0 multi-board model

**Changed:**
- Settings UI: Board Manager replaces single squad form
- Sentry config: now supports multiple projects via view IDs (e.g., 201661, 205219)
- Dashboard: renders sections per board, sorted by user preference
- Data model: `squad` → `boards[]` array with id, key, customName, order, visible

**Fixed:**
- Settings changes now trigger side panel reload (no manual close/reopen needed)
- Active sprint JQL queries improved for better detection
- Sentry API now fetches issues correctly across multiple projects

---

## v1.0.0 (2026-05-11) — Phase 1: Foundation

**Added:**
- Jira + Sentry integration (read-only APIs)
- Side panel UI with 3 screens: Today, Sprint Health, Reliability
- 4 core alert rules: velocity drop, sprint goal at risk, Sentry spike untriaged, support SLA breach
- Toolbar badge (red dot for unacknowledged alerts)
- Privacy mode toggle (🔒 in app bar) for screen sharing
- Two-row sticky header system per GUIDELINES.md
- Light/dark/browser theme support
- Settings page: Jira + Sentry credentials, squad selection, theme picker
- Background service worker with 30-min polling alarm
- Metrics calculation functions (velocity, goal hit, SLA, Sentry trend)
- Alert rules engine (pure, testable)
- Privacy mode utilities (CSS-based masking scaffold)
- docs.html, changelog.html, privacy.html
- README.md, GUIDELINES.md, PLAN.md

**Notes:**
- Phase 2 (Leapsome + People) coming next
- Leapsome credentials deferred to Phase 2 per user request
