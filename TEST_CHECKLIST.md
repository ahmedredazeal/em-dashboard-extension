# Zealer Dashboard — Test Checklist

Run this checklist before every release. All items must pass.

---

## Pre-Flight Checks (Automated)

Run `./pre-flight.sh` to validate:

- [ ] All JS files pass `node --check` (syntax)
- [ ] No missing `getElementById` references (element audit)
- [ ] No inline scripts or event handlers (CSP compliance)
- [ ] manifest.json is valid JSON
- [ ] All required files exist
- [ ] Icons are present (16/32/48/128.png)
- [ ] Version in manifest.json matches changelog.html top entry

---

## Load Test (Chrome Extensions)

1. **Load unpacked in Chrome**
   - [ ] `chrome://extensions` → Developer mode ON → Load unpacked
   - [ ] Extension loads without errors in red text
   - [ ] Click "Errors" button → 0 errors shown
   - [ ] Click "service worker" link → console shows `[background] Zealer Dashboard installed/updated`

2. **Initial icon click**
   - [ ] Click toolbar icon → side panel opens (no errors)
   - [ ] Shows auth screen with "Set up credentials" button
   - [ ] No console errors in side panel (F12)

---

## Settings Test

1. **Settings page opens**
   - [ ] Click "Set up credentials" → settings.html opens
   - [ ] All form fields visible and editable
   - [ ] Theme swatches render correctly
   - [ ] Zeal footer visible at bottom

2. **Jira connection test**
   - [ ] Enter valid Jira URL, email, token
   - [ ] Click "Test Jira connection"
   - [ ] Should show green checkmark: "✓ Connected as [name]"
   - [ ] Console: no errors

3. **Sentry connection test**
   - [ ] Enter valid Sentry org, project, token
   - [ ] Click "Test Sentry connection"
   - [ ] Should show green checkmark: "✓ Connected to [org]"
   - [ ] Console: no errors

4. **Save settings**
   - [ ] Fill all fields (Jira, Sentry, Squad, Theme)
   - [ ] Click "Save settings →"
   - [ ] Should show green "✓ Settings saved"
   - [ ] Settings page closes after 1 second
   - [ ] Console: no errors

---

## Main Dashboard Test

1. **Today screen loads**
   - [ ] Side panel reopens automatically
   - [ ] Shows "Today" screen (not auth)
   - [ ] App bar shows: icon, "Zealer Dashboard", version, 🔒, ⚙, ?
   - [ ] Context bar shows: squad key badge, project name, sprint name, ↻
   - [ ] Alert inbox renders (empty or with alerts)
   - [ ] Sprint glance card shows sprint name
   - [ ] Fresh Sentry spikes section visible
   - [ ] Zeal footer visible at bottom

2. **Navigation works**
   - [ ] App bar ⚙ button → opens settings
   - [ ] App bar ? button → opens docs.html in new tab
   - [ ] Context bar ↻ button → triggers refresh (check console for `[background] Alarm triggered...`)

3. **Privacy mode toggle**
   - [ ] Click 🔒 in app bar
   - [ ] Amber banner appears: "🔒 Privacy mode — personal content hidden"
   - [ ] Body gets class `privacy-on`
   - [ ] Click 🔒 again → banner disappears
   - [ ] Console: no errors

---

## Background Service Worker Test

1. **Service worker active**
   - [ ] `chrome://extensions` → Zealer Dashboard → click "service worker"
   - [ ] Console shows boot messages
   - [ ] No red errors

2. **Alarm registered**
   - [ ] In service worker console, check: `chrome.alarms.getAll()`
   - [ ] Should return array with `em-dashboard-check` alarm
   - [ ] `periodInMinutes: 30`

3. **Manual refresh**
   - [ ] In side panel console: `chrome.runtime.sendMessage({type: 'refresh-dashboard'})`
   - [ ] Service worker console shows: `[background] Alarm triggered, checking dashboard...`
   - [ ] Service worker console shows fetch attempts for Jira/Sentry
   - [ ] If credentials are valid, shows: `[background] Dashboard check complete`

