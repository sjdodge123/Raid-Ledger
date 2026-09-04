#!/usr/bin/env bash
# Guard: the "one claim per worktree" constraint stays documented AT THE POINT
# OF USE, and /srv/rl-infra/.env keeps its 640 rl-fleet perms across a deploy.
#
# Why a guard test for prose:
#   rl_claim is idempotent on RL_AGENT_ID = $USER + sha1(worktree path), so a
#   second claim from the same tree — INCLUDING `slot=N` naming a different
#   slot — silently returns the slot already held. That behaviour is correct
#   (see the blast-radius note in rl-infra/README.md) but undiscoverable, and
#   agents rediscover it by confusion once per cycle. The mitigation shipped
#   was documentation, so documentation is what this asserts.
#
# Comment-stripping: the claim.ts checks run against a comment-stripped copy of
# the file, so an explanatory `//` comment (like the ones above TOOL_DESCRIPTION)
# can never satisfy an assertion that is meant to hold on the SHIPPED tool
# description string an agent actually reads.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLAIM_TS="$REPO_ROOT/tools/mcp-rl-fleet/src/tools/claim.ts"
README="$REPO_ROOT/rl-infra/README.md"
DEPLOY_SH="$REPO_ROOT/rl-infra/deploy.sh"
SETUP_MD="$REPO_ROOT/rl-infra/SETUP.md"

PASS=0
FAIL=0

ok()   { echo "PASS: $1"; PASS=$((PASS + 1)); }
bad()  { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

assert_contains() {
    local label="$1" needle="$2" haystack="$3"
    if grep -qF -- "$needle" <<<"$haystack"; then ok "$label"; else bad "$label (missing: $needle)"; fi
}

# Strip line comments and block-comment bodies so prose in a `//` or ` * `
# comment cannot satisfy an assertion about the shipped description string.
strip_comments() {
    sed -e 's|//.*$||' -e 's|^[[:space:]]*\*.*$||' -e 's|^[[:space:]]*/\*.*$||' "$1"
}

[[ -f "$CLAIM_TS" ]] || { echo "FAIL: missing $CLAIM_TS"; exit 1; }
CLAIM_SRC="$(strip_comments "$CLAIM_TS")"

assert_contains "claim.ts tool description names the one-slot-per-worktree constraint" \
    "ONE SLOT PER WORKTREE" "$CLAIM_SRC"
assert_contains "claim.ts tool description explains agent identity is the worktree path" \
    "sha1(worktree path)" "$CLAIM_SRC"
assert_contains "claim.ts tool description warns slot=N does NOT move an existing claim" \
    "silently returns the slot you already hold" "$CLAIM_SRC"
assert_contains "claim.ts tool description states the second-worktree workaround" \
    "separate git worktree" "$CLAIM_SRC"

[[ -f "$README" ]] || { echo "FAIL: missing $README"; exit 1; }
README_SRC="$(cat "$README")"
assert_contains "README has the one-claim-per-worktree section" \
    "#### One claim per worktree" "$README_SRC"
assert_contains "README states the second-worktree workaround" \
    "separate git worktree" "$README_SRC"

[[ -f "$DEPLOY_SH" ]] || { echo "FAIL: missing $DEPLOY_SH"; exit 1; }
DEPLOY_SRC="$(strip_comments "$DEPLOY_SH")"
assert_contains "deploy.sh re-asserts rl-fleet group on /srv/rl-infra/.env" \
    "chgrp rl-fleet .env" "$DEPLOY_SRC"
assert_contains "deploy.sh re-asserts 640 on /srv/rl-infra/.env" \
    "chmod 640 .env" "$DEPLOY_SRC"

[[ -f "$SETUP_MD" ]] || { echo "FAIL: missing $SETUP_MD"; exit 1; }
assert_contains "SETUP.md documents the .env 640 rl-fleet perms" \
    "chmod 640 /srv/rl-infra/.env" "$(cat "$SETUP_MD")"

echo "==="
echo "rl-claim-one-slot-doc: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
