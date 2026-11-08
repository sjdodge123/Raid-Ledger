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
#   review r1 (Codex + Opus):
#   R-i  runner clean keeps sockets, tmux-*, runner-heartbeat, open files (P1)
#   R-j  malformed ledger = busy; ledger entries resolve slots via task_id (P2)
#   R-k  unreadable env registry aborts the image rung (P2)
#   R-l  RepoDigests-pinned + Dockerfile base images are protected (P2)
#   R-m  failed removals are not counted as reclaimed (P2)
#   R-n  the runner slot is reserved in claims.json for the clean, then the
#        original row restored; a queued claimant keeps it busy (MAJOR)
#   R-o  the image rung is skipped while any task (light included) runs
#   review r2:
#   R-p  the restore never runs lease-advance (MAJOR-1); exec failure still
#        restores; a row taken over meanwhile is not overwritten; the
#        in-lock re-check refuses (MINOR-2)
#   R-q  recover_orphans restores a leftover reservation from its save file
#        (else resets it) and drops stray save files (MAJOR-2)
#   R-r  sweep.sh restores an orphaned reservation before §1 — the unstamped
#        env on that slot is kept (MAJOR-2)
#   R-s  §1/§1b' never reap a row held by gc-sweeper:disk-retention (MAJOR-2)

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
[[ -n "${DOCKER_RM_FAIL:-}" && "$*" == *" rm "*"$DOCKER_RM_FAIL"* ]] && { echo "refused" >&2; exit 1; }
case "$*" in
    "ps "*"rl.slot="*) echo "keepslug keepcid001 rl-env-keepslug-allinone" ;;
    "ps -aq"*) cat "$DOCKER_FIX/container_ids" ;;
    "ps --filter label=rl.role=runner"*) cat "$DOCKER_FIX/runners" ;;
    "container inspect"*) cat "$DOCKER_FIX/containers.json" ;;
    "image ls"*) cat "$DOCKER_FIX/image_ids" ;;
    "image inspect"*) cat "$DOCKER_FIX/images.json" ;;
    "exec "*) cp "$STATE_DIR/claims.json" "$DOCKER_FIX/claims_at_exec"
        [[ -n "${DOCKER_EXEC_HOOK:-}" ]] && sh -c "$DOCKER_EXEC_HOOK"
        [[ -n "${DOCKER_EXEC_FAIL:-}" ]] && exit 1
        echo "1000 200" ;;
    *) echo ok ;;
