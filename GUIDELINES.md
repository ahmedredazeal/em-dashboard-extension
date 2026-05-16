# Zeal Chrome Extension — App Building Guidelines

> These guidelines apply to all Chrome extensions built at Zeal.
> Follow them on every build, every version, without exception.
>
> **⚠ Editing these guidelines requires explicit approval from the project owner.**
> Do not modify this document without confirmation. Propose changes and wait for approval before implementing.

---

## 1. Version management

**Single source of truth: `manifest.json`**

```json
{ "manifest_version": 3, "version": "2.4.2" }
```

- The version number lives **only** in `manifest.json`.
- All rendered instances read it dynamically — never hardcode a version string in HTML or JS.
- In `popup.js` (the main extension page):
  ```js
  const { version } = chrome.runtime.getManifest();
  document.getElementById('app-version').textContent = `v${version}`;
  ```
- In all secondary HTML pages (`docs.html`, `settings.html`, etc.):
  `theme-loader.js` reads the manifest and sets any element with `id="ver-display"`,
  `class="app-version"`, or `data-version` attribute automatically.
- When bumping: change `manifest.json` only. Every page reflects it instantly.

---

## 2. Build checklist (mandatory — every release)

Run these steps in order before packaging:

```
1. node --check <main>.js          — syntax check
2. changelog.html                  — add entry for this version
3. docs.html                       — update "Latest: vX.X.X" if applicable
4. manifest.json                   — bump version
5. Package zip + run element audit — 0 missing getElementById refs
```

No release ships without all 5 steps complete.

---

## 3. Content Security Policy (CSP)

**Rule: zero inline scripts, zero inline event handlers.**

Chrome extension CSP (`script-src 'self'`) blocks ALL of the following:
- `<script>alert()</script>` — inline script block
- `onclick="fn()"` — inline event handler attribute
- `href="javascript:..."` — javascript: URLs

**Always:**
- Put JS in external `.js` files referenced via `<script src="..."></script>`
- Wire events with `addEventListener` in external JS
- For theme detection on page load: use `theme-loader.js` (already set up)

