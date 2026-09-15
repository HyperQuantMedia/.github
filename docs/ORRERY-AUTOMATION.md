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

1. **Create a fine-grained PAT** at *Settings → Developer settings → Personal access tokens →
   Fine-grained tokens*. Set **Resource owner = `HyperQuantMedia`** first — it cannot be changed
   afterwards, and a token owned by your personal account can reach neither the private repos nor
   board #13. Confirming you got it right: the permission tabs read *Repositories | Organization |
   Account*; only *Repositories | Account* means the owner is still personal.
   - Repository access: **All repositories**
   - Repository permissions: **Issues → Read-only** (Metadata read-only is added automatically)
   - Organization permissions: **Projects → Read and write** (read-only fails on the
     `updateProjectV2ItemFieldValue` mutations)
   - Set an expiration. When it lapses the rollup fails on an empty token — the same symptom as
     never having created it.

   The token is then approved by an org admin under *Org Settings → Third-party Access → Personal
   access tokens → Pending requests*.

   Note the one thing fine-grained does not cover explicitly: `JuliusBrussee/caveman` is outside the
   org, so no org-owned token can be scoped to it. It works because the repo is public and GitHub
   grants every token read access to public repositories. If Caveman ever goes private, its row
   needs a different credential.

   A classic PAT (`repo` + `project`) also works and needs no approval step, but `repo` means full
   write and delete on all 8 private repos for a job that only counts issues. A GitHub App is the
   durable option: no user coupling, no expiry.
2. **Store it as an _organization_ Actions secret** named **`HQM_OrreryRollup_NightlyCronJob`**,
   visibility = all repos (or selected: this repo + the product repos). One secret serves both the
   rollup and every notify hook. GitHub uppercases the stored name — `HQM_ORRERYROLLUP_NIGHTLYCRONJOB`
   is the same secret, and `${{ secrets.HQM_OrreryRollup_NightlyCronJob }}` still resolves, because
   secret lookup is case-insensitive. Underscores are mandatory: a hyphen would be parsed as
   subtraction inside `${{ }}`.
   ```bash
   gh auth refresh -h github.com -s admin:org
   gh secret set HQM_OrreryRollup_NightlyCronJob --org HyperQuantMedia --visibility all
   ```
3. **Deploy the notify hook** to the product repos:
   ```bash
   bash scripts/deploy-orrery-notify.sh            # all repos
   bash scripts/deploy-orrery-notify.sh Polaris    # one repo, to check the first commit passes lint
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
