#!/usr/bin/env bash
# Scaffold the VM-side dirs every runner bind-mounts, with the ownership the
# Mutagen beta needs. (A3-B P3)
#
# WHY THIS EXISTS
# ---------------
# There was no extra-slots scaffold to fix — there was no scaffold at all.
# proxmox/cloud-init.yaml creates slot-1 and slot-2 only, and comments that
# "Slot 3+4 dirs are created on-demand if you enable the `extra-slots` compose
# profile later." On-demand means the Docker daemon mkdir'ing a missing
# bind-mount source itself, as root, mode 0755 (plus whatever setgid bit it
# inherits from the parent). The Mutagen beta connects as `rl-agent`, so it
# then fails EVERY entry with permission denied — 38 of 39 transition problems
# and an empty /workspace for 12 minutes, observed 2026-09-02. It was worked
# around by hand from inside the runners, which fixes one container and
# survives exactly until the next `docker compose up --force-recreate`.
#
# Slots 1-2 are 1001:1004 mode 2775 (rl-agent:rl-fleet, setgid + group-write):
# owned by rl-agent so the Mutagen beta can write, group rl-fleet + setgid so
# the operator (`rl`) keeps access and every file created underneath inherits
# the group. This script asserts that shape for all four slots.
#
# ALL FOUR SLOTS, UNCONDITIONALLY: it does not consult RUNNER_SLOTS. Empty dirs
# cost nothing, and gating on RUNNER_SLOTS would reproduce the exact failure the
# extra-slots profile already has — a second thing the operator must remember to
# bump, whose omission is silent (SETUP.md Phase 9.2 documents that trap for the
# Discord OAuth callbacks).
#
# Usage:
#   bash ensure-runner-dirs.sh [--root DIR] [--slots N]
#     --root   fleet root; default $RL_INFRA_ROOT, else /srv/rl-infra
#     --slots  highest slot to scaffold; default 4 (= the compose service count)
#
# Exit codes:
#   0   every target dir exists with the wanted owner, group and mode
#   2   usage error
#   96  RESERVED: at least one dir is wrong and could not be repaired (not
#       running as root, most likely). NAMES every offending path and prints
#       the exact command to fix it. Deliberately not 0: a dir left root-owned
#       is the original defect, and it announced itself only as a Mutagen
#       failure 12 minutes downstream.
#
# Invoke as `bash ensure-runner-dirs.sh`, never `./ensure-runner-dirs.sh`
# (A3-B P2 — Mutagen strips exec bits).

set -uo pipefail

readonly RUNNER_DIRS_FATAL=96
readonly LOG_PREFIX="rl-runner-dirs:"

# Resolved by NAME, not by uid, so a VM rebuild that renumbers cannot silently
# scaffold the wrong owner. 1001:1004 on the current VM.
WANT_OWNER="${RL_RUNNER_OWNER:-rl-agent}"
WANT_GROUP="${RL_RUNNER_GROUP:-rl-fleet}"
WANT_MODE="2775"

ROOT="${RL_INFRA_ROOT:-/srv/rl-infra}"
MAX_SLOT=4

while (( $# > 0 )); do
    case "$1" in
        --root)  ROOT="${2:-}"; shift 2 || exit 2 ;;
        --slots) MAX_SLOT="${2:-}"; shift 2 || exit 2 ;;
        -h|--help)
            echo "usage: bash ensure-runner-dirs.sh [--root DIR] [--slots N]" >&2
            exit 2 ;;
        *)
            echo "$LOG_PREFIX unknown argument: $1" >&2
            echo "usage: bash ensure-runner-dirs.sh [--root DIR] [--slots N]" >&2
            exit 2 ;;
    esac
done

if [[ -z "$ROOT" ]] || ! [[ "$MAX_SLOT" =~ ^[1-9][0-9]*$ ]]; then
    echo "$LOG_PREFIX --root must be non-empty and --slots a positive integer" >&2
    exit 2