**Manifest must declare:**
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```

---

## 4. Header layout

Every app screen uses a **two-row header system**:

```
┌──────────────────────────────────────────────────────┐
│  [icon]  App Name  v2.4.2                  ⚙   ?    │  ← App bar (sticky, identical on all screens)
├──────────────────────────────────────────────────────┤
│  ←  [KEY]  Project Name  ·  Sprint Name   ↻  ✓  ⎙  │  ← Context bar (per-screen, driven by setContext())
└──────────────────────────────────────────────────────┘
```

**App bar** (`.app-bar`):
- Height: 41px, `position: sticky; top: 0; z-index: 20`
- Left: icon (22×22px, border-radius 5px) + app title (13px, weight 600) + version (10px, --text-lighter)
- Right: icon buttons only (⚙ settings, ? docs)
- Never changes between screens

**Context bar** (`.context-bar`):
- Height: 38px, `position: sticky; top: 41px; z-index: 19`
- Background: `var(--bg-secondary)`
- Driven by `setContext({ back, key, project, sprint, refresh, apply, print })`
- Empty/hidden on auth and project picker screens

---

## 5. Design language

### Typography
| Role | Size | Weight | Color |
|---|---|---|---|
| App title | 13px | 600 | `var(--text)` |
| Version | 10px | 400 | `var(--text-lighter)` |
| Section label | 11px | 600 | `var(--text-muted)` |
| Body text | 13px | 400 | `var(--text)` |
| Hint / caption | 11–12px | 400 | `var(--text-muted)` |
| Badge / chip | 10–11px | 500 | varies by type |

### Spacing
- Card padding: `12px 14px`
- Screen body padding: `14px 16px`
- Gap between cards: `12px`
- Section gap: `28px` (settings page)

### Border radius
- Cards, inputs, buttons: `var(--radius)` = 6px
- Pills / chips: 20px
- Small badges: `var(--radius-sm)` = 4px

### Buttons
- Primary: `var(--primary)` bg, white text
- Secondary: `var(--bg)` bg, `var(--border)` border
- Apply (orange CTA): `var(--apply-orange)` bg
- Icon buttons: 28px min-width, transparent bg, `var(--text-muted)` color

---

## 6. Dark mode

### Architecture
- All colors use CSS custom properties defined in `:root`
- Dark mode overrides in `:root[data-theme="dark"]`
- Browser-follows-OS in `@media (prefers-color-scheme: dark) { :root[data-theme="browser"] {} }`
- Theme is stored in `chrome.storage.local` as `{ theme: 'light' | 'dark' | 'browser' }`
- Applied by `theme-loader.js` on all pages before render (no flash)
- Applied by `loadAndApplyTheme()` in `popup.js` boot()

### Semantic color variables (always use these, never hardcode hex in JS)
| Variable | Light | Dark | Usage |
|---|---|---|---|
| `--bg` | #ffffff | #1a1b23 | Page / card background |
| `--bg-secondary` | #f9fafb | #22232e | Secondary surfaces |
| `--text` | #111827 | #e2e8f0 | Primary text |
| `--text-muted` | #6b7280 | #94a3b8 | Secondary text |
| `--border` | #e5e7eb | #2e3044 | Borders |
| `--primary` | #2563EB | #60a5fa | Primary actions |
| `--row-reg` | #FFFBEB | #1f1400 | Regression story rows |
| `--row-smoke` | #EFF6FF | #0a1628 | Smoke story rows |
| `--row-overdue` | #FEF2F2 | #2d0f0f | Overdue story rows |
| `--ceremony-tint` | rgba(254,243,199,.5) | rgba(31,20,0,.6) | Ceremony day column tint |
| `--sprint-active-bg` | #ECFDF5 | #0a1f14 | Active sprint card background |
| `--sprint-active-border` | #6EE7B7 | #166534 | Active sprint card border |
| `--sprint-active-title` | #111827 | #f0fdf4 | Active sprint name |
| `--sprint-active-sub` | #16A34A | #4ade80 | "Recommended" text |

### Rules
- JS-generated HTML must use `var(--token)` not hardcoded hex for any color that needs to theme-switch
- If a JS color can't use a CSS var (e.g. canvas, SVG fill), define both in a JS object keyed by theme
- Test all features in Light, Dark, and Browser mode before shipping

---

## 7. Zeal branding

### "Powered by Zeal" placement
- **Main extension popup**: centered footer strip at the very bottom, always visible
  ```html
  <div id="zeal-footer">
    <span>Powered by</span>
    <a href="https://www.getzeal.io/" target="_blank"><!-- Zeal SVG --></a>
  </div>
  ```
- **Settings, docs, changelog, print pages**: bottom footer with `border-top`, `margin-top: 32px`
- **Auth screen**: "Built at Zeal" with logo above the CTA button (first-impression branding)

### Zeal logo
- Use the official SVG with `viewBox="0 0 111 35"` (9 paths — the full wordmark)
- Inline SVG only (no external image requests — CSP would block them)
- Use `fill="currentColor"` so color inherits from parent
- Standard size: `height="16" width="50.7"` for footer · `height="18"` for settings
- Color: `#4B5563` (light mode) — the SVG uses `currentColor` so set color on the container
- One link to `https://www.getzeal.io/` per page maximum
- Never display without the link wrapping it

### What Anthropic's policy means
- Zeal products are ad-free
- No third-party ads in any Zeal-built extension
- Zeal branding is attribution, not advertising

---

## 8. Changelog discipline

`changelog.html` is a mandatory deliverable with **every** release.

**Rules:**
- Add entry at the top (newest first)
- Format: `v{version}` — description in plain English
- Major releases (new feature sets): use `.cl-ver.major` class (renders in blue)
- Patch/fix releases: plain `.cl-ver`
- Description must be specific — not "bug fixes" but "Fix: X was causing Y in Z"
- `docs.html` "Latest:" line updated every release (or delegate to `theme-loader.js` via `data-latest-version`)
- If a release ships without a changelog entry, fix it in the same session before moving on

---

## 9. Documentation discipline

`docs.html` must stay in sync with the current feature set.

After any release that changes user-facing behaviour:
- Update the relevant section (scheduling rules, how to use, interactions, etc.)
- Update the version display (`id="ver-display"` now reads from manifest via `theme-loader.js`)
- If a feature is removed from Known Limitations, remove it from docs too

Review `docs.html` against the last 5 builds at minimum whenever doing a code review pass.

---

## 10. Chrome Web Store compliance

### Required for submission
- [x] Manifest V3
- [x] Explicit CSP in manifest
- [x] No inline scripts or event handlers
- [x] Single purpose clearly stated
- [x] Privacy policy URL (host `privacy.html` on GitHub Pages)
- [x] Store listing: name, short desc (≤132 chars), long desc, category, keywords
- [ ] Screenshots: min 1 × 1280×800px (Gantt view first)
- [ ] Developer account registered ($5 one-time fee)

