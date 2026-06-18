# T-CAL-1 — Google Calendar Sync (Plan)

**Status:** planned, not built. Plan-first per project rules. Phase 1 only is in
scope now; phase 2 is sketched so the design does not paint us into a corner.

## Goal (phase 1)

Show the signed-in engineer **today's meetings** in the side panel, with a
**countdown to the next meeting** and a **30-minute alert** (e.g. the countdown
turns red / a flashing indicator) so people stop missing standups and reviews.

Phase 2 (later, NOT now): surface meeting hours **alongside** logged sprint hours
for visibility — explicitly **not** subtracted from the 6h/day capacity line (see
§Capacity decision). No change to the capacity model.

## Hard constraint — Leapsome (recorded so we design honestly)

Zeal's absence requests / approvals / time-off calendar are managed by **Leapsome**,
which cannot be integrated without super-admin — not something to grant all users.
**Therefore: Google Calendar gives us MEETINGS, not approved leave.** The feature
must not imply it knows who is on leave. Anything capacity-related (phase 2) is
"meeting load", never "availability".

## Auth — DECIDED: Option A (private iCal/ICS URL)

**Decision (locked):** use the **private iCal/ICS URL** pasted in settings. Option B
(OAuth) is kept below as a documented fallback if phase 2 ever needs a real API,
but phase 1 ships on Option A. The UI is auth-agnostic, so a later move to B would
not touch the meetings list / countdown.

### How ICS refresh works (poll, not push — recorded so it is not re-litigated)
An ICS secret URL is a **static file** Google serves; there is **no webhook/push**.
The extension cannot be notified of calendar changes — it must **poll** (re-fetch
the file) to see new/moved meetings. This is fine for phase 1:
- The **countdown needs no network** — once today's events are fetched, it ticks
  down client-side (`setInterval`), pure local clock math.
- The **30-min alert** fires off already-fetched data; polling only matters for
  catching meetings *added/moved during the day*. A poll every ~5 min surfaces
  those within 5 min — adequate for a "meeting in 30 min" heads-up.
- So: **poll the ICS on panel open + a light interval while open** (no new
  background alarm — alarms were deliberately removed; panel is the only trigger),
  and **tick the countdown locally every second**.
- Caveat: Google's published ICS feed can itself lag its UI by a few minutes and
  may cache, so even the poll is "near", not "live" — acceptable for a day-view +
  heads-up widget (another reason ICS suits this better than chasing real-time).

### Option A — Private iCal/ICS URL pasted in settings ✅ CHOSEN
- Google Calendar can produce a **private secret address** (`…/basic.ics`) per
  calendar (Calendar settings → "Secret address in iCal format").
- The user pastes that URL into our Settings, exactly like the Jira token field.
  We fetch + parse the `.ics` on a poll.
- **Pros:** maps perfectly onto the existing settings pattern; **no Google Cloud
  project, no OAuth, no manifest `oauth2`**; identical for Zeal and white-label
  (each user just pastes their own URL); read-only by nature.
- **Cons:** coarser — **poll**, not real-time (fine for a 30-min alert, just poll
  every few minutes); the secret URL is a bearer credential (anyone with it sees
  the calendar) so we store it like the Jira token and never log it; the user has
  to find/enable the secret address (a short settings guide handles this); ICS
  parsing has edge cases (recurring events, timezones, all-day) we must handle.
- **Manifest:** add `https://calendar.google.com/*` to `host_permissions`. No new
  Chrome permissions.

### Option B — Google OAuth client ID in settings (NOT chosen — fallback only)
- Standard Google Calendar API via `chrome.identity.launchWebAuthFlow` (or
  `getAuthToken`), scope `calendar.readonly`. Each company registers its **own**
  Google Cloud OAuth client and pastes the **client ID** into Settings.
- **Pros:** proper API (clean JSON events, no ICS parsing); can be near real-time;
  scales to richer phase-2 use.
- **Cons:** **heaviest setup** — a Google Cloud project + OAuth consent screen per
  company; `identity` permission + `oauth2`/host entries in the manifest; OAuth
  consent-screen review if published; more moving parts for the white-label story
  (each company must do Google Cloud setup, not just paste a string).
- **Manifest:** add `identity` permission, `oauth2` block (or web-auth-flow host
  perms for `accounts.google.com` + `www.googleapis.com`).

