#!/usr/bin/env bash
# Post-sync exec-bit restoration for a fleet runner's /workspace. (A3-B P2)
#
# WHY THIS EXISTS
# ---------------
# The fleet's Mutagen session is created by rl-infra/cli/rl::ensure_mutagen_sync
# with:
#     --permissions-mode=manual --default-file-mode-beta=0644
#
# `manual` is not a Mutagen limitation we suffer — it is a deliberate choice from
# Bug S Layer 1 (ROK-1326): `portable` mode propagated macOS xattr-driven perms
# to the runner as 0600 / 0700 and broke `docker COPY` in the allinone build.
# `manual` propagates NO source permission at all, executability included, so
# every file in the synced worktree lands on the runner at exactly 0644.
#
# The consequence is that `./scripts/foo.sh` inside a runner exits 126 — which a
# calling suite reports as a test failure with no assertion output, indis-
# tinguishable from a real regression. Two fleet runs were lost to it on
# 2026-09-03. The mitigation until now was folklore passed between agents
# ("copy the tree out of the Mutagen path, then chmod -R a+x rl-infra AND
# repo-root scripts, and don't forget cli/rl") — one agent lost a run to each
# half of that instruction.
#
# This script is the single repair. It has TWO callers, and both are needed:
#   * rl-infra/cli/rl::flush_mutagen — after every explicit sync flush, so a
#     degraded tree is diagnosed BEFORE a 15-minute gate is dispatched onto it.
#   * orchestrator/bin/_exec_bits.sh — immediately before run-on-runner{,-with-
#     heartbeat} dispatches anything. The flush-time call alone is not enough:
#     the Mutagen session is CONTINUOUS, so any laptop write landing after that
#     flush re-creates the file at 0644 and silently re-drops the bit. That is
#     not hypothetical — a `git rebase` re-synced orchestrator/bin/task-cancel
#     at 00:13 on 2026-09-03, after the gate's restore had passed, and the spec
#     that execs it reported 10/17 on the runner against 17/0 on the laptop.
#     Only a repair at the moment of EXECUTION closes that window.
#
# WHY NOT THE RUNNER ENTRYPOINT: the entrypoint runs once, at container start,
# against a worktree that is stale or empty and has not been synced yet. Any
# later Mutagen write re-creates the file at 0644 and re-drops the bit, so bits
# restored at container start do not survive to the run that needs them. Post-
# flush is the only moment where "the tree is current AND is about to be used"
# both hold. It also survives container recreation for free: the repair is
# host-side control flow re-run on every claim/run, not container state, so
# there is nothing to reconcile after `docker compose up --force-recreate` and
# no image rebuild to keep in lockstep.
#
# WHY IT IS NOT `chmod -R a+x`: a blanket recursive chmod marks every source
# file, fixture and JSON blob executable. The manifest below is the explicit
# known-executable set instead, and a spec asserts non-manifest files stay 0644.
#
# Usage:
#   restore-exec-bits.sh [--check] [ROOT]      # ROOT defaults to /workspace
#     --check   verify only; never chmod. Exits 97 if anything is missing +x.
#
# Exit codes:
#   0   every manifest entry present in ROOT is executable
#   2   usage error / ROOT is not a directory
#   97  RESERVED: at least one required script is not executable. Deliberately
#       NOT 126 — the whole point is that this failure is tellable apart, in a
#       log, from the shell's "found but not executable" that it replaces.
#
# Invoke as `bash restore-exec-bits.sh`, never `./restore-exec-bits.sh`: this
# file is synced through the same permission-stripping path as everything else
# it repairs, so it cannot rely on its own exec bit.

set -uo pipefail

readonly EXEC_BITS_FATAL=97
readonly LOG_PREFIX="rl-exec-bits:"

# The known-executable set, as globs relative to ROOT. Every entry that MATCHES
# is both repaired and then required to be executable.
#
# `rl-infra/cli/rl` is listed first on purpose: it is the entry the hand-rolled
# incantation kept missing, and it has no `.sh` suffix so it slips past every
# `*.sh`-shaped glob someone writes from memory.
#
# `_`-prefixed basenames are EXCLUDED (see is_sourced_library). In this repo the
# underscore prefix marks a library that is only ever `source`d — _state.sh,
# _admission.sh, _bot_identity.sh, _settings_bundle.sh, _parser.sh — verified by
# grepping every reference: all are `source "$BIN_DIR/_x.sh"`, never executed.
# Sourcing needs read, not execute, and git correctly stores them 100644.
# Requiring +x on them would make --check report a false FATAL on any healthy
# checkout, and a diagnostic that cries wolf is how the last folklore started.
EXEC_MANIFEST=(
    "rl-infra/cli/rl"
    "rl-infra/deploy.sh"
    "rl-infra/gc-sweeper/sweep.sh"
    # Glob rather than a per-file list: A3-B P3 added two more runner scripts
    # (check-state-locks.sh, ensure-runner-dirs.sh) and a list that has to be
    # remembered is how the first folklore started. Nothing under runner/ is a
    # sourced library, so every *.sh here is genuinely executable.
    "rl-infra/runner/*.sh"
    "rl-infra/orchestrator/bin/*"
    "rl-infra/orchestrator/test/*.sh"
    "scripts/*.sh"
    "scripts/test/*.sh"
)

