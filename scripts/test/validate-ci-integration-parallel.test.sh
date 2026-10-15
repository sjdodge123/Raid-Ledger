#!/usr/bin/env bash
# ROK-1793 S1(ii) — validate-ci.sh INTEGRATION_PARALLEL.
#
# run_integration_tests runs its jest shards serially by default. With
# INTEGRATION_PARALLEL=2 it runs them two at a time in waves (1+2, then 3+4),
# each parallel shard with a lower heap and its own Redis db index, and still:
#   - fails the tier when any shard fails,
#   - never launches the next wave after a failed one (stop-early),
#   - names the specs that never reported a result (TDB:330).
#
# The npx stub is a two-party barrier: shard i records `start i`, then polls up
# to $STUB_BARRIER_SECS for its wave partner (1<->2, 3<->4) to be running (or
# to have ended after seeing it) and logs `overlap i` or `alone i`. Serial shards are always `alone`; parallel ones
# always `overlap`. The poll is bounded, so a serial run costs the timeout.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-integration-parallel.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
VALIDATE_CI_PATH="$REPO_ROOT/scripts/validate-ci.sh"

TEST_PASS_COUNT=0
TEST_FAIL_COUNT=0
CURRENT_TEST_NAME=""
pass() { TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1)); }
fail() {
    TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
    echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $1"
}

WORK=$(mktemp -d -t rl-int-par.XXXXXX)
STUB_BIN="$WORK/bin"
mkdir -p "$STUB_BIN"

cat >"$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "exec" && "$*" == *"redis-cli ping"* ]]; then echo "PONG"; fi
exit 0
EOF

cat >"$STUB_BIN/npx" <<'EOF'
#!/usr/bin/env bash
shard=""
for arg in "$@"; do
    case "$arg" in --shard=*) shard="${arg#--shard=}"; shard="${shard%%/*}" ;; esac
done
# Not an integration shard (build/tsc/lint/unit under a whole-script run).
[[ -z "$shard" ]] && exit 0
ev="$STUB_STATE/events"
echo "start ${shard} heap=${NODE_OPTIONS#--max-old-space-size=} redis=${REDIS_URL:-<unset>}" >>"$ev"
: >"$STUB_STATE/started.${shard}"
# A hung shard (bounded), so a test can prove its failing partner stops it.
if [[ "${STUB_NPX_HANG_SHARD:-}" == "$shard" ]]; then
    hang_end=$(( $(date +%s) + ${STUB_HANG_SECS:-20} ))
    while (( $(date +%s) < hang_end )); do sleep 0.1; done
fi
if (( shard % 2 == 1 )); then partner=$((shard + 1)); else partner=$((shard - 1)); fi
deadline=$(( $(date +%s) + ${STUB_BARRIER_SECS:-1} ))
state="alone"
while (( $(date +%s) <= deadline )); do
    # The partner overlaps me if it is still running, or if it already ended
    # having seen me start (its own state is overlap).
    if [[ -e "$STUB_STATE/started.${partner}" ]] && { [[ ! -e "$STUB_STATE/ended.${partner}" ]] \
        || grep -q overlap "$STUB_STATE/ended.${partner}"; }; then state="overlap"; break; fi
    sleep 0.05
done
echo "${state} ${shard}" >>"$ev"
# Emit the shard's jest result line (spec number $shard of the list).
if [[ -n "${STUB_SPEC_LIST:-}" ]]; then
    spec=$(sed -n "${shard}p" "$STUB_SPEC_LIST")
    [[ -n "$spec" ]] && echo " PASS ${spec} (1.0 s, 100 MB heap size)"
fi
echo "$state" >"$STUB_STATE/ended.${shard}"
echo "end ${shard}" >>"$ev"
# done.<shard>: this stub's pid and its ancestors, written last and atomically.
ancestors() { local p=$$; while [[ -n "$p" && "$p" -gt 1 ]]; do echo "$p"; p=$(ps -o ppid= -p "$p" | tr -d ' '); done; }
ancestors >"$STUB_STATE/done.${shard}.tmp" && mv "$STUB_STATE/done.${shard}.tmp" "$STUB_STATE/done.${shard}"
if [[ "${STUB_NPX_FAIL_SHARD:-}" == "$shard" ]]; then
    # STUB_FAIL_AWAITS_PARTNER: fail only once the partner has written done.<partner>
    # AND every process of its shard pipeline (the pids in done.<partner> that
    # are not my own ancestors) has exited, so the partner PASSes before the
    # failure can stop it. Condition-polled, bounded; never a timed sleep.
    if [[ -n "${STUB_FAIL_AWAITS_PARTNER:-}" ]]; then
        until_t=$(( $(date +%s) + ${STUB_PARTNER_WAIT_SECS:-30} ))
        while [[ ! -e "$STUB_STATE/done.${partner}" ]] && (( $(date +%s) <= until_t )); do sleep 0.05; done
        mine=$(ancestors)
        for p in $(cat "$STUB_STATE/done.${partner}" 2>/dev/null); do
            grep -q -x -e "$p" <<<"$mine" && continue
            while kill -0 "$p" 2>/dev/null && (( $(date +%s) <= until_t )); do sleep 0.05; done
        done
    fi
    exit 1