esac
STUB
    chmod +x "$BIN/docker"
    # macOS has no flock(1); FLOCK_HOOK plays a claim landing inside the lock.
    printf '#!/bin/sh\n[ -n "$FLOCK_HOOK" ] && sh -c "$FLOCK_HOOK"\nexit 0\n' > "$BIN/flock"; chmod +x "$BIN/flock"
    export PATH="$BIN:$PATH"
    export STATE_DIR="$TMP_STATE" TASKS_DIR="$TMP_STATE/tasks"
    export RL_DISK_RETENTION_DRY_RUN=0 RL_DISK_RETENTION_INTERVAL_HOURS=0
    unset RL_DISK_RETENTION_STATE_FILE RL_ADMISSION_FILE RL_ENVS_FILE RL_CLAIMS_FILE DOCKER_FAIL DOCKER_RM_FAIL RL_LOCK_DIR LOCK_DIR LEASE_QUEUE_DIR \
        DOCKER_EXEC_HOOK DOCKER_EXEC_FAIL FLOCK_HOOK
    rm -rf "$TMP_STATE/lease-queue" "$TMP_STATE"/disk-retention-reserve-*.json "$TMP_STATE/audit.log" "$FIX/claims_at_exec"
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
    assert_eq "$rm_line" $'docker container rm c-plain\ndocker container rm c-dead' "R-a only old stopped non-env non-compose containers are removed"
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
    assert_eq "$rm_lines" $'docker image rm junk:1\ndocker image rm sha256:dangling\ndocker image rm a:1 b:2' "R-b only unused, unreferenced, old images are removed (by tag, else id)"
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
    local execs; execs=$(sed -n '/docker exec/,$p' <<<"$DLOG")
    assert_eq "$(grep -c "docker exec" <<<"$DLOG")" "1" "R-c exactly one runner cleaned"
    assert_contains "$execs" "exec rl-runner-2 " "R-c the idle runner (slot 2) is the one cleaned"
    assert_contains "$execs" "R='/tmp'" "R-c the clean targets /tmp"
    assert_contains "$execs" '-type f -mmin +$M' "R-c only regular files older than TMP_AGE_MINUTES are deleted"
    assert_contains "$execs" "M='60'" "R-c default age is 60 min"
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
    assert_eq "$(jq -c '[.containers.would_reclaim_bytes, .images.would_reclaim_bytes, .images.bytes]' <<<"$RESULT")" \
        '[100,1000,0]' "R-d dry run reports the would-reclaim estimate, reclaims 0"
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
    lr=$(grep -n 'disk_retention::sweep 2>' "$SWEEP_SCRIPT" | head -1 | cut -d: -f1)
    l3b=$(grep -n '^# 3b\. ROK-1568' "$SWEEP_SCRIPT" | cut -d: -f1)
    assert_neq "${lr:-}" "" "R-g sweep.sh calls disk_retention::sweep"
    assert_eq "$(( ${lr:-0} > ${l3:-0} && ${lr:-0} < ${l3b:-0} ))" "1" "R-g retention runs after step 3 and before 3b"
    assert_contains "$(cat "$SWEEP_SCRIPT")" 'disk_retention::sweep' "R-g sweep.sh calls disk_retention::sweep"
}

test_keep_n_default() {
    local v
    v=$(unset RL_REGISTRY_KEEP_N; source "$REG_LIB" >/dev/null 2>&1; echo "$RL_REGISTRY_KEEP_N")
    assert_eq "$v" "15" "R-h RL_REGISTRY_KEEP_N defaults to 15"
}


# R-i (P1): run the real runner script against a scratch /tmp + fake /proc.
test_runner_script_keeps_live_paths() {
    _setup
    source "$LIB"
    local R="$TMP_STATE/rtmp" P="$TMP_STATE/proc" f
    mkdir -p "$R/tmux-0" "$R/cachedir" "$R/emptydir" "$R/workdir" "$P/42/fd"
    for f in old.log tmux-0/default runner-heartbeat busy.log app.lock cachedir/blob; do echo x > "$R/$f"; done
    python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])" "$R/live.sock2" 2>/dev/null
    echo y > "$R/young.log"
    mkdir -p "$P/43"; echo x > "$R/workdir/inner.log"
    ln -s "$R/busy.log" "$P/42/fd/3"; ln -s "$R/workdir" "$P/42/cwd"; ln -s "$R" "$P/43/cwd"
    find "$R" -mindepth 1 ! -name young.log -exec touch -h -t 202601010000 {} +
    out=$(RL_DISK_RETENTION_TMP_AGE_MINUTES=60 sh -c "$(disk_retention::_runner_script "$R" "$P")" 2>&1)
    assert_file_not_exists "$R/old.log" "R-i an old regular file is deleted"
    assert_file_not_exists "$R/cachedir/blob" "R-i an old cache file in a subdir is deleted"
    assert_file_exists "$R/tmux-0/default" "R-i the tmux socket dir (tmux-*) is never touched"
    assert_file_exists "$R/runner-heartbeat" "R-i runner-heartbeat is kept"
    assert_file_exists "$R/busy.log" "R-i a file a process holds open is kept"
    assert_file_exists "$R/app.lock" "R-i a *.lock file is kept"
    assert_file_exists "$R/young.log" "R-i a young file is kept"
    assert_eq "$([[ -d "$R/workdir" ]] && echo kept)" "kept" "R-i a process's cwd is kept even when empty"
    assert_file_exists "$R/workdir/inner.log" "R-i an old file inside a process's cwd is kept (review r2 MINOR-3)"
    if [[ -S "$R/live.sock2" ]]; then
        assert_eq "$([[ -S "$R/live.sock2" ]] && echo kept)" "kept" "R-i a unix socket is never deleted"
    fi
    assert_contains "$out" " " "R-i the script prints '<before> <after>'"
}