usage() {
    echo "usage: bash restore-exec-bits.sh [--check] [ROOT]" >&2
    exit 2
}

# `_foo.sh` is this repo's convention for a sourced library, not a command.
# Neither repaired nor required — see the EXEC_MANIFEST comment above.
is_sourced_library() {
    [[ "$(basename "$1")" == _* ]]
}

# Expand the manifest against ROOT into MATCHED_FILES. Globs that match nothing
# are reported as a warning, not a failure: a worktree may legitimately predate
# a directory, and hard-failing on layout drift would make every claim brittle.
collect_manifest_files() {
    local root="$1"
    MATCHED_FILES=()
    local pattern matches
    for pattern in "${EXEC_MANIFEST[@]}"; do
        matches=()
        # Word-split is intended here: `$root/$pattern` is a glob.
        # shellcheck disable=SC2206
        matches=($root/$pattern)
        local found=0 f
        for f in "${matches[@]}"; do
            [[ -f "$f" ]] || continue
            is_sourced_library "$f" && continue
            MATCHED_FILES+=("$f")
            found=1
        done
        if (( found == 0 )); then
            echo "$LOG_PREFIX WARN no match for '$pattern' under $root" >&2
        fi
    done
}

# chmod every matched file. Best-effort per file — a failure here is NOT the
# error we report, because a chmod that silently succeeds while leaving the mode
# alone (read-only mount, foreign uid, squashfs) is the case that actually bites.
# Verification below is what decides.
repair_matched_files() {
    local f
    for f in "${MATCHED_FILES[@]}"; do
        [[ -x "$f" ]] && continue
        chmod a+x "$f" 2>/dev/null || true
    done
}

# Verify. Any matched file still lacking +x is a NAMED failure listing the path.
verify_matched_files() {
    local root="$1" f offenders=()
    for f in "${MATCHED_FILES[@]}"; do
        [[ -x "$f" ]] || offenders+=("${f#"$root"/}")
    done
    if (( ${#offenders[@]} == 0 )); then
        return 0
    fi
    {
        echo "$LOG_PREFIX FATAL ${#offenders[@]} required script(s) not executable under $root"
        echo "$LOG_PREFIX   expected: mode with +x (0755) on every manifest entry"
        echo "$LOG_PREFIX   actual:   the paths below are still not executable"
        local o
        for o in "${offenders[@]}"; do
            echo "$LOG_PREFIX     - $o"
        done
        echo "$LOG_PREFIX This is the failure that used to surface as a bare exit 126 with no"
        echo "$LOG_PREFIX assertion output. It is an ENVIRONMENT problem, not a test regression:"
        echo "$LOG_PREFIX the Mutagen sync landed the tree 0644 and the repair could not fix it."
        echo "$LOG_PREFIX Next: check the mount is writable by the runner uid, then 'rl resync'."
    } >&2
    return "$EXEC_BITS_FATAL"
}

main() {
    local check_only=0 root=""
    while (( $# > 0 )); do
        case "$1" in
            --check) check_only=1; shift ;;
            -h|--help) usage ;;
            -*) echo "$LOG_PREFIX unknown flag: $1" >&2; usage ;;
            *) [[ -n "$root" ]] && usage; root="$1"; shift ;;
        esac
    done
    root="${root:-/workspace}"
    root="${root%/}"
    if [[ ! -d "$root" ]]; then
        echo "$LOG_PREFIX FATAL root is not a directory: $root" >&2
        exit 2
    fi

    collect_manifest_files "$root"
    if (( ${#MATCHED_FILES[@]} == 0 )); then
        echo "$LOG_PREFIX FATAL no manifest entry matched anything under $root" >&2
        echo "$LOG_PREFIX   expected: a synced repo worktree; actual: nothing recognisable" >&2
        exit "$EXEC_BITS_FATAL"
    fi
    (( check_only == 0 )) && repair_matched_files

    local rc=0
    verify_matched_files "$root" || rc=$?
    if (( rc == 0 )); then
        echo "$LOG_PREFIX ok — ${#MATCHED_FILES[@]} script(s) executable under $root"
    fi
    exit "$rc"
}

main "$@"