fi
exit 0
EOF
for tool in npm curl node; do printf '#!/usr/bin/env bash\nexit 0\n' >"$STUB_BIN/$tool"; done
REAL_GIT="$(command -v git)"
cat >"$STUB_BIN/git" <<EOF
#!/usr/bin/env bash
[[ "\${1:-}" == "fetch" ]] && exit 0
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$STUB_BIN"/*

SPEC_LIST="$WORK/specs"
(cd "$REPO_ROOT/api" && find src -name '*.integration.spec.ts') | LC_ALL=C sort -u >"$SPEC_LIST"
TOTAL_SPECS=$(grep -c . "$SPEC_LIST")

# run_case <out-var-prefix> [VAR=value ...] — runs run_integration_tests with
# the stubs; sets RC, OUT, EVENTS.
run_case() {
    rm -rf "$WORK/state"; mkdir -p "$WORK/state"
    OUT=$(
        env -u INTEGRATION_PARALLEL -u INTEGRATION_SHARDS -u CI -u DATABASE_URL \
            PATH="$STUB_BIN:$PATH" REPO_ROOT="$REPO_ROOT" RL_TARGET="remote" RL_SLOT="1" \
            STUB_STATE="$WORK/state" STUB_SPEC_LIST="$SPEC_LIST" "$@" \
            bash -c "cd '$REPO_ROOT' && RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; run_integration_tests" 2>&1
    )
    RC=$?
    EVENTS=$(cat "$WORK/state/events" 2>/dev/null || true)
}

line_of() { grep -n -x -e "$1" <<<"$EVENTS" | head -1 | cut -d: -f1; }
started() { grep -E -c -e "^start $1 " <<<"$EVENTS" || true; }

# ----- default: serial -----
CURRENT_TEST_NAME="default INTEGRATION_PARALLEL runs the 4 shards serially"
run_case STUB_BARRIER_SECS=0
order=$(grep -E -o '^(start|end) [0-9]+' <<<"$EVENTS" | tr '\n' ',')
if [[ "$order" == "start 1,end 1,start 2,end 2,start 3,end 3,start 4,end 4," ]]; then pass; else
    fail "serial run must be start/end 1..4 in order, got: ${order}"; fi
if [[ $(grep -c '^overlap' <<<"$EVENTS") -eq 0 ]]; then pass; else
    fail "serial shards must never overlap, got: $(grep '^overlap' <<<"$EVENTS" | tr '\n' ',')"; fi
if [[ $(grep -c -E '^start [0-9]+ heap=4096 redis=redis://rl-test-redis-1[^:/]*:6379$' <<<"$EVENTS") -eq 4 ]]; then pass; else
    fail "serial shards keep the 4096 MB heap and the sidecar's REDIS_URL unchanged, got: $(grep '^start' <<<"$EVENTS" | tr '\n' ',')"; fi
if [[ $RC -eq 0 ]]; then pass; else fail "an all-PASS serial run must return 0, got rc=$RC"; fi

# ----- INTEGRATION_PARALLEL=2 -----
CURRENT_TEST_NAME="INTEGRATION_PARALLEL=2 runs two shards at a time, in waves"
run_case INTEGRATION_PARALLEL=2 STUB_BARRIER_SECS=10
for i in 1 2 3 4; do
    if grep -q -x -e "overlap $i" <<<"$EVENTS"; then pass; else
        fail "shard $i must overlap its wave partner under INTEGRATION_PARALLEL=2, events: $(tr '\n' ',' <<<"$EVENTS")"; fi
done
s3=$(grep -n -E -e '^start 3 heap=2560 redis=redis://rl-test-redis-1[^:/]*:6379/3$' <<<"$EVENTS" | head -1 | cut -d: -f1); e1=$(line_of 'end 1'); e2=$(line_of 'end 2')
if [[ -n "$s3" && -n "$e1" && -n "$e2" && $s3 -gt $e1 && $s3 -gt $e2 ]]; then pass; else
    fail "wave 2 (shard 3, heap 2560, redis db 3) must start after shards 1 and 2 end, events: $(tr '\n' ',' <<<"$EVENTS")"; fi