# R-j (P2): admission ledger shape is heavy_running/heavy_waiting with
# key + task_id (no .slot); slots resolve through the task JSON.
test_ledger_shape_and_fail_safe() {
    _setup
    source "$LIB"
    echo '[{"slot":1,"claimed":false},{"slot":2,"claimed":false},{"slot":3,"claimed":false}]' > "$TMP_STATE/claims.json"
    echo '{"status":"queued","slot":2}' > "$TMP_STATE/tasks/local-abc.json"
    echo '{"heavy_running":[],"heavy_waiting":[{"key":"k-xyz","task_id":"local-abc","weight":"medium","kind":"task"}]}' > "$TMP_STATE/admission.json"
    disk_retention::_slot_busy 2; assert_eq "$?" "0" "R-j a waiting entry is matched to its slot via .task_id"
    disk_retention::_slot_busy 1; assert_eq "$?" "1" "R-j another slot stays idle"
    echo '{"heavy_running":[{"key":"gc","kind":"registry_gc"}]}' > "$TMP_STATE/admission.json"
    disk_retention::_slot_busy 1; assert_eq "$?" "1" "R-j a registry_gc entry does not make a runner busy"
    echo '{"heavy_running":[{"key":"orphan","weight":"light"}]}' > "$TMP_STATE/admission.json"
    disk_retention::_slot_busy 1; assert_eq "$?" "0" "R-j an entry whose slot cannot be resolved counts as busy"
    echo 'not json{' > "$TMP_STATE/admission.json"
    disk_retention::_slot_busy 1; assert_eq "$?" "0" "R-j a malformed ledger counts as busy"
    echo '[1,2]' > "$TMP_STATE/admission.json"
    disk_retention::_slot_busy 1; assert_eq "$?" "0" "R-j a ledger that is not an object counts as busy"
}

# R-k (P2): an unreadable env registry aborts the image rung.
test_env_registry_unreadable_aborts() {
    _setup
    _image sha256:dangling "$OLD" '[]' '{}' | jq -s . > "$FIX/images.json"; echo x > "$FIX/image_ids"
    local bad
    for bad in missing malformed object; do
        case "$bad" in
            missing) rm -f "$TMP_STATE/env-registry.json" ;;
            malformed) echo 'nope{' > "$TMP_STATE/env-registry.json" ;;
            object) echo '{"s1":{"image":"x"}}' > "$TMP_STATE/env-registry.json" ;;
        esac
        : > "$DOCKER_LOG"; _run
        assert_eq "$(grep -c 'image rm' <<<"$DLOG")" "0" "R-k $bad env registry → no image removed"
        assert_eq "$(jq -r '.images.error' <<<"$RESULT")" "images_failed" "R-k $bad env registry → the image rung reports an error"
    done
}

# R-l (P2 + MINOR): repo@digest pins and Dockerfile base images survive.
test_digest_and_base_images_protected() {
    _setup
    echo '[{"slug":"s1","image":"registry.rl.lan:5000/rl-allinone:t1@sha256:aaa"}]' > "$TMP_STATE/env-registry.json"
    {
        _image sha256:pinned "$OLD" '["registry.rl.lan:5000/rl-allinone:old"]' '{}' \
            | jq -c '.RepoDigests = ["registry.rl.lan:5000/rl-allinone@sha256:aaa"]'
        _image sha256:base "$OLD" '["node:22-alpine"]' '{}'
        _image sha256:pw "$OLD" '["mcr.microsoft.com/playwright:v1.64.1-jammy"]' '{}'
        _image sha256:junk "$OLD" '["junk:1"]' '{}'
    } | jq -s . > "$FIX/images.json"; echo x > "$FIX/image_ids"
    _run
    assert_eq "$(grep 'image rm' <<<"$DLOG")" "docker image rm junk:1" "R-l only the unpinned, non-base image is removed"
}

