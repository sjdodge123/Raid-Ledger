#!/usr/bin/env bash
# A3-B P3 — slots 3–4 must be provisioned identically to slots 1–2.
#
# WHAT THE TRACE ACTUALLY FOUND (two of the brief's three mechanism claims
# were wrong; these specs assert the real behaviour, not the reported one):
#
#  1. `/state-locks` — CONFIRMED missing on runner-3/runner-4 in
#     rl-infra/docker-compose.yml. But it does NOT produce
#     `flock: Bad file descriptor` → LOCK_TIMEOUT. The call site
#     (scripts/validate-ci.sh::run_discord_smoke) reads
#         if [[ -d "$lock_dir" ]] && _discord_lock_required; then
#     so a missing mount SKIPS the whole lock branch and smoke runs
#     unsynchronized, silently, exit 0. The 900s/`Bad file descriptor` story
#     describes a failure mode this code cannot reach — the real defect is the
#     opposite and worse: it is invisible. (The `-w` there is 600, not 900, and
#     its timeout path is `exit 75`, reachable only when the dir DOES exist.)
#
#  2. There is NO "extra-slots scaffold". Nothing in the repo creates
#     /srv/rl-infra/runners/slot-{3,4}/worktree at all —
#     proxmox/cloud-init.yaml:110 creates slot-1 and slot-2 only and comments
#     "Slot 3+4 dirs are created on-demand". "On-demand" means the Docker
#     daemon mkdir'ing a missing bind-mount source as root, which is exactly
#     where the root ownership comes from. So the fix is not "correct a
#     scaffold", it is "have one".
#
#  3. The brief's `test -d /state-locks || exit 98` would be wrong as written:
#     the operator's laptop legitimately has no /state-locks and must keep
#     running unsynchronized (single host ⇒ no cross-slot contention). The
#     named check therefore keys on RL_SLOT (set only by the compose runner
#     services), so it is fatal exactly where the mount is mandatory.
#
# NB (self-immunity, A3-B P2): every script invocation below is
# `bash "$SCRIPT"`, never `"$SCRIPT"`. A spec covering a provisioning bug must
# not be able to fail because of a dropped exec bit.

set -uo pipefail

CURRENT_TEST_FILE="extra-slots-provisioning.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

REPO_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/rl-infra/docker-compose.yml"
ENSURE_SCRIPT="$REPO_ROOT/rl-infra/runner/ensure-runner-dirs.sh"
CHECK_SCRIPT="$REPO_ROOT/rl-infra/runner/check-state-locks.sh"
ENTRYPOINT="$REPO_ROOT/rl-infra/runner/entrypoint.sh"

# Reserved, non-overlapping exit codes. Deliberately NOT 1/126/124 — the whole
# point is that each of these is tellable apart from a test failure, a
# "found but not executable", and a timeout, in a log, without a human.
readonly STATE_LOCKS_FATAL=98    # /state-locks missing inside a fleet runner
readonly RUNNER_DIRS_FATAL=96    # a runner dir is wrong and was not repairable

readonly WANT_LOCK_MOUNT="/srv/rl-infra/state/locks:/state-locks:rw"
readonly WANT_OWNER="rl-agent:rl-fleet"
readonly WANT_MODE="2775"

# --- helpers -----------------------------------------------------------------

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

exists_dir() { [[ -d "$1" ]] && echo yes || echo no; }

