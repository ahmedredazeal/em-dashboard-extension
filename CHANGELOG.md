# Changelog

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
