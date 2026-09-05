#!/usr/bin/env bash
# Named verdict on the fleet-wide /state-locks mount. (A3-B P3)
#
# WHY THIS EXISTS
# ---------------
# The Discord-smoke serialization in scripts/validate-ci.sh::run_discord_smoke
# guards its flock with:
#
#     if [[ -d "$lock_dir" ]] && _discord_lock_required; then
#
# That guard is correct on the operator's laptop — a single host has no
# cross-slot contention, so "no lock dir ⇒ run unsynchronized" is the intended
# behaviour there. Inside a fleet runner it is a trapdoor: runners 3-4 shipped
# WITHOUT the /state-locks bind mount (fixed alongside this file in
# docker-compose.yml), so the branch was skipped, smoke ran unsynchronized
# against a shared Discord token, and the run exited 0. Nothing timed out and
# nothing said LOCK_TIMEOUT — the failure mode was silence, which is worse.
#
# The distinguishing fact is RL_SLOT: the compose runner services set it, and
# nothing else does. So "we are somewhere the mount is mandatory" is decidable,
# and this script decides it by name in milliseconds instead of leaving it to
# be inferred from a stalled clock.
#
# Usage:
#   bash check-state-locks.sh [DIR]
#     DIR defaults to $RL_STATE_LOCKS_DIR, else /state-locks.
#
# Exit codes:
#   0   the mount is present and writable, OR we are not inside a fleet runner
#       (RL_SLOT unset) where running unsynchronized is correct by design
#   2   usage error
#   98  RESERVED: inside a fleet runner and the mount is absent or unwritable.
#       Deliberately NOT 1, NOT 75 (validate-ci's lock-timeout code) and NOT
#       124 — the point is that "the mount is missing" is tellable apart, in a
#       log, from "another slot is hogging the lock".
#
# Invoke as `bash check-state-locks.sh`, never `./check-state-locks.sh`: this
# file is synced through Mutagen's permission-stripping path (A3-B P2) so it
# cannot rely on its own exec bit.

set -uo pipefail

readonly STATE_LOCKS_FATAL=98
readonly LOG_PREFIX="rl-state-locks:"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    echo "usage: bash check-state-locks.sh [DIR]" >&2
    exit 2
fi
if (( $# > 1 )); then
    echo "usage: bash check-state-locks.sh [DIR]" >&2
    exit 2
fi

LOCK_DIR="${1:-${RL_STATE_LOCKS_DIR:-/state-locks}}"
SLOT="${RL_SLOT:-}"

# Not a fleet runner. Say so out loud anyway: "we ran unsynchronized" must be a
# statement in the log, never something inferred from the absence of one.
if [[ -z "$SLOT" ]]; then
    echo "$LOG_PREFIX RL_SLOT unset — not a fleet runner; $LOCK_DIR is absent by design and Discord smoke runs unsynchronized (single host, no cross-slot contention)."
    exit 0
fi

fatal() {
    echo "$LOG_PREFIX FATAL slot $SLOT: $1" >&2
    echo "$LOG_PREFIX   fix: add '- /srv/rl-infra/state/locks:/state-locks:rw' to the runner-${SLOT} service in rl-infra/docker-compose.yml, then 'docker compose --profile extra-slots up -d --force-recreate runner-${SLOT}'." >&2
    echo "$LOG_PREFIX   host side is scaffolded by 'bash rl-infra/runner/ensure-runner-dirs.sh' (run by rl-infra/deploy.sh)." >&2
    exit "$STATE_LOCKS_FATAL"
}

if [[ ! -d "$LOCK_DIR" ]]; then
    fatal "$LOCK_DIR is not mounted. Discord smoke on this runner would run UNSYNCHRONIZED against a shared bot token instead of serializing on $LOCK_DIR/discord.lock — and would report success."
fi

if [[ ! -w "$LOCK_DIR" ]]; then
    fatal "$LOCK_DIR is mounted but not writable by $(id -un 2>/dev/null || echo "uid $(id -u)"). flock cannot create the lock file, so smoke would run UNSYNCHRONIZED."
fi

echo "$LOG_PREFIX ok slot $SLOT: $LOCK_DIR mounted and writable."
exit 0
