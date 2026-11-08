#!/usr/bin/env bash
# ROK-2111 lane 2 — interval disk retention (gc-sweeper step 3a).
#
# The ladder only fires at >= RL_DISK_PRUNE_PCT, so between alarms the host
# silted up with week-old Exited containers, unused images and runner /tmp +
# npm caches. `_disk_retention.sh` runs three rungs on an interval:
#   containers  stopped > 24h, never rl.role=env/runner/infra, never the
#               rl-infra compose project
#   images      unused > 48h, never one a container (running OR stopped) uses,
#               an env-registry row references, labelled rl.role=runner or
#               tagged rl-infra/* (locally built compose images)
#   runners     /tmp (> 60 min) + npm cache on runners with no claim, no
#               running task and no admission entry; NEVER /root/.cache
#
# docker is a stub EXECUTABLE on PATH (not a shell function) so the lib's
# `timeout docker …` wrapper reaches it.
#
# Covered:
#   R-a  container rung: env label, compose project, running, young excluded
#   R-b  image rung: in-use (stopped env container), env-registry ref,
#        rl.role=runner, rl-infra/ tag and young images protected; never -f
#   R-c  idle-runner rung: only the idle slot is exec'd; /root/.cache untouched
#   R-d  dry run lists candidates and removes/execs nothing
#   R-e  a failing docker never fails the sweep (rc 0, JSON out)
#   R-f  interval gate: a recent run is skipped with no docker call
#   R-g  sweep.sh sources the lib between step 3 and step 3b
#   R-h  RL_REGISTRY_KEEP_N defaults to 15

set -uo pipefail

CURRENT_TEST_FILE="disk-retention.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

LIB="$(cd "$TEST_DIR/../bin" && pwd)/_disk_retention.sh"
REG_LIB="$(cd "$TEST_DIR/../bin" && pwd)/_registry_gc.sh"
SWEEP_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"

OLD="2026-01-01T00:00:00.123456789Z"
YOUNG="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Fixture-backed docker stub + fresh state for one scenario.
_setup() {
    FIX="$TMP_STATE/fix"; BIN="$TMP_STATE/bin"
    mkdir -p "$FIX" "$BIN" "$TMP_STATE/tasks"
    export DOCKER_FIX="$FIX" DOCKER_LOG="$TMP_STATE/docker.log"
    : > "$DOCKER_LOG"
    cat > "$BIN/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$DOCKER_LOG"
[[ -n "${DOCKER_FAIL:-}" ]] && { echo "boom" >&2; exit 1; }
case "$*" in
    "ps -aq"*) cat "$DOCKER_FIX/container_ids" ;;
    "ps --filter label=rl.role=runner"*) cat "$DOCKER_FIX/runners" ;;
    "container inspect"*) cat "$DOCKER_FIX/containers.json" ;;
    "image ls"*) cat "$DOCKER_FIX/image_ids" ;;
    "image inspect"*) cat "$DOCKER_FIX/images.json" ;;
    "exec "*) echo "1000 200" ;;
    *) echo ok ;;
esac
STUB
    chmod +x "$BIN/docker"
    export PATH="$BIN:$PATH"
    export STATE_DIR="$TMP_STATE" TASKS_DIR="$TMP_STATE/tasks"
    export RL_DISK_RETENTION_DRY_RUN=0 RL_DISK_RETENTION_INTERVAL_HOURS=0
    unset RL_DISK_RETENTION_STATE_FILE RL_ADMISSION_FILE RL_ENVS_FILE RL_CLAIMS_FILE DOCKER_FAIL
    echo '[]' > "$TMP_STATE/claims.json"
    echo '[]' > "$TMP_STATE/env-registry.json"
    echo '{"heavy_running":[]}' > "$TMP_STATE/admission.json"
    : > "$FIX/container_ids"; echo '[]' > "$FIX/containers.json"
    : > "$FIX/runners"; : > "$FIX/image_ids"; echo '[]' > "$FIX/images.json"
}

_container() { # id status created image labels-json
    jq -nc --arg id "$1" --arg s "$2" --arg c "$3" --arg img "$4" --argjson l "$5" \
        '{Id:$id, Created:$c, Image:$img, State:{Status:$s}, Config:{Image:"x", Labels:$l}, SizeRw:100}'
}
_image() { # id created tags-json labels-json
    jq -nc --arg id "$1" --arg c "$2" --argjson t "$3" --argjson l "$4" \
        '{Id:$id, Created:$c, RepoTags:$t, Size:1000, Config:{Labels:$l}}'
}
_run() {
    # shellcheck disable=SC1090
    source "$LIB"
    RESULT=$(disk_retention::sweep 2>"$TMP_STATE/stderr"); RC=$?
    DLOG=$(cat "$DOCKER_LOG")
}

