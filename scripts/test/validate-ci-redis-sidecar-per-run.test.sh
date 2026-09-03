#!/usr/bin/env bash
# A3 fleet-gaps (2026-09-03) — the Redis sidecar must be PER RUN, not per slot.
#
# Regression under test: `_spawn_redis_sidecar_if_remote` named the sidecar
# `rl-test-redis-${RL_SLOT}` and installed an EXIT trap that removed that
# name unconditionally. Two validate-ci runs on the SAME slot therefore shared
# one container name, and the first run to exit (typically a cancelled one)
# tore down the sidecar the OTHER, still-live run was using. Observed
# 2026-09-02: BullMQ looped on `getaddrinfo ENOTFOUND rl-test-redis-2` for
# 16.5k log lines and the integration suite stalled at spec 34/151.
#
# Fixed shape:
#   - container name carries a per-run suffix (`rl-test-redis-${slot}-$$`),
#   - the EXIT trap tears down ONLY the name this run recorded,
#   - REDIS_URL points at that same per-run name (hostname == container name
#     on rl-net, so the two MUST move in lockstep),
#   - the trap still runs `_perf_validate_end` when main() installed it
#     (a bare `trap ... EXIT` in the sidecar clobbers it — validate.end then
#     never lands in the perf log).
#
# Strategy mirrors validate-ci-redis-sidecar.test.sh: source validate-ci.sh
# with RL_VALIDATE_CI_DRY=1 and a docker stub on PATH, then assert on the
# recorded docker argv.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-redis-sidecar-per-run.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
VALIDATE_CI_PATH="$REPO_ROOT/scripts/validate-ci.sh"

TEST_PASS_COUNT=0
TEST_FAIL_COUNT=0
TEST_FAIL_NAMES=()
CURRENT_TEST_NAME=""

pass() { TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1)); }
fail() {
    TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
    TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $1")
    echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $1"
}
assert_grep() {
    local pattern="$1" file="$2" message="${3:-}"
    if grep -E -q -- "$pattern" "$file"; then pass; else fail "$message (pattern not found: $pattern)"; fi
}

# Stub bin: docker records argv; npm/npx no-op.
make_stub_bin() {
    local stub_dir
    stub_dir=$(mktemp -d -t rl-redis-perrun-stub.XXXXXX)
    cat >"$stub_dir/docker" <<'EOF'
#!/usr/bin/env bash
if [[ -n "${STUB_DOCKER_ARGV_FILE:-}" ]]; then
    echo "$*" >>"$STUB_DOCKER_ARGV_FILE"
fi
if [[ "$1" == "exec" && "$*" == *"redis-cli ping"* ]]; then
    echo "PONG"
    exit 0
fi
# `docker ps -q --filter ...` (orphan sweep) must return nothing by default.
if [[ "$1" == "ps" ]]; then
    exit 0
fi
exit "${STUB_DOCKER_EXIT:-0}"
EOF
    printf '#!/usr/bin/env bash\nexit 0\n' >"$stub_dir/npm"
    printf '#!/usr/bin/env bash\nexit 0\n' >"$stub_dir/npx"
    chmod +x "$stub_dir/docker" "$stub_dir/npm" "$stub_dir/npx"
    echo "$stub_dir"
}

# Run ONE simulated validate-ci run that spawns a sidecar and then exits, so
# the EXIT trap fires. $1 = stub bin dir, $2 = docker argv file, $3 = extra
# shell snippet evaluated after the spawn (optional).
run_one_sidecar_run() {
    local stub_bin="$1" argv_file="$2" extra="${3:-}"
    PATH="$stub_bin:$PATH" \
    REPO_ROOT="$REPO_ROOT" \
    RL_TARGET="remote" \
    RL_SLOT="1" \
    STUB_DOCKER_ARGV_FILE="$argv_file" \
    bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; _spawn_redis_sidecar_if_remote; echo \"REDIS_URL_AFTER=\${REDIS_URL:-UNSET}\"; $extra" 2>&1
}

# ===== Structural =====

# A3-1: the trap must not hardcode the bare per-slot name — it must tear down
# the recorded per-run container only.
CURRENT_TEST_NAME="A3-1: EXIT trap does not hardcode the shared per-slot name"
if grep -E -q "trap .*rl-test-redis-\\\$\{slot\}'" "$VALIDATE_CI_PATH"; then
    fail "trap still removes the shared 'rl-test-redis-\${slot}' name — a concurrent run's sidecar would be killed"
else
    pass
fi
assert_grep '_cleanup_redis_sidecar' "$VALIDATE_CI_PATH" \
    "expected a _cleanup_redis_sidecar helper that removes only the name this run created"

# A3-2: the per-run suffix must be present in the container name.
CURRENT_TEST_NAME="A3-2: sidecar container name carries a per-run suffix"
assert_grep 'rl-test-redis-\$\{slot\}-\$\$' "$VALIDATE_CI_PATH" \
    "expected per-run container name rl-test-redis-\${slot}-\$\$"

# A3-3: REDIS_URL must be derived from the SAME variable as the container name.
CURRENT_TEST_NAME="A3-3: REDIS_URL derives from the per-run container name"
assert_grep 'REDIS_URL="redis://\$\{?cname' "$VALIDATE_CI_PATH" \
    "REDIS_URL must interpolate \$cname so hostname and container name can never drift"