# R-m (P2): a refused removal is neither counted nor sized.
test_failed_removals_not_counted() {
    _setup
    {
        _container c-ok exited "$OLD" sha256:i1 '{}'
        _container c-stuck exited "$OLD" sha256:i2 '{}'
    } | jq -s . > "$FIX/containers.json"; printf 'c-ok\nc-stuck\n' > "$FIX/container_ids"
    export DOCKER_RM_FAIL=c-stuck
    _run
    assert_eq "$(jq -c '[.containers.removed, .containers.bytes, .containers.failed, .containers.error]' <<<"$RESULT")" \
        '[1,100,["c-stuck"],"remove_failed"]' "R-m only the successful removal is counted; the failure is reported"
}

# R-n (MAJOR): reserve the slot under the claims lock for the clean.
test_runner_slot_reserved_then_restored() {
    _setup
    echo rl-runner-2 > "$FIX/runners"
    local row='{"slot":2,"claimed":false,"branch":"rok-1-keep","agent_id":null}'
    echo "[$row]" > "$TMP_STATE/claims.json"
    _run
    assert_eq "$(jq -c '.[0] | [.claimed, .agent_id]' "$FIX/claims_at_exec" 2>/dev/null)" '[true,"gc-sweeper:disk-retention"]' \
        "R-n the slot is claimed by the sweeper while the clean runs"
    assert_eq "$(jq -c '.[0]' "$TMP_STATE/claims.json")" "$(jq -c . <<<"$row")" "R-n the original row (branch included) is restored after"
    _setup
    echo rl-runner-2 > "$FIX/runners"
    echo '[{"slot":2,"claimed":false}]' > "$TMP_STATE/claims.json"
    mkdir -p "$TMP_STATE/lease-queue"; echo '[{"agent_id":"a1"}]' > "$TMP_STATE/lease-queue/2.json"
    _run
    assert_eq "$(grep -c 'docker exec' <<<"$DLOG")" "0" "R-n a queued claimant keeps the runner busy"
    assert_eq "$(jq -c '.runners.busy' <<<"$RESULT")" '[2]' "R-n slot 2 reported busy"
}

# R-o (MINOR): no image is untagged while any task or build runs.
test_image_rung_build_guard() {
    _setup
    _image sha256:junk "$OLD" '["junk:1"]' '{}' | jq -s . > "$FIX/images.json"; echo x > "$FIX/image_ids"
    echo '{"heavy_running":[{"key":"t-light","kind":"task","weight":"light"}]}' > "$TMP_STATE/admission.json"
    _run
    assert_eq "$(grep -c 'image rm' <<<"$DLOG")" "0" "R-o no image removed while a light task runs"
    assert_eq "$(jq -c '[.images.skipped, .images.blocked_by]' <<<"$RESULT")" '["build_running",["t-light"]]' "R-o skip reason recorded"
}

_iso_ago() { date -u -d "now - $1 seconds" +%FT%TZ 2>/dev/null || date -u -v-"$1"S +%FT%TZ; }
_slot2() { jq -c '.[] | select(.slot == 2)' "$TMP_STATE/claims.json"; }
_reserved_row() { # heartbeat/start 9h old: §1 and §1b' would both fire on a normal row
    jq -nc --arg t "$(_iso_ago 32400)" '{slot:2, claimed:true, agent_id:"gc-sweeper:disk-retention", branch:"rok-1-keep",
        started_at:$t, last_heartbeat:$t, expires_at:null, keep_alive:false, extends_count:0}'
}

