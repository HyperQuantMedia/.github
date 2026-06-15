<!-- Copyright (C) 2026 HyperQuant Media L.L.P. All rights reserved. Licensed under GNU GPL v3.0. -->

# Orrery — Ecosystem Roadmap automation

Keeps the **Orrery — Ecosystem Roadmap** board (org project **#13**) alive by rolling
per-project health onto each project's anchor item. No human edits the numbers.

## What it writes

For every Orrery item whose **Project** field maps to a repo (`scripts/orrery-config.json`):

| Field | Source |
|-------|--------|
| **Open** | repo open-issue count |
| **Done** | repo closed-issue count |
| **Progress %** | board completion (done items / total) if that project has a board, else closed/(open+closed) |
| **State** | `Shipped` (board all done) · `In Progress` (any active/done) · `Planned` (none). **`Blocked` is a manual override and never overwritten.** |
| **Last synced** | run date |

*Hybrid:* issue counts + board Status breakdown. Cross-cutting items (no repo) are left manual.

## How it runs

- **Event-driven** — each product repo runs `orrery-notify.yml`; on issue/PR close it fires a
  `repository_dispatch` (`orrery-sync`) at this repo, which runs `orrery-rollup.yml`.
- **Nightly cron** (06:17 UTC) — safety net. *GitHub emits no Actions event when a Project v2
  card is dragged between columns, so board-only moves are caught here, not by the hook.*
- **Manual** — Actions tab → *Orrery rollup* → *Run workflow*.

Hosted in the **public** `.github` repo → free Actions minutes (off the 2000-min private cap).

## One-time setup (needs an org admin)

1. **Create a token** with: `repo` (read issues on the 9 private repos) + `project` (read/write org
   projects). Classic PAT is simplest; a fine-grained PAT or GitHub App also works (Issues: read,
   Projects: read+write, on the org + all product repos).
2. **Store it as an _organization_ Actions secret** named **`ORRERY_PAT`**, visibility = all repos
   (or selected: this repo + the 8 product repos). One secret serves both the rollup and every
   notify hook.
3. **Deploy the notify hook** to the product repos:
   ```bash
   bash scripts/deploy-orrery-notify.sh
   ```
4. **Smoke test:** Actions → *Orrery rollup* → *Run workflow*, then check board #13 fields fill in.

## Files

- `.github/workflows/orrery-rollup.yml` — central rollup (dispatch + cron + manual).
- `scripts/orrery-rollup.mjs` — the rollup (Node 20, no deps; resolves field IDs by name).
- `scripts/orrery-config.json` — project → repo/board map. **Edit here** when a project is added.
- `workflow-templates/orrery-notify.yml` — per-repo hook template.
- `scripts/deploy-orrery-notify.sh` — pushes the hook into every product repo.

## Adding a project later

1. Add the anchor item to board #13, set its **Project** single-select.
2. Add a `"<Project>": { "repo": "...", "board": <n|null> }` line to `orrery-config.json`.
3. Deploy the notify hook to that repo (or rerun the deploy script).