for i in 1 2 4; do
    if grep -q -E -e "^start $i heap=2560 redis=redis://rl-test-redis-1[^:/]*:6379/$i$" <<<"$EVENTS"; then pass; else
        fail "parallel shard $i must get heap 2560 and Redis db index $i, events: $(grep '^start' <<<"$EVENTS" | tr '\n' ',')"; fi
done
if [[ $RC -eq 0 ]] && grep -q -x -e '=== Shard results: PASS PASS PASS PASS ===' <<<"$OUT"; then pass; else
    fail "an all-PASS parallel run must return 0 with 4 PASS results, got rc=$RC, $(grep 'Shard results' <<<"$OUT")"; fi
if grep -q -e '^\[shard 2/4\]  PASS src/' <<<"$OUT"; then pass; else
    fail "parallel shard output must stream with a [shard i/N] prefix, got: $(grep -m2 'PASS src/' <<<"$OUT")"; fi

# ----- INTEGRATION_PARALLEL=2 with a failing shard -----
CURRENT_TEST_NAME="INTEGRATION_PARALLEL=2: a failing shard fails the tier, stops, reports unrun specs"
# Shard 1 fails only after shard 2's whole pipeline has exited (PASS), so the
# stop-the-partner path cannot turn this into FAIL STOPPED (Codex P2).
run_case INTEGRATION_PARALLEL=2 STUB_BARRIER_SECS=10 STUB_NPX_FAIL_SHARD=1 STUB_FAIL_AWAITS_PARTNER=1
if [[ $RC -ne 0 ]]; then pass; else fail "a failed parallel shard must fail the tier, got rc=0"; fi
if [[ $(started 2) -eq 1 ]]; then pass; else fail "shard 2 is in shard 1's wave and must still run, events: $(tr '\n' ',' <<<"$EVENTS")"; fi
if [[ $(started 3) -eq 0 && $(started 4) -eq 0 ]]; then pass; else
    fail "the wave after a failure must never launch (stop-early), events: $(tr '\n' ',' <<<"$EVENTS")"; fi
if grep -q -x -e '=== Shard results: FAIL PASS ===' <<<"$OUT"; then pass; else
    fail "expected 'Shard results: FAIL PASS', got: $(grep 'Shard results' <<<"$OUT" || echo '<none>')"; fi
expected_missing=$((TOTAL_SPECS - 2))
if grep -E -q -e "^${expected_missing} spec\(s\) never ran or did not finish:" <<<"$OUT"; then pass; else
    fail "expected '${expected_missing} spec(s) never ran' (shards 1+2 each reported one), got: $(grep -E 'never ran|reported a result' <<<"$OUT" || echo '<no report>')"; fi

# ----- guards -----
CURRENT_TEST_NAME="INTEGRATION_PARALLEL=2 with CI=true + DATABASE_URL stays serial (one shared DB)"
run_case INTEGRATION_PARALLEL=2 CI=true DATABASE_URL=postgres://x/y STUB_BARRIER_SECS=0
if [[ $(grep -c '^overlap' <<<"$EVENTS") -eq 0 ]] && grep -q 'every shard shares one DB' <<<"$OUT"; then pass; else
    fail "CI=true + DATABASE_URL must force serial shards with a message, events: $(tr '\n' ',' <<<"$EVENTS")"; fi

CURRENT_TEST_NAME="INTEGRATION_PARALLEL=5 is capped at 2; a non-number runs serially"
run_case INTEGRATION_PARALLEL=5 STUB_BARRIER_SECS=10
if grep -q -x -e 'overlap 1' <<<"$EVENTS" && grep -q 'capped at 2' <<<"$OUT" && [[ $(started 3) -eq 1 ]]; then pass; else
    fail "INTEGRATION_PARALLEL=5 must run 2 at a time with a cap message, events: $(tr '\n' ',' <<<"$EVENTS")"; fi
s3=$(grep -n -E -e '^start 3 ' <<<"$EVENTS" | head -1 | cut -d: -f1); e1=$(line_of 'end 1'); e2=$(line_of 'end 2')
if [[ -n "$s3" && -n "$e1" && -n "$e2" && $s3 -gt $e1 && $s3 -gt $e2 ]]; then pass; else
    fail "INTEGRATION_PARALLEL=5 is capped at 2, so shard 3 must wait for shards 1 and 2, events: $(tr '\n' ',' <<<"$EVENTS")"; fi
run_case INTEGRATION_PARALLEL=abc STUB_BARRIER_SECS=0
if [[ $(grep -c '^overlap' <<<"$EVENTS") -eq 0 && $RC -eq 0 ]] && grep -q 'not a positive integer' <<<"$OUT"; then pass; else
    fail "INTEGRATION_PARALLEL=abc must fall back to serial with a message, rc=$RC events: $(tr '\n' ',' <<<"$EVENTS")"; fi

