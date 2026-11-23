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
# `matched` names WHICH key satisfied the gate: surface (the ROK-1566 key) or
# nosurface (nothing to verify). TDB:1416 retired the legacy `sha` fallback.
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

# ROK-2205: the sentinel must record gate_verified: true. A run reporting all
# PASS while the runner was synced to an old commit (2026-11-15) wrote one
# anyway; the MCP server now refuses to, and this check fails closed on every
# sentinel written before the field existed (empty body, `{}`, or false).
# Review m4: only a LEADING top-level key counts (the writer always puts it
# first), so a nested or later `true` behind a false never unlocks the push.
verified() {
  head -n1 "$1" 2>/dev/null |
    grep -Eq '^\{[[:space:]]*"gate_verified"[[:space:]]*:[[:space:]]*true[[:space:]]*[,}]'
}
has_key() { grep -q '"gate_verified"' "$1" 2>/dev/null; }

S="$DIR/.playwright-verified-$H"
if fresh "$S"; then
  verified "$S" && allow surface
  # Review M2: a body with no gate_verified key came from an rl-fleet MCP server
  # older than ROK-2205. That server rewrites the same refused file on every
  # re-run, so the fix is a restart, not another gate.
  has_key "$S" || deny "The sentinel for web surface $H ($S) does not record gate_verified: true (ROK-2205). It was written by an rl-fleet MCP server older than ROK-2205 (or by a bare touch). That server runs from the checkout your Claude session started in (usually the main checkout): pull main there and restart the Claude session, THEN re-run the gate (rl_validate_ci) and read the terminal result with rl_task_status log_tail_bytes:3000. Re-running without the restart writes the same refused file. A local /push PASS writes {\"gate_verified\":true} instead."
  deny "The sentinel for web surface $H ($S) does not record gate_verified: true (ROK-2205) - the run was not verified (e.g. a stale runner sync). Run rl_force_resync, re-run the gate (rl_validate_ci) and read the terminal result with rl_task_status log_tail_bytes:3000 on a run that reports gate_verified: true. If every re-run is refused the same way, pull main in the checkout your Claude session started in and restart the Claude session first."
fi

deny "Smoke tests not verified for web surface $H (checked in $(pwd)). Run the gate on the fleet (rl_validate_ci --scoped / --static / --only-e2e - the MCP server writes the sentinel on a gate_verified PASS; read it with rl_task_status log_tail_bytes:3000), or locally via /push, which after a local PASS writes "'{"gate_verified":true}'" to "'/tmp/.playwright-verified-$(bash scripts/smoke/surface-hash.sh)'"."
