# AI_PROMPT.md — New Claude Session Onboarding

> Copy everything below the line and paste it as your first message to Claude.

---

You are contributing to the **EM Dashboard** Chrome extension — an Engineering Manager cockpit for Jira + Sentry, built for the Zeal team.

## Your first steps (mandatory before any code)

1. Read `TASKS.md` — the single source of truth for all work. Find an unclaimed (📋) task, move it to In Progress with your name + date, commit that change first on a new branch.
2. Read `HANDOFF.md` — current version, known issues, architecture notes.
3. Read `CONTRIBUTING.md` — branching, versioning, commit format.
4. Read `GUIDELINES.md` sections 13–14 — the contributor workflow rules.

**Do not write a single line of code before doing steps 1–4.**
**No task in TASKS.md = stop and ask what to work on.**

## ⚠️ MANDATORY: docs update before every commit

Before the final `git commit` of **any** task — no exceptions:

- `README.md` — update features list and architecture if changed
- `HANDOFF.md` — update session state, current version, what's next
- `TASKS.md` — move completed tasks to Done, update backlog
- `docs.html` — update in-app help if user-visible behaviour changed
- `CHANGELOG.md` + `changelog.html` — add version entry

If pre-flight fails because the version is missing from changelog, it's because this step was skipped. Fix the docs, then push.

## Repo

`https://github.com/ahmedredazeal/em-dashboard-extension`

Clone it, read the docs, then we'll decide together what you work on.

## Git setup (I'll provide credentials)

- GitHub org: `ahmedredazeal`
- You'll need a Personal Access Token to push — ask me for one
- Never push to `main` directly

## Versioning — mandatory on EVERY push

| What you changed | Bump |
|---|---|
| Bug fix, UI tweak, copy change | PATCH: x.x.+1 |
| New feature, new screen | MINOR: x.+1.0 |
| Data model, breaking change | MAJOR: +1.0.0 |

On every commit you must:
- Bump `manifest.json` version
- Add entry to `CHANGELOG.md` (top)
- Add entry to `changelog.html` (top)
- Run `bash pre-flight.sh` — must pass before pushing
- Update `HANDOFF.md` at session end

## Commit format

```
type(scope): description
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`

Example: `fix(sentry): pass project IDs to avoid view filter bypass`

## Critical technical notes

- Chrome Manifest V3 — service worker only, no persistent background
- CSP: no inline scripts, no `onclick=` attributes anywhere in HTML
- Jira boards/sprints: `/rest/agile/1.0/` (NOT `/rest/api/3/` — returns 404)
- Jira search: POST `/rest/api/3/search/jql` (GET is deprecated)
- Sentry: always pass `project` IDs explicitly — `view=` param alone does NOT filter by project
- No external CDN in extension files — everything must be local
- Zeal footer required on every HTML page

## What NOT to do

- Never push directly to `main`
- Never start coding without claiming a GitHub Issue
- Never skip the version bump
- Never skip `pre-flight.sh`
- Never add `onclick=` handlers in HTML (CSP violation)
- Never add framework dependencies

## Tech stack

Vanilla JS (ES modules), Chrome Extension MV3, CSS custom properties, Jira REST v3 + Agile v1.0, Sentry Issues API v0.

Now: clone the repo, read the three files I mentioned, and tell me what you found in HANDOFF.md before we decide what to work on.
