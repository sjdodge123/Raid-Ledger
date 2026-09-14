#!/usr/bin/env bash
# ROK-1566 — the pre-push smoke gate, as a script the hook calls.
#
# Prints the PreToolUse JSON verdict for `git push`. Run from the branch's
# worktree (the hook cds there first). Allows when the branch changes nothing
# Playwright exercises, or when a sentinel for THIS web surface was written by
# a fleet/local Playwright PASS in the last 24h. Everything else DENIES —
# including every way of failing to compute the surface, because a gate that
# fails open is not a gate.
set -uo pipefail

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
# `matched` names WHICH key satisfied the gate: surface (the ROK-1566 key),
# sha (the legacy one-cycle fallback), or nosurface (nothing to verify).
allow() {
  printf '{"continue":true,"matched":"%s"}\n' "$1"
  exit 0
}
deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$(esc "$1")"
  exit 0
}

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# `bash <script>` (not the script directly): a lost exec bit must not decide a
# push. `env -u SURFACE_BASE` keeps a stray value in the hook's environment
# from silently re-pointing the gate at another base.
H=$(env -u SURFACE_BASE bash "$HERE/surface-hash.sh" 2>/dev/null) || H=""
[ -n "$H" ] || deny "Pre-push gate could not compute the web-surface hash in $(pwd) — git is missing, origin/main does not resolve, or the diff failed. Fetch origin/main (or fix the checkout) and retry; the gate denies rather than guessing."
[ "$H" = "nosurface" ] && allow nosurface

DIR="${RL_PLAYWRIGHT_SENTINEL_DIR:-/tmp}"
# 24h age guard: a sentinel older than that predates too much drift in the
# things the surface hash does NOT cover (deps, fixtures, the env itself).
fresh() { [ -f "$1" ] && [ -n "$(find "$1" -mmin -1440 2>/dev/null)" ]; }

fresh "$DIR/.playwright-verified-$H" && allow surface
# One-cycle legacy fallback, paired with the writer's dual write: a PASS earned
# under the sha-keyed hook (or by the old local `touch`) still counts, so
# in-flight branches are not blocked. Remove both together — see
# TECH-DEBT-BACKLOG.md (ROK-1566).
SHA=$(git rev-parse --short HEAD 2>/dev/null || true)
[ -n "$SHA" ] && fresh "$DIR/.playwright-verified-$SHA" && allow sha

deny "Smoke tests not verified for web surface $H (checked in $(pwd)). Run Playwright on the fleet (rl_validate_ci --only-e2e / --full - the MCP server writes the sentinel on a PASS), or locally via /push, which after a local PASS touches "'/tmp/.playwright-verified-$(bash scripts/smoke/surface-hash.sh)'" (the body may be empty)."
