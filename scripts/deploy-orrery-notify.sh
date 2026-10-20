#!/usr/bin/env bash
# Copyright (C) 2026 HyperQuant Media L.L.P. All rights reserved. Licensed under GNU GPL v3.0.
# Deploy the Orrery notify workflow into every product repo via the GitHub
# contents API (no clone needed). Idempotent: updates the file if it changed.
# Requires: gh authenticated as a user with write on each repo.
#   bash scripts/deploy-orrery-notify.sh            # all repos
#   bash scripts/deploy-orrery-notify.sh Polaris    # only repos matching the filter
#
# The hook lands on each repo's DEFAULT branch on purpose: GitHub resolves
# `issues` and `pull_request` event workflows from the default branch only, so a
# copy on a work branch would never fire.
#
# That commit must satisfy the repo's own HQM validator (.githooks/validate-commit-msg.sh,
# re-run in CI by commit-lint.yml): [PRODUCT] first, a #ticket, [CODE|CONTENT], at
# least three bracket groups, and a [cib:] line.
#
# [PRODUCT] differs per repo and is case-sensitive (POLARIS, VoN, NibbleBloom...),
# so rather than carry a table that silently rots when a repo renames its token,
# each repo's PRODUCT_TOKEN is read from its own validator at deploy time. A repo
# whose token cannot be read is SKIPPED, never pushed to with a guessed value --
# a wrong token means a red commit-lint run on that repo's default branch.
set -euo pipefail

REPOS=(
  HyperQuantMedia/HQM-Polaris
  HyperQuantMedia/HQM-Astra
  HyperQuantMedia/HQM-DocuTale
  HyperQuantMedia/HQM-Quartermaster
  HyperQuantMedia/HQM-Warpgate
  HyperQuantMedia/Veins-of-Nexus
  HyperQuantMedia/NibbleBloom
  HyperQuantMedia/Nova-Engine
)
# Caveman (JuliusBrussee/caveman) is upstream and not maintained by HQM - deliberately not deployed to.

SRC="$(dirname "$0")/../workflow-templates/orrery-notify.yml"
DEST=".github/workflows/orrery-notify.yml"
VALIDATOR=".githooks/validate-commit-msg.sh"
CONTENT="$(base64 -w0 "$SRC" 2>/dev/null || base64 "$SRC" | tr -d '\n')"

# Read PRODUCT_TOKEN from the repo's own validator. Default branch first, then
# every other branch: some repos (Veins-of-Nexus) keep .githooks and CI on a work
# branch while main carries only docs, so a default-branch-only lookup would skip
# a repo that does have a token.
product_token() {
  repo="$1"
  for br in "" $(gh api "repos/$repo/branches" --jq '.[].name' 2>/dev/null); do
    if [ -z "$br" ]; then ref=""; else ref="?ref=$br"; fi
    out="$(gh api "repos/$repo/contents/$VALIDATOR$ref" -H "Accept: application/vnd.github.raw" 2>/dev/null \
           | sed -n 's/^PRODUCT_TOKEN="\([^"]*\)".*/\1/p' | head -1)"
    if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
  done
  return 1
}

FILTER="${1:-}"
fail=0
for repo in "${REPOS[@]}"; do
  [ -n "$FILTER" ] && case "$repo" in *"$FILTER"*) ;; *) continue ;; esac
  echo "== $repo =="
  product="$(product_token "$repo" || true)"
  if [ -z "$product" ]; then
    echo "  SKIPPED: no PRODUCT_TOKEN in $VALIDATOR on any branch (repo missing, renamed, or no validator)"
    fail=1
    continue
  fi
  echo "  product token: $product"
  msg="[${product}][ #0 ][CODE][DEVOPS][CI] add the Orrery notify hook

Fires a repository_dispatch (orrery-sync) at HyperQuantMedia/.github whenever an
issue or pull request closes, so the Orrery board health refreshes immediately
instead of waiting for the nightly 06:17 UTC cron.

[cib: none]"
  sha="$(gh api "repos/$repo/contents/$DEST" --jq .sha 2>/dev/null || true)"
  args=(-X PUT "repos/$repo/contents/$DEST"
        -f message="$msg"
        -f content="$CONTENT")
  [ -n "$sha" ] && args+=(-f sha="$sha")
  if gh api "${args[@]}" --jq '.commit.html_url'; then echo "  ok"; else echo "  FAILED"; fail=1; fi
done
echo "Done. Ensure org secret HQM_OrreryRollup_NightlyCronJob is visible to these repos."
exit "$fail"
