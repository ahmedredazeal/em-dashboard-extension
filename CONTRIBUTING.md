# Contributing to EM Dashboard

This project uses AI-assisted development. Both human contributors and Claude sessions must follow this guide to avoid conflicts, duplicated work, and broken releases.

---

## Before you start

1. **Read [HANDOFF.md](./HANDOFF.md)** — what was last worked on, what's blocked, what's next.
2. **Check [GitHub Issues](https://github.com/ahmedredazeal/em-dashboard-extension/issues)** — pick an unclaimed issue and assign it to yourself.
3. **Never start without claiming an issue.** No issue = no work.

---

## Branching

```
main  (protected — PRs only, never push directly)
├── feature/ahmed-board-manager
├── feature/partner-dark-mode
├── fix/ahmed-sentry-dedup
└── docs/partner-update-readme
```

Branch naming: `type/your-name-short-description`
- Types: `feature`, `fix`, `docs`, `refactor`, `chore`

```bash
git checkout main
git pull
git checkout -b feature/your-name-issue-N
```

---

## Versioning (mandatory on every push)

Every push must bump the version. No exceptions.

| Change type | Version bump | Example |
|---|---|---|
| Bug fix, UI tweak, wording | **PATCH** x.x.+1 | 1.1.3 → 1.1.4 |
| New feature, new screen | **MINOR** x.+1.0 | 1.1.4 → 1.2.0 |
| Data model overhaul, breaking change | **MAJOR** +1.0.0 | 1.2.0 → 2.0.0 |

### Checklist for every commit

- [ ] `manifest.json` version bumped
- [ ] `CHANGELOG.md` top entry updated with version + description
- [ ] `changelog.html` top entry updated with same version
- [ ] `pre-flight.sh` passes (it validates version consistency)
- [ ] `HANDOFF.md` updated at end of session

---

## Commit messages

Format: `type(scope): short description`

```
feat(sentry): add per-view collapsible sections
fix(jira): use agile API for sprint fetching
docs: update HANDOFF.md after session
chore(version): bump to v1.1.4
refactor(popup): extract sprint rendering function
```

---

## Pre-flight check

Always run before committing:

```bash
cd em-dashboard-extension
bash pre-flight.sh
```

Checks:
1. JS syntax (all files)
2. Element audit (no missing getElementById refs)
3. CSP compliance (no inline scripts/handlers)
4. manifest.json validity
5. Required files present
6. Icons present (16/32/48/128)
7. Version consistency (manifest matches changelog)

**Do not push if pre-flight fails.**

---

## Pull Request process

1. Push your branch: `git push -u origin feature/your-name-issue-N`
2. Open a PR on GitHub
3. Title format: `type(scope): description (#issue-number)`
4. Fill the PR template — describe what changed and why
5. Link the issue: `Closes #N`
6. Wait for review from Ahmed before merging
7. After merge: update HANDOFF.md on main

---

## Code rules

- **Manifest V3** — service worker, no persistent background pages
- **CSP compliant** — no inline scripts, no inline event handlers (`onclick=`, etc.)
- **No external CDN** in extension files — all resources must be local
- **No OAuth** — API tokens only, stored in `chrome.storage.local`
- **No frameworks** — vanilla JS, ES modules
- **Jira API**: use Agile API (`/rest/agile/1.0/`) for boards/sprints, REST v3 (`/rest/api/3/`) for everything else
- **Sentry API**: always pass `project` IDs explicitly — the `view=` param alone doesn't filter
- **Zeal footer** on every HTML page

---

## AI contributor notes

If you are a Claude session contributing to this repo:

1. Read this file first
2. Read HANDOFF.md second  
3. Read GUIDELINES.md third
4. Claim a GitHub Issue before writing any code
5. Follow the versioning rules on EVERY push — no exceptions
6. Run `bash pre-flight.sh` before every commit
7. Update HANDOFF.md at the end of your session
8. Never push to `main` directly

The project owner (Ahmed) reviews all PRs and resolves conflicts.

---

## File ownership

| Area | Owner | Notes |
|---|---|---|
| `manifest.json` | Ahmed | Coordinate changes — permissions affect all users |
| `background.js` | Both | Careful with state shape changes |
| `popup.html/js` | Both | Different screens can be worked on in parallel |
| `settings.html/js` | Both | Coordinate new settings fields |
| `src/*.js` | Both | Logic modules, usually safe to work on independently |
| `styles.css` | Both | Announce large layout changes in HANDOFF.md |
| `GUIDELINES.md` | Ahmed | Ask before changing |

---

## Getting help

- Read [GUIDELINES.md](./GUIDELINES.md) for architecture decisions
- Check commit history: `git log --oneline`
- Read [AI_PROMPT.md](./AI_PROMPT.md) for onboarding a new Claude session
- Open a GitHub Issue if something is unclear