# R-p (review r2 MAJOR-1 + MINOR-2): restore paths of the reservation.
test_reservation_restore_paths() {
    local row='{"slot":2,"claimed":false,"branch":"rok-1-keep","agent_id":null}' copy
    _setup; echo rl-runner-2 > "$FIX/runners"; echo "[$row]" > "$TMP_STATE/claims.json"
    copy="$TMP_STATE/libcopy"; mkdir -p "$copy"; cp "$LIB" "$copy/"
    printf '#!/bin/sh\necho called >> %q\n' "$TMP_STATE/lease-advance.log" > "$copy/lease-advance"; chmod +x "$copy/lease-advance"
    mkdir -p "$TMP_STATE/lease-queue"
    export DOCKER_EXEC_HOOK="echo '[{\"agent_id\":\"a1\"}]' > '$TMP_STATE/lease-queue/2.json'"
    LIB="$copy/_disk_retention.sh" _run
    assert_file_not_exists "$TMP_STATE/lease-advance.log" "R-p lease-advance is never run, even with a claimant queued mid-clean"
    assert_eq "$(_slot2)" "$(jq -c . <<<"$row")" "R-p the original row is restored with a claimant queued"
    assert_file_not_exists "$TMP_STATE/disk-retention-reserve-2.json" "R-p the save file is dropped after the restore"
    _setup; echo rl-runner-2 > "$FIX/runners"; echo "[$row]" > "$TMP_STATE/claims.json"
    export DOCKER_EXEC_FAIL=1; _run
    assert_eq "$(grep -c 'docker exec' <<<"$DLOG")" "1" "R-p (exec-failure case) the runner was exec'd"
    assert_eq "$(_slot2)" "$(jq -c . <<<"$row")" "R-p a failed exec still restores the row"
    assert_eq "$(jq -c '.runners.cleaned' <<<"$RESULT")" '[]' "R-p a failed exec is not reported cleaned"
    _setup; echo rl-runner-2 > "$FIX/runners"; echo "[$row]" > "$TMP_STATE/claims.json"
    export DOCKER_EXEC_HOOK="jq -c 'map(.agent_id = \"other\")' '$TMP_STATE/claims.json' > '$TMP_STATE/c.tmp' && mv '$TMP_STATE/c.tmp' '$TMP_STATE/claims.json'"
    _run
    assert_eq "$(grep -c 'docker exec' <<<"$DLOG")" "1" "R-p (takeover case) the runner was exec'd"
    assert_eq "$(_slot2 | jq -r .agent_id)" "other" "R-p a row taken over meanwhile is not overwritten"
    _setup; echo rl-runner-2 > "$FIX/runners"; echo "[$row]" > "$TMP_STATE/claims.json"; mkdir -p "$TMP_STATE/lease-queue"
    export FLOCK_HOOK="echo '[{\"agent_id\":\"a1\"}]' > '$TMP_STATE/lease-queue/2.json'"
    _run; unset FLOCK_HOOK
    assert_eq "$(grep -c 'docker exec' <<<"$DLOG")" "0" "R-p busy as seen inside the lock -> refused, not exec'd"
    assert_eq "$(_slot2)" "$(jq -c . <<<"$row")" "R-p a refused reservation leaves the row untouched"
    assert_file_not_exists "$TMP_STATE/disk-retention-reserve-2.json" "R-p a refused reservation leaves no save file"
}

# R-q (review r2 MAJOR-2): cycle-start recovery in the lib.
test_recover_orphans() {
    local orig='{"slot":2,"claimed":false,"branch":"rok-1-keep","agent_id":null}' out
    _setup; source "$LIB"
    jq -n --argjson r "$(_reserved_row)" '[{slot:1, claimed:true, agent_id:"owner"}, $r, ($r | .slot = 3)]' > "$TMP_STATE/claims.json"
    echo "$orig" > "$TMP_STATE/disk-retention-reserve-2.json"
    echo '{"slot":4,"claimed":false}' > "$TMP_STATE/disk-retention-reserve-4.json"
    out=$(disk_retention::recover_orphans 2>/dev/null)
    assert_eq "$(tr '\n' ' ' <<<"$out")" "2 3 " "R-q both orphaned reservations restored"
    assert_eq "$(_slot2)" "$(jq -c . <<<"$orig")" "R-q slot 2 restored from its save file (branch kept)"
    assert_eq "$(jq -c '.[] | select(.slot == 3) | [.claimed, .agent_id, .branch]' "$TMP_STATE/claims.json")" '[false,null,null]' \
        "R-q slot 3 (no save file) reset to unclaimed"
    assert_eq "$(jq -c '.[] | select(.slot == 1) | .agent_id' "$TMP_STATE/claims.json")" '"owner"' "R-q other rows untouched"
    assert_file_not_exists "$TMP_STATE/disk-retention-reserve-2.json" "R-q the used save file is removed"
    assert_file_not_exists "$TMP_STATE/disk-retention-reserve-4.json" "R-q a stray save file with no reservation is removed"
}