# ----- a failed shard stops its still-running partner (review m5) -----
CURRENT_TEST_NAME="INTEGRATION_PARALLEL=2: shard 1 fails while shard 2 hangs -> shard 2 is stopped"
t0=$(date +%s)
run_case INTEGRATION_PARALLEL=2 STUB_BARRIER_SECS=0 STUB_NPX_FAIL_SHARD=1 STUB_NPX_HANG_SHARD=2 STUB_HANG_SECS=20
elapsed=$(( $(date +%s) - t0 ))
if [[ $RC -ne 0 ]]; then pass; else fail "a failed shard must fail the tier, got rc=0"; fi
if [[ $elapsed -lt 15 ]]; then pass; else
    fail "the hung partner must be killed, not waited out: took ${elapsed}s (hang is 20s)"; fi
if ! grep -q -x -e 'end 2' <<<"$EVENTS"; then pass; else
    fail "shard 2 must be stopped before it ends, events: $(tr '\n' ',' <<<"$EVENTS")"; fi
if grep -q -x -e '=== Shard results: FAIL STOPPED ===' <<<"$OUT"; then pass; else
    fail "expected 'Shard results: FAIL STOPPED', got: $(grep 'Shard results' <<<"$OUT" || echo '<none>')"; fi
expected_missing=$((TOTAL_SPECS - 1))
if grep -E -q -e "^${expected_missing} spec\(s\) never ran or did not finish:" <<<"$OUT"; then pass; else
    fail "expected '${expected_missing} spec(s) never ran' (only shard 1 reported), got: $(grep -E 'never ran|reported a result' <<<"$OUT" || echo '<no report>')"; fi

CURRENT_TEST_NAME="INTEGRATION_PARALLEL=2: shard 2 fails while shard 1 hangs -> shard 1 is stopped (wait -n)"
if bash -c '(( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 3) ))'; then
    t0=$(date +%s)
    run_case INTEGRATION_PARALLEL=2 STUB_BARRIER_SECS=0 STUB_NPX_FAIL_SHARD=2 STUB_NPX_HANG_SHARD=1 STUB_HANG_SECS=20
    elapsed=$(( $(date +%s) - t0 ))
    if [[ $RC -ne 0 && $elapsed -lt 15 ]] && ! grep -q -x -e 'end 1' <<<"$EVENTS"; then pass; else
        fail "a later shard's failure must stop the earlier hung one: rc=$RC ${elapsed}s, events: $(tr '\n' ',' <<<"$EVENTS")"; fi
    if grep -q -x -e '=== Shard results: STOPPED FAIL ===' <<<"$OUT"; then pass; else
        fail "expected 'Shard results: STOPPED FAIL', got: $(grep 'Shard results' <<<"$OUT" || echo '<none>')"; fi
else
    echo "NOTE [$CURRENT_TEST_FILE] bash ${BASH_VERSION} has no wait -n; the runner's bash 5 covers this case."
fi

# ----- the fleet runner only inherits RL_SLOT/RL_TARGET, so a flag carries it -----
CURRENT_TEST_NAME="--integration-parallel=2 (flag, whole script) runs shards two at a time"
rm -rf "$WORK/state"; mkdir -p "$WORK/state"
OUT=$(
    cd "$REPO_ROOT" && env -u INTEGRATION_PARALLEL -u INTEGRATION_SHARDS -u CI -u DATABASE_URL \
        PATH="$STUB_BIN:$PATH" RL_TARGET=remote RL_TARGET_DISPATCHED=1 RL_SLOT=1 \
        STUB_STATE="$WORK/state" STUB_SPEC_LIST="$SPEC_LIST" STUB_BARRIER_SECS=10 \
        bash "$VALIDATE_CI_PATH" --only-integration --integration-parallel=2 2>&1
)
RC=$?
EVENTS=$(cat "$WORK/state/events" 2>/dev/null || true)
if grep -q -x -e 'overlap 1' <<<"$EVENTS" && grep -q -x -e 'overlap 2' <<<"$EVENTS"; then pass; else
    fail "--integration-parallel=2 must run shards 1+2 together, rc=$RC events: $(tr '\n' ',' <<<"$EVENTS") tail: $(tail -4 <<<"$OUT" | tr '\n' '|')"; fi
if grep -q -e '2 at a time' <<<"$OUT"; then pass; else
    fail "--integration-parallel=2 must announce the parallel mode, got: $(grep -m1 '=== Integration' <<<"$OUT" || echo '<none>')"; fi

rm -rf "$WORK"
echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
[[ $TEST_FAIL_COUNT -eq 0 ]]