fi

FAILURES=()

# Portable 4-digit octal mode read. BSD stat (macOS laptop) prints the FULL
# mode via %p ("42775") and %Lp deliberately omits the setuid/setgid/sticky
# bits ("775") — which is exactly the bit this script exists to assert, so %Lp
# is unusable here. GNU stat's %a gives "2775" but drops the leading zero on
# "755". Normalizing to the last four characters of a zero-padded string covers
# both without any shell octal-parsing (bash and zsh disagree on leading zeros).
mode_of() {
    local m
    m=$(stat -f '%p' "$1" 2>/dev/null) || m=$(stat -c '%a' "$1" 2>/dev/null) || return 1
    m="0000$m"
    printf '%s\n' "${m:${#m}-4}"
}
# owner:group as NAMES, so the comparison matches WANT_OWNER/WANT_GROUP.
owner_of() { stat -f '%Su:%Sg' "$1" 2>/dev/null || stat -c '%U:%G' "$1" 2>/dev/null; }

# Bring one dir to owner/group/mode. Verify-then-repair, so a correct dir needs
# no privilege at all and the script stays green when deploy.sh runs it as the
# unprivileged operator user.
ensure_dir() {
    local dir="$1" want="${WANT_OWNER}:${WANT_GROUP}"

    if ! mkdir -p "$dir" 2>/dev/null; then
        FAILURES+=("$dir — could not create (parent not writable?)")
        return
    fi

    if [[ "$(mode_of "$dir")" != "$WANT_MODE" ]]; then
        chmod "$WANT_MODE" "$dir" 2>/dev/null || true
        if [[ "$(mode_of "$dir")" != "$WANT_MODE" ]]; then
            FAILURES+=("$dir — mode is $(mode_of "$dir"), wanted $WANT_MODE (setgid + group-write)")
        fi
    fi

    if [[ "$(owner_of "$dir")" != "$want" ]]; then
        # Trust chown's exit code rather than re-reading the owner: chown(2)
        # either applies or errors, and re-reading would make the success path
        # untestable with a PATH stub (the only way these assertions can run
        # deterministically both unprivileged on macOS and as root on the VM).
        if ! chown "$want" "$dir" 2>/dev/null; then
            FAILURES+=("$dir — owned by $(owner_of "$dir"), wanted $want; chown failed (run as root)")
        fi
    fi
}

# The /workspace bind source for each runner service in docker-compose.yml.
for slot in $(seq 1 "$MAX_SLOT"); do
    ensure_dir "$ROOT/runners/slot-$slot"
    ensure_dir "$ROOT/runners/slot-$slot/worktree"
done

# The host side of the fleet-wide /state-locks bind mount. Without this, the
# first runner to start recreates it root-owned and the operator cannot inspect
# discord.lock without sudo — the same class of defect one level down.
ensure_dir "$ROOT/state"
ensure_dir "$ROOT/state/locks"

if (( ${#FAILURES[@]} > 0 )); then
    echo "$LOG_PREFIX FATAL — ${#FAILURES[@]} runner dir(s) are not provisioned as ${WANT_OWNER}:${WANT_GROUP} $WANT_MODE:" >&2
    for f in "${FAILURES[@]}"; do
        echo "$LOG_PREFIX   $f" >&2
    done
    echo "$LOG_PREFIX A dir the Mutagen beta cannot write makes every sync entry fail with permission denied and leaves /workspace empty — with no error naming this cause. Repair as root:" >&2
    echo "$LOG_PREFIX   sudo bash rl-infra/runner/ensure-runner-dirs.sh --root $ROOT" >&2
    exit "$RUNNER_DIRS_FATAL"
fi

echo "$LOG_PREFIX ok — slots 1-$MAX_SLOT + state/locks under $ROOT are ${WANT_OWNER}:${WANT_GROUP} $WANT_MODE."
exit 0
