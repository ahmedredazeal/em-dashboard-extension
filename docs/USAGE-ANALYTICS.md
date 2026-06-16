# Usage Analytics — Setup Guide (Sentry)

How to read "who's using Zealer Dashboard, how often, and which features" from the
telemetry the extension already sends to the `zealer-dashboard` Sentry project.

> **Disclosure note.** The extension records per-person usage (Jira identity:
> email, accountId, display name) on each session, plus which sections are opened
> and session duration. This must be disclosed to users in the rollout message
> before the tool is shared team-wide. Identified usage tracking without notice is
> not acceptable; with notice it is normal operational instrumentation.

## What the extension sends

All events go to the hardcoded write-only telemetry DSN (separate from any
user-configured Sentry — see DECISIONS.md "Multi-team support"). No tokens or
issue contents are included; only the fields below.

| Event | When | Key fields |
|---|---|---|
| `app_opened` (usage) | first time identity resolves in a browser session | user{email,id,username}, release (version), tags{role, squad} |
| `section_viewed` (usage) | a user opens a section/feature | + tags{section}: `insights`, `sprint`, `sentry`, `monthly_report`, `gantt_fulltab` |
| `app.session` (transaction) | panel hidden/closed (session > 1s) | duration (start→end), user, release |
| `jira.fetch` (transaction) | each Jira fetch | duration |
| errors | handled failures | message, user, context |

Demo/Mock mode is suppressed — sample sessions never reach analytics.

## Reading it in Sentry (no code)

### Active users & frequency
- **Discover → New query**, dataset *Errors* (usage events are captured as
  events). Filter `usage_event:app_opened`. Columns: `user.email`, `count()`,
  `count_unique(user)`. Group by day for DAU; by week for WAU.
- Save as "Zealer — Active Users".

### Who specifically (per-person)
- Same query, columns `user.username`, `user.email`, `count()` — sort desc.
  This is the "who's using it, how often" table.

### Version adoption
- Filter `usage_event:app_opened`, group by `release`. Shows how many are on the
  latest version vs. behind — useful right after a release.

### Feature usage
- Filter `usage_event:section_viewed`, group by `section`. Tells you which views
  earn their keep (and which to cut).

### Session length
- Transactions dataset, filter `transaction:app.session`, view `p50`/`p75`
  duration. (A rough engagement proxy — a side panel left open inflates this, so
  read it as "kept open", not "actively used".)

### Build a dashboard
- **Dashboards → Create Dashboard**. Add widgets from the queries above:
  active-users line, per-person table, version pie, feature bar, session p50.
  This is the single screen to check before/after the team rollout.

## Caveats
- Sentry is an error product; per-user *product* analytics works but is against
  the grain. For an internal tool at eng-team scale it's sufficient. If you later
  want retention curves/funnels, a dedicated analytics product would fit better.
- Event retention/sampling follows your Sentry plan — long-range trends may age
  out. Export periodically if you need history beyond the retention window.
- Verify events are actually arriving: open the Sentry project and confirm
  `app_opened` shows with `user`/`role`/`squad` populated. (Can't be verified from
  the build sandbox — it has no network access to Sentry.)