4. **Badge updates**
   - [ ] If alerts fire, toolbar icon shows red badge with count
   - [ ] Click side panel → alerts appear in inbox
   - [ ] Click an alert → badge count decreases

---

## Theme Test

1. **Light theme**
   - [ ] Settings → Appearance → select Light → Save
   - [ ] Side panel background is white (#ffffff)
   - [ ] Text is dark (#111827)

2. **Dark theme**
   - [ ] Settings → Appearance → select Dark → Save
   - [ ] Side panel background is dark (#1a1b23)
   - [ ] Text is light (#e2e8f0)

3. **Browser theme**
   - [ ] Settings → Appearance → select Browser → Save
   - [ ] Theme follows OS dark mode setting
   - [ ] Toggle OS dark mode → extension theme switches

---

## Data Flow Test

1. **Jira data loads**
   - [ ] Service worker console: look for `[background] Fetching data...`
   - [ ] Should see Jira API calls
   - [ ] Sprint history populated
   - [ ] Current sprint data appears in "Sprint glance"

2. **Sentry data loads**
   - [ ] Service worker console: Sentry API calls visible
   - [ ] "Fresh Sentry spikes" section populates (if recent issues exist)

3. **Sprint Health screen**
   - [ ] Click Sprint Health (if navigation exists)
   - [ ] Velocity value shown
   - [ ] Goal hit rate shown
   - [ ] Carry-over rate shown
   - [ ] Stale tickets list (if any)

4. **Reliability screen**
   - [ ] Click Reliability
   - [ ] Sentry 7-day trend shown
   - [ ] Untriaged spikes list (if any)
   - [ ] SLA adherence shown

---

## Alert Rules Test

**Prerequisite:** Real Jira/Sentry data that trips at least one rule

1. **velocity_drop (medium)**
   - [ ] If velocity dropped >15% for 2 sprints: alert fires
   - [ ] Alert appears in Today inbox
   - [ ] Severity badge shows "MEDIUM"
   - [ ] Message includes sprint names and velocities

2. **sprint_goal_at_risk (high)**
   - [ ] If mid-sprint burndown predicts miss: alert fires
   - [ ] Severity: HIGH
   - [ ] Message includes predicted/total points

3. **sentry_spike_untriaged (high)**
   - [ ] If Sentry issue >24h old, not triaged: alert fires
   - [ ] Severity: HIGH
   - [ ] Message includes age in hours

4. **support_sla_breach (high)**
   - [ ] If support ticket aged past SLA: alert fires
   - [ ] Severity: HIGH
   - [ ] Message includes age and % over SLA

---

## Error Handling Test

1. **Invalid credentials**
   - [ ] Settings: enter wrong Jira token
   - [ ] Test connection → should show red error message
   - [ ] Console: no uncaught exceptions

2. **Network failure**
   - [ ] Turn off WiFi
   - [ ] Trigger refresh
   - [ ] Service worker console: should log error, not crash

3. **Missing squad config**
   - [ ] Settings: save with empty squad key
   - [ ] Should not crash
   - [ ] Today screen shows placeholder or error message

---

## Documentation Test

1. **docs.html opens**
   - [ ] Click ? in app bar
   - [ ] New tab opens with docs.html
   - [ ] Version displayed correctly
   - [ ] Theme applied (light/dark/browser)
   - [ ] Zeal footer visible

2. **changelog.html accessible**
   - [ ] docs.html → link to changelog
   - [ ] Opens in new tab
   - [ ] v1.0.0 entry visible at top

3. **Links work**
   - [ ] Settings → "Open documentation" link works
   - [ ] All external links (Jira API tokens, Sentry, Zeal) open correctly

---

## Console Cleanliness

Throughout all tests above:

- [ ] Side panel console: zero red errors (warnings OK)
- [ ] Service worker console: zero red errors
- [ ] Settings page console: zero red errors

---

## Regression Check (After Fixes)

After fixing any issue:

1. [ ] Re-run full checklist from top
2. [ ] Verify fix doesn't break other features
3. [ ] Update CHANGELOG.md with fix
4. [ ] Bump manifest version if shipping

---

**Pass Criteria:** All items checked = ready to ship
**Fail:** Any unchecked item = do not release until fixed