# Extract one compose service block: everything indented under `  <name>:` up
# to the next sibling key at the same indent. Comment lines are not treated as
# block terminators (the extra-slots preamble sits at 2-space indent).
compose_service_block() {
    awk -v svc="  $1:" '
        $0 == svc { inblock = 1; next }
        inblock && /^  [^ #]/ { inblock = 0 }
        inblock { print }
    ' "$COMPOSE_FILE"
}

# The service's volume list with the slot number erased, so slots can be
# compared to each other directly.
normalized_volumes() {
    compose_service_block "runner-$1" \
        | sed -n 's/^[[:space:]]*-[[:space:]]*\(.*\)$/\1/p' \
        | sed "s|slot-$1|slot-N|g; s|runner-$1-|runner-N-|g"
}

# A PATH stub that records its argv and returns a fixed code — the pattern
# test_env_destroy_m6a.sh uses for flock. Lets the ownership assertions run
# deterministically as an unprivileged user on macOS AND as root on the runner.
make_stub() {
    local dir="$1" name="$2" code="$3"
    mkdir -p "$dir"
    cat > "$dir/$name" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$dir/$name.calls"
exit $code
STUB
    chmod +x "$dir/$name"
}

# Guard: assert the artifact exists with a named message before invoking it, so
# a missing file fails as an assertion rather than as a bare 127.
require_script() {
    local path="$1" label="$2"
    assert_file_exists "$path" "$label must exist — P3's fix is this file"
    [[ -f "$path" ]]
}

# --- AC1: every runner service binds /state-locks ----------------------------

test_ac1_all_runners_mount_state_locks() {
    CURRENT_TEST_NAME="AC1: every runner service binds $WANT_LOCK_MOUNT"
    local slot line
    for slot in 1 2 3 4; do
        line="$(compose_service_block "runner-$slot" \
            | sed -n 's/^[[:space:]]*-[[:space:]]*\(.*:\/state-locks.*\)$/\1/p' \
            | head -1)"
        assert_eq "$line" "$WANT_LOCK_MOUNT" \
            "runner-$slot has no /state-locks bind mount in docker-compose.yml; without it the Discord-smoke lock branch in validate-ci.sh is skipped and smoke on slot $slot runs unsynchronized"
    done
}

# --- AC1b: slots 3–4 provisioned identically to 1–2 --------------------------

test_ac1b_extra_slots_match_default_slots() {
    CURRENT_TEST_NAME="AC1b: runner-3/runner-4 volume sets are identical to runner-1/runner-2"
    local baseline slot actual
    baseline="$(normalized_volumes 1)"
    for slot in 2 3 4; do
        actual="$(normalized_volumes "$slot")"
        assert_eq "$actual" "$baseline" \
            "runner-$slot must be provisioned identically to runner-1 (slot number aside); an asymmetric extra-slots profile is what let /state-locks go missing unnoticed"
    done
}

# --- AC2: the scaffold creates worktrees rl-agent-owned + setgid -------------

test_ac2_scaffold_owns_and_setgids_worktree() {
    CURRENT_TEST_NAME="AC2: scaffold creates slot worktrees $WANT_OWNER $WANT_MODE, not root-owned"
    require_script "$ENSURE_SCRIPT" "rl-infra/runner/ensure-runner-dirs.sh" || return 0

    local root="$TMP_STATE/srv" stub="$TMP_STATE/stub" rc=0
    make_stub "$stub" chown 0
    PATH="$stub:$PATH" bash "$ENSURE_SCRIPT" --root "$root" >/dev/null 2>&1 || rc=$?

    assert_exit_code "$rc" "0" \
        "scaffold must succeed when ownership can be applied"
    assert_eq "$(exists_dir "$root/runners/slot-3/worktree")" "yes" \
        "scaffold must create slot-3's worktree dir; today nothing does, so Docker mkdir's the bind-mount source as root"
    assert_eq "$(mode_of "$root/runners/slot-3/worktree")" "$WANT_MODE" \
        "slot-3 worktree must be mode $WANT_MODE (setgid + group-write) like slots 1-2 — Docker's implicit 0755 is why the Mutagen beta fails every entry with permission denied"
    assert_contains "$(cat "$stub/chown.calls" 2>/dev/null)" \
        "$WANT_OWNER $root/runners/slot-3/worktree" \
        "scaffold must chown slot-3's worktree to $WANT_OWNER (the Mutagen beta connects as rl-agent); a root-owned dir is unwritable by it"
}

test_ac2b_scaffold_covers_all_four_slots_and_the_lock_dir() {
    CURRENT_TEST_NAME="AC2b: scaffold covers slots 1-4 plus the /state-locks source dir"
    require_script "$ENSURE_SCRIPT" "rl-infra/runner/ensure-runner-dirs.sh" || return 0

    local root="$TMP_STATE/srv" stub="$TMP_STATE/stub" slot
    make_stub "$stub" chown 0
    PATH="$stub:$PATH" bash "$ENSURE_SCRIPT" --root "$root" >/dev/null 2>&1 || true

    for slot in 1 2 3 4; do
        assert_eq "$(exists_dir "$root/runners/slot-$slot/worktree")" "yes" \
            "scaffold must create slot-$slot's worktree unconditionally — gating on RUNNER_SLOTS reintroduces the 'did you remember to bump it' failure the extra-slots profile already has"
    done
    assert_eq "$(exists_dir "$root/state/locks")" "yes" \
        "scaffold must create the host side of the /state-locks bind mount, else Docker recreates it root-owned on next runner start"
    assert_eq "$(mode_of "$root/state/locks")" "$WANT_MODE" \
        "the lock dir must be group-writable + setgid so both rl and rl-agent can inspect the flock file"
}

test_ac2c_unrepairable_ownership_is_named_not_silent() {
    CURRENT_TEST_NAME="AC2c: ownership that cannot be applied yields the named $RUNNER_DIRS_FATAL, never a silent pass"
    require_script "$ENSURE_SCRIPT" "rl-infra/runner/ensure-runner-dirs.sh" || return 0

    local root="$TMP_STATE/srv" stub="$TMP_STATE/stub" out rc=0
    make_stub "$stub" chown 1
    out=$(PATH="$stub:$PATH" bash "$ENSURE_SCRIPT" --root "$root" 2>&1) || rc=$?

    assert_exit_code "$rc" "$RUNNER_DIRS_FATAL" \
        "a dir left with the wrong owner must exit $RUNNER_DIRS_FATAL, not 0 — silence here is the original defect (nobody noticed slot-3 was root-owned until Mutagen failed 38 of 39 entries)"
    assert_contains "$out" "rl-runner-dirs:" \
        "the failure must carry a greppable named prefix"
    assert_contains "$out" "$root/runners/slot-3/worktree" \
        "the failure must NAME the offending path so no one has to guess which slot"
    assert_contains "$out" "$WANT_OWNER" \
        "the failure must state the ownership it wanted"
}

test_ac2d_scaffold_is_idempotent() {
    CURRENT_TEST_NAME="AC2d: a second run over already-correct dirs is a no-op success"
    require_script "$ENSURE_SCRIPT" "rl-infra/runner/ensure-runner-dirs.sh" || return 0

    local root="$TMP_STATE/srv" stub="$TMP_STATE/stub" rc=0
    make_stub "$stub" chown 0
    PATH="$stub:$PATH" bash "$ENSURE_SCRIPT" --root "$root" >/dev/null 2>&1 || true
    PATH="$stub:$PATH" bash "$ENSURE_SCRIPT" --root "$root" >/dev/null 2>&1 || rc=$?

    assert_exit_code "$rc" "0" \
        "re-running the scaffold must stay green — deploy.sh calls it on every deploy"
}

# --- AC3: a missing /state-locks fails by NAME, not by timeout ---------------

test_ac3_missing_lock_dir_is_named_not_a_timeout() {
    CURRENT_TEST_NAME="AC3: missing /state-locks inside a runner exits $STATE_LOCKS_FATAL by name"
    require_script "$CHECK_SCRIPT" "rl-infra/runner/check-state-locks.sh" || return 0

    local missing="$TMP_STATE/no-such-locks" out rc=0 secs
    out=$(RL_SLOT=3 bash "$CHECK_SCRIPT" "$missing" 2>&1) || rc=$?

    assert_exit_code "$rc" "$STATE_LOCKS_FATAL" \
        "a missing lock mount inside runner-3 must exit $STATE_LOCKS_FATAL; today validate-ci.sh's [[ -d ]] guard makes it exit 0 and run smoke unsynchronized"
    assert_contains "$out" "rl-state-locks:" \
        "the failure must carry a greppable named prefix, not be inferred from a stalled clock"
    assert_contains "$out" "$missing" \
        "the failure must NAME the path that is not mounted"
    assert_contains "$out" "not mounted" \
        "the failure must say what is wrong in words"
    assert_contains "$out" "slot 3" \
        "the failure must NAME the slot, so the operator knows which runner service to fix"

    secs=$(time_seconds env RL_SLOT=3 bash "$CHECK_SCRIPT" "$missing")
    assert_le "$secs" "5" \
        "the verdict must be immediate; the defect being replaced is a 10-minute wait that reports LOCK_TIMEOUT for what is really a missing mount"
}

test_ac3b_present_lock_dir_passes() {
    CURRENT_TEST_NAME="AC3b: a mounted, writable /state-locks exits 0"
    require_script "$CHECK_SCRIPT" "rl-infra/runner/check-state-locks.sh" || return 0

    local present="$TMP_STATE/locks" rc=0
    mkdir -p "$present"
    RL_SLOT=3 bash "$CHECK_SCRIPT" "$present" >/dev/null 2>&1 || rc=$?
    assert_exit_code "$rc" "0" \
        "a correctly-mounted lock dir must pass cleanly"
}

test_ac3c_laptop_without_rl_slot_is_not_fatal() {
    CURRENT_TEST_NAME="AC3c: outside a fleet runner (no RL_SLOT) a missing dir is explained, not fatal"
    require_script "$CHECK_SCRIPT" "rl-infra/runner/check-state-locks.sh" || return 0

    local missing="$TMP_STATE/no-such-locks" out rc=0
    out=$(env -u RL_SLOT bash "$CHECK_SCRIPT" "$missing" 2>&1) || rc=$?

    assert_exit_code "$rc" "0" \
        "the operator's laptop has no /state-locks by design (single host ⇒ no cross-slot contention); a blanket 'test -d || exit 98' would break every local run"
    assert_contains "$out" "rl-state-locks:" \
        "even the benign verdict must be greppable, so 'unsynchronized' is never inferred from silence"
}

# --- AC4: the runner entrypoint reports the verdict, without bricking the slot

test_ac4_entrypoint_reports_but_does_not_brick_the_runner() {
    CURRENT_TEST_NAME="AC4: entrypoint surfaces the named verdict at container start and still execs"
    require_script "$CHECK_SCRIPT" "rl-infra/runner/check-state-locks.sh" || return 0

    local missing="$TMP_STATE/no-such-locks" stub="$TMP_STATE/stub" out
    make_stub "$stub" tmux 0
    out=$(PATH="$stub:$PATH" RL_SLOT=3 \
        RL_CHECK_STATE_LOCKS="$CHECK_SCRIPT" \
        RL_STATE_LOCKS_DIR="$missing" \
        bash "$ENTRYPOINT" echo entrypoint-reached-exec 2>&1)

    assert_contains "$out" "rl-state-locks:" \
        "the entrypoint must emit the named verdict into the container log — that log is where the operator (and Loki) can see a mis-provisioned runner BEFORE a smoke run silently goes unsynchronized"
    assert_contains "$out" "entrypoint-reached-exec" \
        "the check must be advisory at container start: a missing mount must not crash-loop the runner and take the whole slot out"
}

run_test "AC1 all runners mount /state-locks"  test_ac1_all_runners_mount_state_locks
run_test "AC1b extra slots match defaults"     test_ac1b_extra_slots_match_default_slots
run_test "AC2 scaffold owner + setgid"         test_ac2_scaffold_owns_and_setgids_worktree
run_test "AC2b scaffold covers 1-4 + locks"    test_ac2b_scaffold_covers_all_four_slots_and_the_lock_dir
run_test "AC2c unrepairable is named"          test_ac2c_unrepairable_ownership_is_named_not_silent
run_test "AC2d scaffold idempotent"            test_ac2d_scaffold_is_idempotent
run_test "AC3 missing lock dir named"          test_ac3_missing_lock_dir_is_named_not_a_timeout
run_test "AC3b present lock dir passes"        test_ac3b_present_lock_dir_passes
run_test "AC3c laptop not fatal"               test_ac3c_laptop_without_rl_slot_is_not_fatal
run_test "AC4 entrypoint reports, not bricks"  test_ac4_entrypoint_reports_but_does_not_brick_the_runner

print_test_summary