### For Featured badge (additional)
- Verified publisher identity (domain verification)
- Consistent positive track record
- Intuitive UX + latest platform APIs
- Manual review by Chrome Web Store team

### Privacy policy must cover
1. What data is accessed (Jira credentials)
2. Where it's stored (chrome.storage.local — local only)
3. What it's used for (Jira API calls only)
4. No third-party transmission
5. How to delete it (remove extension)

---

## 11. File structure convention

```
manifest.json          — version source of truth + CSP + permissions
background.js          — service worker (side panel open behavior)
popup.html             — main extension UI (all screens)
popup.js               — app controller
styles.css             — shared styles (all pages link this)
theme-loader.js        — theme + version loader for secondary pages
settings.html          — credentials + team config
settings.js            — settings page controller
docs.html              — user-facing documentation
changelog.html         — version history
privacy.html           — privacy policy (for store submission)
GUIDELINES.md          — this file
src/
  scheduler.js         — scheduling engine (pure, no DOM)
  jira-api.js          — Jira REST API client (pure, no DOM)
gantt-print.html       — Gantt PDF export page
gantt-print.js         — export page controller
icons/                 — icon16/32/48/128.png
```

**Rules:**
- Business logic (scheduling, API) in `src/` — zero DOM dependencies
- UI logic in `popup.js` — imports from `src/`
- Secondary pages each have their own `.js` controller
- Never put logic in HTML files (CSP prohibits it anyway)

---

## 12. Element reference safety

Before every release, run the element audit:

```python
import re
with open('popup.js') as f: js = f.read()
with open('popup.html') as f: html = f.read()
all_ids = re.findall(r"getElementById\('([^']+)'\)", js)
setText_ids = re.findall(r"setText\('([^']+)'", js)
missing = [e for e in sorted(set(all_ids + setText_ids)) if f'id="{e}"' not in html]
print(f"Missing: {missing}")  # Must be empty list
```

Zero missing references before shipping. This prevents the `Cannot read properties of null` crashes that caused multiple hotfix releases.

---

## 13. Contributor workflow (applies to ALL contributors — human and AI)

**This section is mandatory. Violating it causes duplicated work and merge conflicts.**

### Before starting ANY work

1. Open `TASKS.md` in the repo root
2. Find an unclaimed task in the **Backlog** column
3. Move it to **In Progress** and add your name/session: `[Claude – 2026-05-16]`
4. Commit the TASKS.md update FIRST, before any code:
   ```
   git checkout -b feature/your-name-task-slug
   git commit -m "chore: claim task — [task title]"
   git push
   ```
5. Only then start writing code

**If there is nothing in Backlog:** stop and ask the project owner what to work on.

### Branching rule

```
main  (protected — PRs only, never push directly)
├── feature/ahmed-board-manager
├── feature/claude-extra-boards
└── fix/claude-sentry-dedup
```

Branch format: `type/your-name-short-description`
- `feature/` — new functionality
- `fix/` — bug fix
- `docs/` — documentation only
- `chore/` — version bumps, cleanup

### Versioning on every push (PATCH / MINOR / MAJOR)

| What changed | Bump |
|---|---|
| Bug fix, UI tweak, copy | `PATCH` x.x.+1 |
| New feature or screen | `MINOR` x.+1.0 |
| Data model, breaking change | `MAJOR` +1.0.0 |

Every push must:
- [ ] Bump `manifest.json` version
- [ ] Add entry at top of `CHANGELOG.md`
- [ ] Add entry at top of `changelog.html`
- [ ] Pass `bash pre-flight.sh`
- [ ] Update `TASKS.md` (mark task done, update HANDOFF.md)

### After finishing

1. Mark task **Done** in `TASKS.md` with version and commit hash
2. Update `HANDOFF.md` with what changed and what's next
3. Open a Pull Request — do not merge your own PR
4. Project owner reviews and merges

---

## 14. TASKS.md is the single source of truth

`TASKS.md` in the repo root is the authoritative list of all planned, in-progress, and completed work.

- **Check it before starting.** If your task isn't there, add it and get approval before starting.
- **Claim it before coding.** Unclaimed = available. In-progress = taken. Done = shipped.
- **No two contributors work on the same task simultaneously.**
- GitHub Issues are optional supplements — `TASKS.md` is always the primary list.

