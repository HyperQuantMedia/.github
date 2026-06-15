#!/usr/bin/env bash
# Copyright (C) 2026 HyperQuant Media L.L.P. All rights reserved. Licensed under GNU GPL v3.0.
# Deploy the Orrery notify workflow into every product repo via the GitHub
# contents API (no clone needed). Idempotent: updates the file if it changed.
# Requires: gh authenticated as a user with write on each repo.
#   bash scripts/deploy-orrery-notify.sh
set -euo pipefail

REPOS=(
  HyperQuantMedia/HQM-Polaris
  HyperQuantMedia/ClaudeCairn
  HyperQuantMedia/ClaudeDocuTale
  HyperQuantMedia/HQM-Quartermaster
  HyperQuantMedia/HQM-Warpgate
  HyperQuantMedia/Veins-of-Nexus
  HyperQuantMedia/NibbleBloom
  HyperQuantMedia/Kingshot-Island-Architect
)
# Caveman lives at JuliusBrussee/caveman (external) — add it only if you have write there.

SRC="$(dirname "$0")/../workflow-templates/orrery-notify.yml"
DEST=".github/workflows/orrery-notify.yml"
CONTENT="$(base64 -w0 "$SRC" 2>/dev/null || base64 "$SRC" | tr -d '\n')"

for repo in "${REPOS[@]}"; do
  echo "== $repo =="
  sha="$(gh api "repos/$repo/contents/$DEST" --jq .sha 2>/dev/null || true)"
  args=(-X PUT "repos/$repo/contents/$DEST"
        -f message="ci: add Orrery notify hook"
        -f content="$CONTENT")
  [ -n "$sha" ] && args+=(-f sha="$sha")
  gh api "${args[@]}" --jq '.commit.html_url' && echo "  ok" || echo "  FAILED"
done
echo "Done. Ensure org secret ORRERY_PAT is visible to these repos."
