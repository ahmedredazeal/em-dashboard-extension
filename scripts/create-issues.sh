#!/bin/bash
# create-issues.sh
# Run this ONCE from your machine to create retroactive GitHub Issues
# for all work shipped in v1.0.0 → v1.1.9
#
# Usage:
#   export GITHUB_TOKEN=ghp_your_token_here
#   chmod +x scripts/create-issues.sh
#   bash scripts/create-issues.sh

TOKEN="${GITHUB_TOKEN:?Set GITHUB_TOKEN env var first: export GITHUB_TOKEN=ghp_...}"
REPO="ahmedredazeal/em-dashboard-extension"
API="https://api.github.com/repos/${REPO}/issues"

auth_header="Authorization: token ${TOKEN}"
ct_header="Content-Type: application/json"

create_issue() {
  local title="$1"
  local body="$2"
  local labels="$3"
  echo "Creating: $title"
  curl -s -X POST "$API" \
    -H "$auth_header" -H "$ct_header" \
    -d "{\"title\": $(echo "$title" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'), \"body\": $(echo "$body" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'), \"labels\": $labels}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f"  → #{d[\"number\"]} {d[\"html_url\"]}")'
}

echo "Creating retroactive GitHub Issues for EM Dashboard v1.0.0–v1.1.9"
echo "==================================================================="
echo ""

# ------ CLOSED ISSUES (already shipped) ------

create_issue \
  "[BUG] sidePanel.open() error on extension load" \
  "Extension threw 'sidePanel.open() may only be called in response to a user gesture' from background.js:264. Root cause: programmatic chrome.action.onClicked handler conflicted with manifest-declared side panel. Fixed in v1.0.0." \
  '["bug"]'

create_issue \
  "[BUG] Side panel not opening when extension icon clicked" \
  "Nothing happened when clicking the toolbar icon. Root cause: Manifest V3 side panels require explicit chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }). Fixed in v1.0.0." \
  '["bug"]'

create_issue \
  "[BUG] Settings changes require closing and reopening side panel" \
  "After saving settings, the dashboard did not update. Required manual close/reopen. Fixed by sending chrome.runtime.sendMessage({type: 'settings-updated'}) and listening in popup.js. Fixed in v1.1.0." \
  '["bug"]'

create_issue \
  "[BUG] Dashboard shows no data — fetched data never saved to storage" \
  "Background fetched Jira/Sentry data but discarded it without saving to chrome.storage. Popup only loaded from cache (empty on first run). Fixed in v1.1.0." \
  '["bug"]'

create_issue \
  "[FEATURE] Sentry multi-project support via saved view IDs" \
  "Replace single-project Sentry config with support for multiple saved view IDs. Each view = collapsible section with its own count. Settings: Label|ViewID|projectId1,projectId2 format. Implemented in v1.1.3." \
  '["enhancement"]'

create_issue \
  "[BUG] Jira sprint API returns 404 — wrong API family" \
  "Sprint and board endpoints were called on /rest/api/3/ but belong to /rest/agile/1.0/. Also search was using deprecated GET /search instead of POST /search/jql. Fixed in v1.1.2." \
  '["bug"]'

create_issue \
  "[FEATURE] Auto-discover Jira board from project key" \
  "Board ID should not be required in settings. Use GET /rest/agile/1.0/board?projectKeyOrId={key} to auto-discover the scrum board. Board ID field removed from settings. Implemented in v1.1.2." \
  '["enhancement"]'

create_issue \
  "[FEATURE] Sprint story list in dashboard" \
  "Sprint at a glance shows only totals. Add full story list with: assignee, story points, status, due date. Story points auto-detected from board configuration API. Implemented in v1.1.3+." \
  '["enhancement"]'

create_issue \
  "[BUG] Sprint showing 0/0 points — wrong story points field" \
  "Story points field varies by Jira instance. Fixed by using GET /rest/agile/1.0/board/{id}/configuration to read estimation.field.fieldId. Implemented in v1.1.3." \
  '["bug"]'