_sweep_sh() {
    echo '[]' > "$TMP_STATE/queue.json"
    PATH="$BIN:$PATH" STATE_DIR="$TMP_STATE" RL_STATE_DIR="$TMP_STATE" TASKS_DIR="$TMP_STATE/tasks" \
        CLAIM_HEARTBEAT_TIMEOUT_SECONDS=120 RL_DISK_RETENTION_DRY_RUN=1 DISK_RETENTION_LIB="$1" \
        bash "$SWEEP_SCRIPT" >"$TMP_STATE/sweep.out" 2>&1 || true
    DLOG=$(cat "$DOCKER_LOG")
}

# R-r (review r2 MAJOR-2): the next sweep restores the orphan before §1.
test_sweep_restores_orphan_before_reapers() {
    local orig='{"slot":2,"claimed":false,"branch":"rok-1-keep","agent_id":null}'
    _setup; echo "[$(_reserved_row)]" > "$TMP_STATE/claims.json"; echo "$orig" > "$TMP_STATE/disk-retention-reserve-2.json"
    _sweep_sh "$LIB"
    assert_eq "$(_slot2)" "$(jq -c . <<<"$orig")" "R-r the orphaned reservation is restored, not reaped"
    assert_eq "$(grep -E '^docker (rm|volume|container rm)' <<<"$DLOG" | grep -c keep)" "0" "R-r the slot's unstamped env is not destroyed"
    assert_contains "$(cat "$TMP_STATE/audit.log" 2>/dev/null)" "disk_retention_reservation_restored" "R-r restore audited"
}

# R-s (review r2 MAJOR-2 belt and braces): reapers skip the sweeper's agent id.
test_reapers_skip_sweeper_agent() {
    _setup; echo "[$(_reserved_row)]" > "$TMP_STATE/claims.json"
    _sweep_sh "$TMP_STATE/no-such-lib.sh"
    assert_eq "$(_slot2 | jq -c '[.claimed, .agent_id]')" '[true,"gc-sweeper:disk-retention"]' "R-s §1/§1b' leave the sweeper's row alone"
    assert_eq "$(grep -E '^docker (rm|volume|container rm)' <<<"$DLOG" | grep -c keep)" "0" "R-s no env reaped for the sweeper's row"
}

run_test "R-a container rung" test_container_rung
run_test "R-b image rung" test_image_rung
run_test "R-c idle-runner rung" test_idle_runner_rung
run_test "R-d dry run" test_dry_run
run_test "R-e docker failure" test_docker_failure_never_fatal
run_test "R-f interval gate" test_interval_gate
run_test "R-g sweep wiring" test_sweep_wiring
run_test "R-h keep-N default" test_keep_n_default
run_test "R-i runner clean keeps live paths" test_runner_script_keeps_live_paths
run_test "R-j ledger shape + fail safe" test_ledger_shape_and_fail_safe
run_test "R-k env registry unreadable" test_env_registry_unreadable_aborts
run_test "R-l digest + base images protected" test_digest_and_base_images_protected
run_test "R-m failed removals not counted" test_failed_removals_not_counted
run_test "R-n runner slot reserved" test_runner_slot_reserved_then_restored
run_test "R-o image rung build guard" test_image_rung_build_guard
run_test "R-p reservation restore paths" test_reservation_restore_paths
run_test "R-q recover orphaned reservations" test_recover_orphans
run_test "R-r sweep restores orphan before reapers" test_sweep_restores_orphan_before_reapers
run_test "R-s reapers skip the sweeper agent" test_reapers_skip_sweeper_agent
print_test_summary
