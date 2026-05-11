# EM Dashboard — Developer Documentation

## Phase 1 Architecture

### Pure Logic (src/)
All files in `src/` have zero DOM dependencies and can be tested with `node --check`:
- **metrics.js** — calculation functions (velocity, SLA, utilization, etc.)
- **alerts.js** — alert rules engine, pure functions returning Alert objects
- **privacy-mode.js** — utilities for toggling/checking privacy mode
- **jira-api.js** — Jira REST API v3 client (read-only)
- **sentry-api.js** — Sentry REST API client (read-only)

### UI Controllers
- **popup.js** — main side panel controller (imports from src/)
- **settings.js** — settings page controller
- **background.js** — service worker (alarms, fetching, alerts, badge)

### CSP Compliance
- Zero inline scripts, zero inline event handlers
- All JS in external files, wired with addEventListener
- Theme applied by theme-loader.js before render (no flash)

### Data Model
All state in chrome.storage.local:
```
settings: {jira, sentry, squad, ui, alerts}
alerts: [{id, ruleId, severity, message, createdAt, acknowledged}]
sprintHistory: [{sprintId, velocity, goalAchieved, carryOver}]
currentSprint: {id, name, totalPoints, completedPoints, daysElapsed, totalDays}
sentryIssues: [{title, firstSeen, status, count}]
supportTickets: [{summary, created, updated}]
```

### Build Checklist (GUIDELINES.md §2)
Before every release:
1. `node --check popup.js settings.js background.js`
2. Add changelog entry
3. Update docs.html version line
4. Bump manifest.json version
5. Element audit script (zero missing refs)
6. Package zip

### Element Audit Script
```python
import re
with open('popup.js') as f: js = f.read()
with open('popup.html') as f: html = f.read()
all_ids = re.findall(r"getElementById\('([^']+)'\)", js)
missing = [e for e in sorted(set(all_ids)) if f'id="{e}"' not in html]
print(f"Missing: {missing}")  # Must be []
```

### Testing
Phase 1 has no automated tests. Manual test checklist:
- [ ] Settings round-trip (save → reload)
- [ ] Jira test connection
- [ ] Sentry test connection
- [ ] Theme switching (light/dark/browser)
- [ ] Privacy mode toggle
- [ ] Alert inbox populates
- [ ] Sprint Health metrics render
- [ ] Reliability Sentry count updates
- [ ] Background alarm fires (check after 30min)
- [ ] Toolbar badge updates
