#!/usr/bin/env bash
# ROK-1566 — the pre-push smoke gate, as a script the hook calls.
#
# Prints the PreToolUse JSON verdict for `git push`. Run from the branch's
# worktree (the hook cds there first). Allows when the branch changes nothing
# Playwright exercises, or when a sentinel for THIS web surface was written by
# a fleet/local Playwright PASS in the last 24h; denies otherwise.
#
# Keying on the surface rather than HEAD is the whole point: a docs-only or
# test-only follow-up commit, and GitHub's identical-tree "merge main" rewrite,
# both used to throw away a green gate (2026-09-14, 55 minutes + a force push).
set -uo pipefail

allow() { echo '{"continue":true}'; exit 0; }

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
H=$("$HERE/surface-hash.sh" 2>/dev/null)
# An unresolvable surface (not a git checkout, no origin/main) reads as
# "nothing to verify", matching the old hook's behaviour when git failed.
[ -z "$H" ] && H="nosurface"
[ "$H" = "nosurface" ] && allow

SENTINEL="${RL_PLAYWRIGHT_SENTINEL_DIR:-/tmp}/.playwright-verified-$H"
# 24h age guard: a sentinel older than that predates too much drift in the
# things the surface hash does NOT cover (deps, fixtures, the env itself).
[ -f "$SENTINEL" ] && [ -n "$(find "$SENTINEL" -mmin -1440 2>/dev/null)" ] && allow

REASON="Smoke tests not verified for web surface $H (checked in $(pwd)). Run Playwright on the fleet (rl_validate_ci --only-e2e / --full - the MCP server writes the sentinel on a PASS), or locally via /push."
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$REASON"
