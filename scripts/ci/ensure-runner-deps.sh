#!/usr/bin/env bash
# Decide whether a checkout's root node_modules (or a standalone package's,
# with SUBDIR) needs `npm ci`, and run it.
#
# Usage: bash scripts/ci/ensure-runner-deps.sh [ROOT [SUBDIR]]
#   SUBDIR  optional, relative to ROOT, no '..' (e.g. tools/test-bot, which is
#           not an npm workspace). Installs in ROOT/SUBDIR against
#           SUBDIR/package-lock.json, with its own marker under
#           SUBDIR/node_modules. Runner detection still keys on ROOT.
#   exit 0  dependencies were already fine, or `npm ci` succeeded
#   exit 1  `npm ci` failed (the tail of its log is already on stderr), or
#           ROOT/SUBDIR is invalid
#
# Shared by scripts/validate-ci.sh and rl-infra/cli/rl install_runner_deps so
# the two installs take ONE lock and read ONE marker, and can never run
# `npm ci` in the same tree at the same time.
#
# Laptop / GitHub CI: install only when node_modules/.bin/tsc is missing (with
# SUBDIR: when SUBDIR/node_modules is missing). No lock, no marker.
#
# Fleet runner (ROOT is /workspace): node_modules is Mutagen-excluded and
# survives between claims, so a missing tsc is not the only way to be stale. A
# branch that changes package-lock.json would otherwise build against the old
# tree ("Rolldown failed to resolve import", TS2307 on a new plugin). So the
# runner also re-installs whenever the lockfile's sha256 differs from the
# marker written after the last successful install. A SUBDIR is ready only
# when its node_modules/.package-lock.json exists AND its marker matches. The
# marker records the lockfile sha taken under the lock BEFORE npm starts, so a
# lockfile that changes mid-install leaves the old sha behind and the next run
# re-installs.
#
# RL_DEPS_RUNNER_ROOT and RL_NPM_CI_LOCK are test seams; production uses the
# real /workspace and a lock in container /tmp (never under /workspace: the
# one-way-replica sync deletes files the runner creates there). The runner
# seam is deliberately not RL_WORKSPACE_ROOT: validate-ci.sh's auth-dir seam
# reads that one, and setting it must not switch install mode.

set -uo pipefail

PREFIX="[ensure-runner-deps]"
ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  echo "$PREFIX ERROR: no checkout root (got '${ROOT}')" >&2
  exit 1
fi
# Capability token: rl-infra/cli/rl install_runner_deps greps for this literal
# to learn that this helper accepts SUBDIR. Keep it in code, not only a comment.
# shellcheck disable=SC2034
RL_DEPS_SUBROOT_V1="subdir-arg"
SUBDIR="${2:-}"
INSTALL_DIR="$ROOT"
if [ -n "$SUBDIR" ]; then
  case "$SUBDIR" in
    /*|..|../*|*/..|*/../*)
      echo "$PREFIX ERROR: SUBDIR must be relative to ROOT with no '..' (got '${SUBDIR}')" >&2
      exit 1 ;;
  esac
  if [ ! -d "$ROOT/$SUBDIR" ]; then
    echo "$PREFIX ERROR: no such directory ROOT/SUBDIR '$ROOT/$SUBDIR'" >&2
    exit 1
  fi
  INSTALL_DIR="$ROOT/$SUBDIR"
fi
MARKER="$INSTALL_DIR/node_modules/.rl-lockfile-sha256"
HIDDEN_LOCKFILE="$INSTALL_DIR/node_modules/.package-lock.json"

say() { echo "$PREFIX $*"; }
warn() { echo "$PREFIX WARN: $*" >&2; }

is_runner() { [ "$ROOT" = "${RL_DEPS_RUNNER_ROOT:-/workspace}" ]; }

lockfile_sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$INSTALL_DIR/package-lock.json" 2>/dev/null | awk '{print $1}'
  else
    shasum -a 256 "$INSTALL_DIR/package-lock.json" 2>/dev/null | awk '{print $1}'
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

# install_reason <lockfile sha>: echo why an install is needed; echo nothing
# when it is not.
install_reason() {
  local want="$1" have
  if [ -z "$SUBDIR" ] && [ ! -x "$ROOT/node_modules/.bin/tsc" ]; then echo "missing tsc"; return; fi
  if [ -n "$SUBDIR" ] && [ ! -d "$INSTALL_DIR/node_modules" ]; then echo "missing node_modules"; return; fi
  is_runner || return 0
  if [ -n "$SUBDIR" ] && [ ! -f "$HIDDEN_LOCKFILE" ]; then
    echo "no node_modules/.package-lock.json"; return
  fi
  have=$(cat "$MARKER" 2>/dev/null || true)
  if [ -z "$have" ]; then echo "no marker"
  elif [ "$have" != "$want" ]; then
    echo "package-lock.json changed (marker $have, lockfile ${want:-unreadable})"
  fi
}

# write_marker <stamp> <lockfile sha>: runner only. Stamp the marker with the
# sha hashed BEFORE npm started (never a re-hash: a lockfile synced in
# mid-install would be marked as installed), and ONLY if npm really rewrote
# its hidden lockfile during this run. A stubbed npm that exits 0 without
# installing must never mark a stale tree as fresh.
write_marker() {
  local stamp="$1" want="$2"
  if [ -z "$(find "$HIDDEN_LOCKFILE" -newer "$stamp" 2>/dev/null)" ]; then
    warn "npm ci exited 0 but did not refresh node_modules/.package-lock.json; marker not written"
    return 0
  fi
  [ -n "$want" ] || { warn "cannot hash package-lock.json; marker not written"; return 0; }
  printf '%s\n' "$want" >"$MARKER"
}

# run_npm_ci <lockfile sha>
run_npm_ci() {
  local want="$1" stamp log rc
  # The stamp predates the install, so `find -newer` below can tell whether
  # npm rewrote its hidden lockfile during THIS run.
  if ! stamp=$(mktemp) || ! log=$(mktemp); then
    echo "$PREFIX ERROR: mktemp failed" >&2
    return 1
  fi
  # 9>&-: npm and anything it spawns must not inherit (and so outlive) the lock.
  (cd "$INSTALL_DIR" && npm ci --silent --no-audit --no-fund) >"$log" 2>&1 9>&-
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "$PREFIX ERROR: npm ci failed (exit $rc); last 20 lines:" >&2
    tail -20 "$log" >&2
    rm -f "$stamp" "$log"
    return 1
  fi
  tail -5 "$log"
  if is_runner; then write_marker "$stamp" "$want"; fi
  rm -f "$stamp" "$log"
  return 0
}

want_sha=""
if is_runner; then
  take_lock
  # Hashed once, under the lock, before npm runs; see write_marker.
  want_sha=$(lockfile_sha)
fi
reason=$(install_reason "$want_sha")
[ -n "$reason" ] || exit 0
say "running npm ci in $INSTALL_DIR: $reason"
run_npm_ci "$want_sha" || exit 1
say "npm ci done"
exit 0