test_container_rung() {
    _setup
    {
        _container c-plain exited "$OLD" sha256:i1 '{}'
        _container c-env exited "$OLD" sha256:i2 '{"rl.role":"env"}'
        _container c-compose exited "$OLD" sha256:i3 '{"com.docker.compose.project":"rl-infra"}'
        _container c-running running "$OLD" sha256:i4 '{}'
        _container c-young exited "$YOUNG" sha256:i5 '{}'
        _container c-dead dead "$OLD" sha256:i6 '{"com.docker.compose.project":"other"}'
    } | jq -s . > "$FIX/containers.json"
    printf 'c-plain\nc-env\nc-compose\nc-running\nc-young\nc-dead\n' > "$FIX/container_ids"
    _run
    local rm_line; rm_line=$(grep "container rm" <<<"$DLOG")
    assert_eq "$RC" "0" "R-a sweep returns 0"
    assert_eq "$rm_line" "docker container rm c-plain c-dead" "R-a only old stopped non-env non-compose containers are removed"
    assert_eq "$(jq -r '.containers.removed' <<<"$RESULT")" "2" "R-a removed count reported"
    assert_eq "$(jq -r '.containers.bytes' <<<"$RESULT")" "200" "R-a reclaimed bytes reported"
}

test_image_rung() {
    _setup
    _container c-env exited "$OLD" sha256:inuse '{"rl.role":"env"}' | jq -s . > "$FIX/containers.json"
    echo c-env > "$FIX/container_ids"
    echo '[{"slug":"s1","image":"localhost:5000/rl-allinone:keep"}]' > "$TMP_STATE/env-registry.json"
    {
        _image sha256:old '' '["junk:1"]' '{}'
        _image sha256:dangling "$OLD" '[]' '{}'
        _image sha256:inuse "$OLD" '["localhost:5000/rl-allinone:used"]' '{}'
        _image sha256:envref "$OLD" '["localhost:5000/rl-allinone:keep"]' '{}'
        _image sha256:runner "$OLD" '["runner-img:1"]' '{"rl.role":"runner"}'
        _image sha256:local "$OLD" '["rl-infra/gc-sweeper:latest"]' '{}'
        _image sha256:young "$YOUNG" '["fresh:1"]' '{}'
        _image sha256:multi "$OLD" '["a:1","b:2"]' null
    } | jq -s --arg old "$OLD" 'map(if .Id == "sha256:old" then .Created = $old else . end)' > "$FIX/images.json"
    printf 'sha256:x\n' > "$FIX/image_ids"
    _run
    local rm_lines; rm_lines=$(grep "image rm" <<<"$DLOG")
    assert_eq "$rm_lines" "docker image rm junk:1 sha256:dangling a:1 b:2" "R-b only unused, unreferenced, old images are removed (by tag, else id)"
    assert_eq "$(grep -c -- ' -f' <<<"$DLOG")" "0" "R-b nothing is ever force-removed"
    assert_eq "$(jq -r '.images.removed' <<<"$RESULT")" "3" "R-b removed count"
    assert_eq "$(jq -r '.images.bytes' <<<"$RESULT")" "3000" "R-b reclaimed bytes"
}

