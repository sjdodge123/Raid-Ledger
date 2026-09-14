#!/usr/bin/env bash
# ROK-1566 — the ONE definition of "the web surface Playwright verifies".
#
# The pre-push sentinel used to be keyed to HEAD, so a docs-only follow-up
# commit (or GitHub's identical-tree "merge main" rewrite) invalidated a green
# gate. Key it to the diff of the files that can change what Playwright
# exercises instead. The path list below is the SINGLE source of truth and
# mirrors validate-ci.sh's Playwright trigger set.
#
# Output: a 12-hex hash, or the literal `nosurface` when the diff is genuinely
# empty. Exits NON-ZERO when the surface cannot be determined (no git, no base,
# failed diff) — callers MUST fail closed on that, never read it as `nosurface`.
#
# Two known limits, both in the safe direction:
#   * base drift — `origin/main` is a LOCAL ref read at call time, so a fetch or
#     rebase between the verifying run and the push moves the merge-base and
#     invalidates an otherwise valid sentinel (re-run the gate).
#   * uncommitted/untracked web edits are NOT in the hash, but ARE what Mutagen
#     syncs to the runner; committing them changes the hash, so the gate
#     re-triggers rather than passing stale work.
set -uo pipefail

BASE="${SURFACE_BASE:-origin/main}"

command -v git >/dev/null 2>&1 || {
  echo "surface-hash: git is not on PATH" >&2
  exit 2
}
git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null 2>&1 || {
  echo "surface-hash: base '${BASE}' does not resolve" >&2
  exit 3
}

# --binary keeps image/font/fixture CONTENT in the patch (without it a binary
# change is just "Binary files ... differ" and hashes identically after the
# index line is stripped). --no-ext-diff/--no-textconv/--no-color keep user
# diff config out of the hash.
DIFF=$(git diff --no-ext-diff --no-textconv --no-color --binary "${BASE}"...HEAD -- \
  web/ scripts/smoke/ 'playwright.config.*' packages/contract/src/ \
  api/src/auth/ 'api/src/admin/demo-test*') || {
  echo "surface-hash: git diff against '${BASE}' failed" >&2
  exit 4
}

[ -z "$DIFF" ] && {
  echo "nosurface"
  exit 0
}

# Strip only real `index <blob>..<blob>` headers so two commits with identical
# content hash alike even when their blob ids differ.
printf '%s\n' "$DIFF" |
  grep -v '^index [0-9a-f]\{4,\}\.\.[0-9a-f]\{4,\}' |
  git hash-object --stdin | cut -c1-12