# A3-4: the sidecar EXIT trap must not clobber main()'s _perf_validate_end.
CURRENT_TEST_NAME="A3-4: sidecar EXIT trap chains _perf_validate_end"
assert_grep '_perf_validate_end' "$VALIDATE_CI_PATH" "expected the exit handler to chain _perf_validate_end"

# ===== Behavioral =====

if ! grep -E -q 'RL_VALIDATE_CI_DRY' "$VALIDATE_CI_PATH"; then
    echo "[SKIP behavioral block — RL_VALIDATE_CI_DRY guard missing]"
else
    stub_bin=$(make_stub_bin)
    argv_a=$(mktemp -t rl-redis-argv-a.XXXXXX)
    argv_b=$(mktemp -t rl-redis-argv-b.XXXXXX)

    CURRENT_TEST_NAME="A3-5: two runs on the same slot get DIFFERENT container names"
    out_a=$(run_one_sidecar_run "$stub_bin" "$argv_a")
    out_b=$(run_one_sidecar_run "$stub_bin" "$argv_b")
    name_a=$(grep -oE 'rl-test-redis-1-[0-9]+' "$argv_a" | head -1)
    name_b=$(grep -oE 'rl-test-redis-1-[0-9]+' "$argv_b" | head -1)
    if [[ -n "$name_a" && -n "$name_b" ]]; then pass; else
        fail "expected per-run names like rl-test-redis-1-<pid> (a='$name_a' b='$name_b'; argv_a: $(tr '\n' '|' <"$argv_a"))"
    fi
    if [[ -n "$name_a" && "$name_a" != "$name_b" ]]; then pass; else
        fail "two runs on slot 1 produced the SAME container name ('$name_a') — they can still tear down each other's sidecar"
    fi

    CURRENT_TEST_NAME="A3-6: REDIS_URL points at this run's own sidecar"
    if grep -E -q "REDIS_URL_AFTER=redis://${name_a}:6379" <<<"$out_a"; then pass; else
        fail "REDIS_URL must match the spawned container name (name=$name_a, got: $(grep REDIS_URL_AFTER <<<"$out_a"))"
    fi

    CURRENT_TEST_NAME="A3-7: run B's EXIT trap never removes run A's sidecar"
    # The regression: B's trap did `docker rm -f rl-test-redis-1`, which killed
    # A's live sidecar. B must only ever name its OWN container.
    if [[ -n "$name_a" ]] && grep -q -- "$name_a" "$argv_b"; then
        fail "run B issued a docker command naming run A's sidecar ($name_a): $(tr '\n' '|' <"$argv_b")"
    else
        pass
    fi
    if grep -E -q "rm -f ${name_b}$" "$argv_b"; then pass; else
        fail "run B's trap must docker rm -f its OWN sidecar ($name_b); got: $(tr '\n' '|' <"$argv_b")"
    fi

    CURRENT_TEST_NAME="A3-8: sidecar trap still runs main()'s _perf_validate_end"
    argv_c=$(mktemp -t rl-redis-argv-c.XXXXXX)
    out_c=$(
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="remote" \
        RL_SLOT="1" \
        STUB_DOCKER_ARGV_FILE="$argv_c" \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'
_perf_validate_end() { echo \"PERF_END_RAN rc=\$?\"; }
trap _perf_validate_end EXIT
_spawn_redis_sidecar_if_remote
exit 7" 2>&1
    )
    rc_c=$?
    if grep -q 'PERF_END_RAN' <<<"$out_c"; then pass; else
        fail "installing the sidecar trap clobbered main()'s _perf_validate_end (output: $(tr '\n' '|' <<<"$out_c"))"
    fi
    if grep -q 'PERF_END_RAN rc=7' <<<"$out_c"; then pass; else
        fail "chained exit handler must preserve the script's exit code for _perf_validate_end (got: $(grep PERF_END_RAN <<<"$out_c"))"
    fi
    if [[ "$rc_c" == "7" ]]; then pass; else
        fail "chained exit handler must not change the script's exit status (got $rc_c)"
    fi
    if grep -E -q 'rm -f rl-test-redis-1-[0-9]+' "$argv_c"; then pass; else
        fail "sidecar must still be torn down when a chained _perf_validate_end exists: $(tr '\n' '|' <"$argv_c")"
    fi

    CURRENT_TEST_NAME="A3-9: cleanup is idempotent (second call is a no-op)"
    argv_d=$(mktemp -t rl-redis-argv-d.XXXXXX)
    # Count `docker stop` — only the teardown path issues it (the pre-spawn
    # idempotency clean is `rm -f` only), so it is an exact teardown counter.
    # Two explicit cleanups + the EXIT trap must still yield exactly one.
    run_one_sidecar_run "$stub_bin" "$argv_d" '_cleanup_redis_sidecar; _cleanup_redis_sidecar' >/dev/null
    stop_count=$(grep -c -E '^stop rl-test-redis-1-[0-9]+$' "$argv_d" || true)
    if [[ "$stop_count" == "1" ]]; then pass; else
        fail "expected exactly one teardown for the run's sidecar, got $stop_count: $(tr '\n' '|' <"$argv_d")"
    fi

    rm -rf "$stub_bin" "$argv_a" "$argv_b" "$argv_c" "$argv_d"
fi

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do
        echo "  - $f"
    done
    exit 1
fi
exit 0