create_issue \
  "[BUG] All Sentry views showing same 31 issues" \
  "Passing explicit query= param overrode the view's project filters. Sentry view= param does NOT carry project filters — they must be passed as &project=ID params. Fixed in v1.1.3." \
  '["bug"]'

create_issue \
  "[BUG] Sprint at Day 1 incorrectly showing At Risk" \
  "sprintBurndownPrediction calculated velocity=0 on Day 1 and projected 0/47 completion → At Risk. Added early-sprint grace period (first 20% of sprint = Too early). Fixed in v1.1.3." \
  '["bug"]'

create_issue \
  "[BUG] expectedDailyVelocity showing full floating-point (4.076923...)" \
  "Early-sprint return path skipped the Math.round(x * 10) / 10 rounding applied in other paths. Fixed in v1.1.8." \
  '["bug"]'

create_issue \
  "[FEATURE] Sprint section collapsible, collapsed by default" \
  "Sprint at a glance section should be collapsible with a summary visible when collapsed: 'HRM Sprint 64 · 0/47pt · Day 1/13 · Too early'. Implemented in v1.1.3." \
  '["enhancement"]'

create_issue \
  "[FEATURE] Alert section hidden when no alerts" \
  "Alert inbox was always visible showing 'No alerts' placeholder. Section should be hidden entirely when there are no unacknowledged alerts. Implemented in v1.1.3." \
  '["enhancement"]'

create_issue \
  "[FEATURE] Due dates on sprint stories" \
  "Show due date inline per story: '📅 15 May'. Overdue = red, due within 2 days = amber. Implemented in v1.1.8." \
  '["enhancement"]'

create_issue \
  "[BUG] Extension icon corrupted in Chrome tab" \
  "Tab and toolbar icon rendering incorrectly. Regenerated all 4 sizes (16/32/48/128px) as proper RGBA PNG. Fixed in v1.1.8." \
  '["bug"]'

create_issue \
  "[FEATURE] On-demand fetching — remove background alarm" \
  "30-minute background alarm fires regardless of whether panel is open — wasteful. Changed to fetch on panel open only (2-minute cache grace). Fixed in v1.1.6." \
  '["enhancement"]'

create_issue \
  "[FEATURE] Refresh timer: elapsed / countdown in context bar" \
  "Show elapsed time since last fetch beside ↻ button. Under 5min: 'Xm ago'. Over 5min: mm:ss countdown to 30-min mark. Goes amber under 5min remaining. Auto-refresh at 00:00. Implemented in v1.1.7." \
  '["enhancement"]'

create_issue \
  "[FEATURE] Collaboration infrastructure + GitHub Pages" \
  "Add CONTRIBUTING.md, HANDOFF.md, AI_PROMPT.md, GitHub Issue templates, versioning policy, and GitHub Pages landing page (index.html). Implemented in v1.1.4." \
  '["documentation"]'

create_issue \
  "[BUG] Extra boards — fetched but never saved or rendered" \
  "3-gap pipeline failure: extraBoardsData fetched but (1) not saved to storage, (2) not read in popup.js, (3) not in fetchJiraData return value. Fixed in v1.1.9." \
  '["bug"]'

create_issue \
  "[FEATURE] Extra boards: Name|BoardID format with per-board sections" \
  "Extra boards settings now accept Name|BoardID (one per line). Each board renders as a collapsible section with sprint name, points, and story list. Implemented in v1.1.9." \
  '["enhancement"]'

echo ""
echo "==================================================================="
echo "All issues created. Close them by linking commits:"
echo "  git commit -m 'fix(scope): description (Closes #N)'"
echo ""
echo "Next: set up branch protection on main:"
echo "  GitHub → Settings → Branches → Add rule → main"
echo "  ✓ Require pull request before merging"
echo "  ✓ Require status checks to pass"
