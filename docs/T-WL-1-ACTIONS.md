# T-WL-1 — White-Label Build: Action List

**Purpose.** A concrete, justified list of actions to turn the private Zeal build
into the public white-label clone. Seeded from the project history (this is the
conversation with the most context on *why* each feature exists), so the dedicated
WL chat can start from decisions, not a blank slate.

**Fork decision (locked):** option **(B) clone** — a separate PUBLIC repo is the
white-label/store build; this repo stays the private Zeal build. Actions below are
things to do **in the clone** unless noted.

**Legend:** 🔴 blocker (must do before any public release) · 🟡 important ·
🟢 nice-to-have · KEEP / CHANGE / DISCARD = disposition for the public build.

---

## 1. Telemetry & privacy — 🔴 the critical area

- **🔴 [A1] Remove / neutralize the hardcoded Sentry usage DSN.** `background.js`
  has `const SENTRY_DSN = 'https://…@o164516.ingest.us.sentry.io/…'` and the host
  is in `manifest.json` `host_permissions`. **CHANGE.** A public build must NOT
  phone usage home to Zeal. Options: (a) strip telemetry entirely from the public
  build; (b) make it opt-in and point it at the *installing company's* own Sentry;
  (c) no-op the DSN by default. Recommended: **(a) or (c)** for v1 — simplest, and
  avoids any "are you spying on us" question. The whole v2.17/v2.18 usage-analytics
  stack (rolling per-user profile, action tracking) is Zeal-internal tooling;
  **DISCARD from the public build** (or make it the installer's own, off by
  default). *Justification: shipping identified per-user analytics to Zeal from
  other companies' installs is a serious trust/privacy breach and likely the single
  biggest reason to keep the public build a separate clone.*
- **🔴 [A2] Secrets audit.** Grep the clone for any token/PAT/DSN/email. The
  `ghp_…` PAT lives only in local git remotes (not in tracked files) — confirm. No
  hardcoded credential may ship publicly.
- **🟡 [A3] Telemetry references in docs.** `docs/USAGE-ANALYTICS.md` is entirely
  Zeal-internal. **DISCARD or rewrite** for the public build (it describes
  reporting to Zeal's project).

## 2. Branding surface — 🟡 the main new feature

- **🟡 [B1] Brand config with Zeal as default.** Introduce a single branding config
  (display name, logo, splash text/image, theme accent colours) read at runtime,
  defaulting to Zeal. **NEW.** *Justification: this is the actual "white-label"
  ask; most other config (Jira/Sentry URLs, squad, boards) is already dynamic.*
- **🟡 [B2] In-app name replaces "Zealer".** Audit hardcoded "Zealer"/"Zeal Dashboard"
  strings in popup.html, settings.html, docs.html, splash → pull from B1 config.
- **🟡 [B3] Logo / icon.** In-app logo from B1 config. NOTE: the **manifest `name`
  and store icons are fixed per Chrome Web Store listing** — so the *store* identity
  is one brand (the public product name), while the *in-app* brand is themeable.
  Decide the public product name for the CWS listing.
- **🟢 [B4] Settings UI for branding.** A "Branding" settings section so a company
  admin sets name/logo/colours without editing code.

## 3. Zeal-specific defaults & hardcodes — 🟡

- **🔴 [C1] Hardcoded custom-field IDs.** `customfield_10015` (start date) is
  hardcoded in `jira-api.js` + `parsers.js`; `customfield_10039` (story points) is
  referenced. These are **Zeal Jira-instance-specific** and will not exist in
  another company's Jira. **CHANGE.** Make them configurable (Settings) or
  auto-discover by field name (the `findFieldIdByName` pattern already used for
  "App Name" in T-BR-1 is the model). *Justification: without this, charts depending
  on start date / points silently break on any other Jira.*
- **🟡 [C2] Strip/gate Zeal default config.** Default squad `HRM`, support board
  `176`, the "App Name" field, the Sun–Thu work week, the `zeal-pay.atlassian.net`
  examples — move all to first-run setup with neutral defaults. **CHANGE.**
- **🟢 [C3] Mock/demo data is Zeal-flavoured** (HRM, Zeal names). **CHANGE** to
  generic sample data for the public build (also nice for store screenshots).

## 4. Feature dispositions (keep / change / discard for public)

- **Sentry Insights — KEEP (optional).** Already uses the user's *own* Sentry
  org/token (multi-team work, v2.13.0) and is view-managed. No Zeal coupling beyond
  the telemetry DSN (separate concern, A1). Ship as an optional feature.
- **Monthly Report (T-RPT-1) — KEEP.** Fully config-driven; no Zeal specifics once
  C1/C2 done. Demo data needs C3.
- **Bug Reports (T-BR-1) — KEEP.** "App Name" grouping is field-name resolved, so it
  degrades gracefully if a company lacks that field (falls back to Unspecified).
- **Usage analytics (v2.17/v2.18) — DISCARD** from public (see A1).
- **Update nudge (T-DIST-1 ph1) — CHANGE.** It points at *this* repo's GitHub
  releases. Repoint at the public repo's releases, or rely on Chrome Web Store
  auto-update (T-DIST-1 ph2) and drop the nudge for the public build.
- **Support boards / SLA (T-SLA-1) — KEEP, but** the SLA matrix is Zeal's; make it
  configurable rather than baked in (it is not built yet, so design it config-first).

## 5. Distribution & store — 🟡

- **🟡 [E1] Chrome Web Store listing** — needs the Google dev account ($5, from
  T-DIST-1 ph2). Public product name, screenshots (use C3 generic data),
  description, privacy disclosure (must state what data the extension touches and
  that nothing is sent to a third party once A1 is done).
- **🟡 [E2] Privacy policy** — CWS requires one for extensions handling user data.
  Must be truthful about the (now removed/opt-in) telemetry.
- **🟢 [E3] README/docs rewrite** for a public audience (no Zeal-internal refs).

## 6. Sync strategy (two codebases) — 🟢

- **🟢 [F1] Decide how shared fixes propagate** between private and public clones.
  Options: cherry-pick, a shared-core submodule/package, or periodic manual merge.
  Defer until drift actually hurts, but note it so it is a conscious choice.

---

## Suggested ordering for the dedicated WL chat
1. **A1 + A2** (telemetry off, secrets clean) — nothing ships publicly until these
   are done; they are the whole reason for a separate clone.
2. **C1** (configurable/auto-discovered field IDs) — without it the tool breaks on
   any non-Zeal Jira.
3. **B1–B3** (branding config + name/logo) — the actual white-label feature.
4. **C2 + C3** (neutral defaults + generic demo data).
5. **E1 + E2** (store listing + privacy policy).
6. Feature dispositions (§4) folded in as each area is touched.
7. **F1** (sync strategy) — decide once, lazily.

> All of the above is for the CLONE. This private repo is unchanged by T-WL-1. None
> of this is built yet — the dedicated WL chat starts here.