### Decision rationale
Phase 1 needs only today's meetings + a 30-min alert, for which **Option A is the
right fit**: lightest setup, no Google Cloud project, and it serves Zeal and the
white-label build identically with the paste-in-settings pattern. Option B remains
documented above purely as a migration path if phase 2 grows into richer/real-time
calendar use — and because the UI is auth-agnostic, that migration would not touch
the meetings list or countdown.

## Phase 1 — design

### Data model
A normalized meeting shape, auth-source-agnostic so A or B feed the same UI:
```
{ id, title, start (ISO), end (ISO), allDay (bool), location, attendeesCount }
```
- Filter to **today** (local day, like the report's dayKey) and sort by start.
- All-day events listed separately (no countdown).
- The "next meeting" = earliest event whose start is in the future (or whose
  window contains now → "in progress").

### Fetch + refresh
- Option A: fetch the ICS URL, parse with a small dependency-free ICS reader
  (handle `VEVENT`, `DTSTART/DTEND` incl. `VALUE=DATE` all-day, basic `RRULE`
  expansion for today, `TZID`/UTC). Poll on panel open + every N minutes via the
  existing render scheduler — NO new background alarm (alarms were deliberately
  removed; the only fetch trigger is the panel). The countdown ticks client-side
  with a `setInterval` in the panel; the alert is a UI state, not a notification.
- Option B: `calendar.readonly` list call for `timeMin=startOfToday`,
  `timeMax=endOfToday`.
- **Cache** today's meetings in `chrome.storage.session` so reopening is instant.

### UI (side panel)
- A **"Today" card** (likely above Insights, or a compact strip in the header
  area): list of today's meetings (time, title), the **next-meeting countdown**,
  and the **30-min alert** state (countdown turns red + a subtle flashing dot).
- Empty state: "No meetings today." Error/unconfigured state: a link to the
  Calendar settings section.
- The countdown is pure client-side time math; the alert threshold (30 min) can be
  a constant first, a setting later.

### Settings
- New **"Calendar"** section: the ICS URL field (Option A) or the OAuth client ID +
  Connect button (Option B), a short how-to, and an enable/disable toggle.
- Stored under `settings.calendar.{enabled, icsUrl | oauthClientId}`. The secret
  URL / token is treated like the Jira token (never logged, never sent anywhere
  but Google).

### Demo / mock mode
- `generateMockMeetings()` → a few plausible meetings around "now" (one within
  30 min to show the alert state) so the feature demos without a real calendar.

### Telemetry
- If kept (Zeal build), a `section_viewed: calendar` usage event on open, deduped,
  mock-suppressed — consistent with v2.17. **Discard in white-label** like the rest
  of the usage stack (T-WL-1 §4).

## Capacity decision (phase 2, recorded now)

**Meetings are shown ALONGSIDE logged hours, NOT subtracted from capacity.** The
6h/day capacity line is unchanged. Rationale: subtracting meeting hours would (a)
risk double-counting against worklog hours an engineer may have logged for a
meeting, and (b) imply an availability model we cannot validate (Leapsome owns
leave). Phase 2 is pure visibility: e.g. "logged 4h · 5h in meetings today" side by
side, so the analysis context is visible without the tool asserting a capacity
judgement. Revisit only if a clear, non-double-counting model emerges.

## White-label implications (T-WL-1)
- Option A serves both builds identically (paste your own ICS URL). Option B needs
  per-company Google Cloud setup → heavier for WL.
- Telemetry for this feature follows the WL rule: discard from the public build.
- The Leapsome constraint is Zeal-specific; the feature itself is generic
  (any Google Calendar), so it is white-label-friendly under Option A.

## Build order (phase 1, when approved)
1. Settings "Calendar" section + storage shape (`settings.calendar.{enabled, icsUrl}`).
2. Fetch + normalize: a small dependency-free ICS parser — pure, unit-tested.
3. Today-card UI + client-side countdown + 30-min alert state.
4. Demo/mock meetings.
5. Docs (the six) + version bump (minor).

> Nothing here is built yet. Phase 1 only; phase 2 (capacity visibility) is
> sketched and deliberately deferred. Auth approach is DECIDED: Option A (ICS URL).
