#!/usr/bin/env bash
# Decide whether a checkout's root node_modules needs `npm ci`, and run it.
#
# Usage: bash scripts/ci/ensure-runner-deps.sh [ROOT]
#   exit 0  dependencies were already fine, or `npm ci` succeeded
#   exit 1  `npm ci` failed; the tail of its log is already on stderr
#
# Shared by scripts/validate-ci.sh and rl-infra/cli/rl install_runner_deps so
# the two installs take ONE lock and read ONE marker, and can never run
# `npm ci` in the same tree at the same time.
#
# Laptop / GitHub CI: install only when node_modules/.bin/tsc is missing. No
# lock, no marker.
#
# Fleet runner (ROOT is /workspace): node_modules is Mutagen-excluded and
# survives between claims, so a missing tsc is not the only way to be stale. A
# branch that changes package-lock.json would otherwise build against the old
# tree ("Rolldown failed to resolve import", TS2307 on a new plugin). So the
# runner also re-installs whenever the lockfile's sha256 differs from the
# marker written after the last successful install.
#
# RL_WORKSPACE_ROOT and RL_NPM_CI_LOCK are test seams; production uses the
# real /workspace and a lock in container /tmp (never under /workspace: the
# one-way-replica sync deletes files the runner creates there).

set -uo pipefail

PREFIX="[ensure-runner-deps]"
ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  echo "$PREFIX ERROR: no checkout root (got '${ROOT}')" >&2
  exit 1
fi
MARKER="$ROOT/node_modules/.rl-lockfile-sha256"
HIDDEN_LOCKFILE="$ROOT/node_modules/.package-lock.json"

say() { echo "$PREFIX $*"; }
warn() { echo "$PREFIX WARN: $*" >&2; }

is_runner() { [ "$ROOT" = "${RL_WORKSPACE_ROOT:-/workspace}" ]; }

lockfile_sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$ROOT/package-lock.json" 2>/dev/null | awk '{print $1}'
  else
    shasum -a 256 "$ROOT/package-lock.json" 2>/dev/null | awk '{print $1}'
  fi
}

# Serialise installs on this runner. Never fatal: without flock (macOS), an
# unopenable lock file or a 15-minute wait we warn and carry on unlocked.
take_lock() {
  local lock="${RL_NPM_CI_LOCK:-/tmp/rl-npm-ci.lock}"
  if ! command -v flock >/dev/null 2>&1; then
    warn "flock not found; installing without the shared lock"
    return 0
  fi
  if ! { exec 9>>"$lock"; } 2>/dev/null; then
    warn "cannot open lock $lock; installing without the shared lock"
    return 0
  fi
  flock -w 900 9 || warn "timed out waiting for $lock; continuing unlocked"
}

# Echo why an install is needed; echo nothing when it is not.
install_reason() {
  if [ ! -x "$ROOT/node_modules/.bin/tsc" ]; then echo "missing tsc"; return; fi
  is_runner || return 0
  local have want
  have=$(cat "$MARKER" 2>/dev/null || true)
  want=$(lockfile_sha)
  if [ -z "$have" ]; then echo "no marker"
  elif [ "$have" != "$want" ]; then
    echo "package-lock.json changed (marker $have, lockfile ${want:-unreadable})"
  fi
}

# Runner only: stamp the marker, but ONLY if npm really rewrote its hidden
# lockfile during this run. A stubbed npm that exits 0 without installing must
# never mark a stale tree as fresh.
write_marker() {
  local stamp="$1" want
  if [ -z "$(find "$HIDDEN_LOCKFILE" -newer "$stamp" 2>/dev/null)" ]; then
    warn "npm ci exited 0 but did not refresh node_modules/.package-lock.json; marker not written"
    return 0
  fi
  want=$(lockfile_sha)
  [ -n "$want" ] || { warn "cannot hash package-lock.json; marker not written"; return 0; }
  printf '%s\n' "$want" >"$MARKER"
}

run_npm_ci() {
  local stamp log rc
  # The stamp predates the install, so `find -newer` below can tell whether
  # npm rewrote its hidden lockfile during THIS run.
  if ! stamp=$(mktemp) || ! log=$(mktemp); then
    echo "$PREFIX ERROR: mktemp failed" >&2
    return 1
  fi
  # 9>&-: npm and anything it spawns must not inherit (and so outlive) the lock.
  (cd "$ROOT" && npm ci --silent --no-audit --no-fund) >"$log" 2>&1 9>&-
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "$PREFIX ERROR: npm ci failed (exit $rc); last 20 lines:" >&2
    tail -20 "$log" >&2
    rm -f "$stamp" "$log"
    return 1
  fi
  tail -5 "$log"
  if is_runner; then write_marker "$stamp"; fi
  rm -f "$stamp" "$log"
  return 0
}

if is_runner; then take_lock; fi
reason=$(install_reason)
[ -n "$reason" ] || exit 0
say "running npm ci in $ROOT: $reason"
run_npm_ci || exit 1
say "npm ci done"
exit 0
