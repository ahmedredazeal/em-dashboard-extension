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
| `app_opened` (usage) | first time identity resolves in a browser session | user{email,id,username}, release (version), tags{role, squad, days_active, total_opens, first_version}, extra.usage_stats (full rolling profile) |
| `section_viewed` (usage) | a user opens a section/feature | + tags{section}: `insights`, `sprint`, `sentry`, `monthly_report`, `gantt_fulltab` |
| `action_taken` (usage) | a user performs a tracked action | + tags{action}: `export_report`, `scope_toggled`, `ticket_clicked` |
| `app.session` (transaction) | panel hidden/closed (session > 1s) | duration (start→end), user, release |
| `jira.fetch` (transaction) | each Jira fetch | duration |
| errors | handled failures | message, user, context |

### The rolling per-user profile (attached to `app_opened`)

Sentry is an error backend, so per-user retention math (distinct days active,
lifetime opens) is against its grain and normally needs Discover-tier
aggregation. Instead the extension keeps a tiny profile in
`chrome.storage.local` and folds it forward on each open, attaching it to the
event. The **latest event per user** is then self-describing — read it straight
from the Issues view:

| Field | As | Meaning |
|---|---|---|
| `days_active` | tag | distinct calendar days opened (timezone-aware) |
| `total_opens` | tag | lifetime session opens |
| `first_version` | tag | version on first ever open |
| `usage_stats` | extra | full profile: firstSeen, lastSeen, currentVersion, plus per-`sections` and per-`actions` counts |

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

### Build a dashboard (verified widget recipes)

**Dashboards → Create Dashboard → "Zealer — Usage"**, then Add Widget. Set
**Dataset: Errors** on every widget (usage events are captured as events, not
transactions). Scope the whole dashboard to the `zealer-dashboard` **project**
and a **30D** range via the dashboard's bottom filter bar.

| Widget | Type | Visualize / Columns | X-Axis / Group by | Filter |
|---|---|---|---|---|
| Active Users | Line | `count_unique(user)` (+ optional `count()` series) | — | `usage_event:app_opened` |
| Version Adoption | Table | columns `release`, `count_unique(user)` (sort desc) | `release` | `usage_event:app_opened` |
| Feature Usage | Bar / Table | `count()` | `section` (or `tags[section]` if not yet in the dropdown) | `usage_event:section_viewed` |
| Action Usage | Bar / Table | `count()` | `action` (or `tags[action]`) | `usage_event:action_taken` |
| Usage by Squad | Bar | `count_unique(user)` | `squad` | `usage_event:app_opened` |

Notes from setup:
- **Bar (Categorical)** can throw "Something went wrong" — prefer **Table** for
  the grouped widgets (most reliable; sortable).
- The grouping field for a **Bar (Categorical)** is its **X-Axis** (there's no
  separate "Group by" section).
- Low-volume custom tags (e.g. `section`, `action` before rollout) may not appear
  in the X-Axis/column dropdown until they have more events behind them — that's
  Sentry indexing, not a data gap. Use the `tags[<key>]` form, or build the widget
  in **Explore → Discover** (more permissive) and "Save to Dashboard".
- Switching a widget's chart type can clear its **Filter** — re-check it after.
- To exclude your own dev reloads later, add `!user.email:<you>` to the
  per-user widgets (kept off during initial setup so there's data to evaluate).

## Caveats
- Sentry is an error product; per-user *product* analytics works but is against
  the grain. For an internal tool at eng-team scale it's sufficient. If you later
  want retention curves/funnels, a dedicated analytics product would fit better.
- Event retention/sampling follows your Sentry plan — long-range trends may age
  out. Export periodically if you need history beyond the retention window.
- Verify events are actually arriving: open the Sentry project and confirm
  `app_opened` shows with `user`/`role`/`squad` populated. (Can't be verified from
  the build sandbox — it has no network access to Sentry.)
