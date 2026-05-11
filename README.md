# EM Dashboard — Chrome Extension

Engineering Manager cockpit for Jira + Sentry: sprint health, reliability alerts, and automated monthly briefing, in a Chrome side panel.

## Features (Phase 1 — v1.0.0)

- **Always-on watch** — 4 alert rules fire when metrics trip: velocity drop, sprint goal at risk, Sentry spike untriaged, support SLA breach
- **Three screens** — Today (alert inbox + sprint glance), Sprint Health (velocity/goal/carry-over), Reliability (Sentry 7-day trend/SLA)
- **Privacy mode** — 🔒 toggle masks personal content during screen shares (Phase 2+ will mask 1:1 notes, people log, promotion evidence)
- **Zero infrastructure** — credentials stored locally, read-only APIs, no backend

## Installation

1. Clone this repo: `git clone https://github.com/ahmedredazeal/em-dashboard-extension`
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `em-dashboard-extension` folder
5. The dashboard icon appears in your toolbar

## Setup

1. Click the toolbar icon
2. You'll be prompted to set up credentials
3. Enter Jira (base URL, email, API token) and Sentry (org, project, token)
4. Select your squad (project key, name, board ID)
5. Save → dashboard loads

API tokens:
- Jira: [id.atlassian.com/manage/api-tokens](https://id.atlassian.com/manage/api-tokens)
- Sentry: Settings → Account → API → Auth Tokens

## Architecture

```
manifest.json          # v3, CSP, side panel, host permissions
background.js          # service worker: alarms, fetching, alert rules, badge
popup.html / popup.js  # side panel UI + controller
settings.html / .js    # credentials + squad + theme
src/
  jira-api.js          # Jira REST API v3 client
  sentry-api.js        # Sentry REST API client
  metrics.js           # pure calculation functions
  alerts.js            # alert rules engine
  privacy-mode.js      # screen-share privacy utilities
```

## Roadmap

- **Phase 2 (v1.1.0)**: People + Leapsome (vacations, learning paths, 1:1 tracker, growth plans, roster)
- **Phase 3 (v1.2.0)**: Monthly Brief auto-builder (PDF export, copy-as-markdown)
- **Phase 4 (v1.3.0)**: Promotions (PM cycle tracker, candidate management, mid-cycle check-ins)
- **Phase 5 (v1.4.0+)**: Polish (more alert rules, EazyBI, optional Slack webhook)
- **Phase 6 (v2.0.0)**: Multi-squad rollup for senior EMs

## Guidelines

All builds follow `GUIDELINES.md` (copied from Sprint Planner):
- CSP-clean (no inline scripts/handlers)
- Two-row sticky header
- Version only in manifest.json
- Light/dark/browser themes
- Zeal footer on every page

## License

Built at Zeal