test_idle_runner_rung() {
    _setup
    printf 'rl-runner-1\nrl-runner-2\nrl-runner-3\nrl-runner-4\n' > "$FIX/runners"
    echo '[{"slot":1,"claimed":true},{"slot":2,"claimed":false}]' > "$TMP_STATE/claims.json"
    echo '{"status":"running","slot":3}' > "$TMP_STATE/tasks/t3.json"
    echo '{"status":"succeeded","slot":2}' > "$TMP_STATE/tasks/t2.json"
    echo '{"status":"queued","slot":4}' > "$TMP_STATE/tasks/t4.json"
    echo '{"heavy_running":[{"key":"t4","weight":"heavy"}]}' > "$TMP_STATE/admission.json"
    _run
    local execs; execs=$(grep "docker exec" <<<"$DLOG")
    assert_eq "$(grep -c "docker exec" <<<"$DLOG")" "1" "R-c exactly one runner cleaned"
    assert_contains "$execs" "exec rl-runner-2 " "R-c the idle runner (slot 2) is the one cleaned"
    assert_contains "$execs" "find /tmp -xdev -mindepth 1 -mmin +60" "R-c /tmp cleared of files older than 60 min"
    assert_contains "$execs" "npm cache clean --force" "R-c npm cache cleaned"
    assert_eq "$(grep -c '\.cache' <<<"$execs")" "0" "R-c /root/.cache (Playwright browsers) is never touched"
    assert_eq "$(jq -c '.runners.cleaned' <<<"$RESULT")" '[2]' "R-c cleaned slots reported"
    assert_eq "$(jq -c '.runners.busy' <<<"$RESULT")" '[1,3,4]' "R-c busy slots reported"
    assert_eq "$(jq -r '.runners.bytes' <<<"$RESULT")" "819200" "R-c reclaimed bytes from du before/after"
}

test_dry_run() {
    _setup
    _container c-plain exited "$OLD" sha256:i1 '{}' | jq -s . > "$FIX/containers.json"
    echo c-plain > "$FIX/container_ids"
    _image sha256:dangling "$OLD" '[]' '{}' | jq -s . > "$FIX/images.json"; echo x > "$FIX/image_ids"
    echo rl-runner-2 > "$FIX/runners"
    export RL_DISK_RETENTION_DRY_RUN=1
    _run
    assert_eq "$(grep -cE ' rm |docker exec' <<<"$DLOG")" "0" "R-d dry run removes and execs nothing"
    assert_eq "$(jq -c '[.dry_run, .containers.candidates, .images.candidates, .runners.idle]' <<<"$RESULT")" \
        '[true,["c-plain"],["sha256:dangling"],[2]]' "R-d dry run reports the candidates"
}

test_docker_failure_never_fatal() {
    _setup
    export DOCKER_FAIL=1
    _run
    assert_eq "$RC" "0" "R-e a failing docker never fails the sweep"
    assert_eq "$(jq -r 'type' <<<"$RESULT" 2>/dev/null)" "object" "R-e still emits a JSON summary"
}

test_interval_gate() {
    _setup
    export RL_DISK_RETENTION_INTERVAL_HOURS=6
    jq -nc --argjson t "$(date +%s)" '{last_run_epoch:$t}' > "$TMP_STATE/disk-retention.json"
    _run
    assert_eq "$(jq -r '.skipped' <<<"$RESULT")" "interval" "R-f skipped inside the interval"
    assert_eq "$DLOG" "" "R-f no docker call inside the interval"
    export RL_DISK_RETENTION_INTERVAL_HOURS=0
}

test_sweep_wiring() {
    local l3 lr l3b
    l3=$(grep -n '^# 3\. Scoped prune' "$SWEEP_SCRIPT" | cut -d: -f1)
    lr=$(grep -n '_disk_retention\.sh' "$SWEEP_SCRIPT" | head -1 | cut -d: -f1)
    l3b=$(grep -n '^# 3b\. ROK-1568' "$SWEEP_SCRIPT" | cut -d: -f1)
    assert_neq "${lr:-}" "" "R-g sweep.sh references _disk_retention.sh"
    assert_eq "$(( ${lr:-0} > ${l3:-0} && ${lr:-0} < ${l3b:-0} ))" "1" "R-g retention runs after step 3 and before 3b"
    assert_contains "$(cat "$SWEEP_SCRIPT")" 'disk_retention::sweep' "R-g sweep.sh calls disk_retention::sweep"
}

test_keep_n_default() {
    local v
    v=$(unset RL_REGISTRY_KEEP_N; source "$REG_LIB" >/dev/null 2>&1; echo "$RL_REGISTRY_KEEP_N")
    assert_eq "$v" "15" "R-h RL_REGISTRY_KEEP_N defaults to 15"
}

run_test "R-a container rung" test_container_rung
run_test "R-b image rung" test_image_rung
run_test "R-c idle-runner rung" test_idle_runner_rung
run_test "R-d dry run" test_dry_run
run_test "R-e docker failure" test_docker_failure_never_fatal
run_test "R-f interval gate" test_interval_gate
run_test "R-g sweep wiring" test_sweep_wiring
run_test "R-h keep-N default" test_keep_n_default
print_test_summary
