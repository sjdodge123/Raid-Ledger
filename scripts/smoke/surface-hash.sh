#!/usr/bin/env bash
# ROK-1566 — the ONE definition of "the web surface Playwright verifies".
#
# The pre-push sentinel used to be keyed to HEAD, so a docs-only follow-up
# commit (or GitHub's auto "merge main" rewrite, which produces an identical
# tree) invalidated a green gate. Key it to the diff of the files that can
# change what Playwright exercises instead.
#
# `index <blob>..<blob>` lines are stripped so two commits with identical
# content hash alike even when their blob ids differ.
#
# Prints `nosurface` when no surface file changed vs the base.
set -uo pipefail

BASE="${SURFACE_BASE:-origin/main}"
DIFF=$(git diff "$BASE"...HEAD -- web/ scripts/smoke/ playwright.config.* packages/contract/src/ 2>/dev/null |
  grep -v '^index [0-9a-f]*\.\.[0-9a-f]*')

if [ -z "$DIFF" ]; then
  echo "nosurface"
  exit 0
fi

printf '%s\n' "$DIFF" | git hash-object --stdin | cut -c1-12
