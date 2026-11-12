#!/usr/bin/env bash
# CURRENT_TEST_* and RL_* knobs are read by test_helpers.sh / the sourced libs.
# shellcheck disable=SC2034
# ROK-2171 — the gc-sweeper removes unused local rl-allinone images
# (orchestrator/bin/_env_image_gc.sh), with `docker` replaced by a shell
# function — no daemon.
#
# Covered:
#   E1  an image no env/container uses, past the age floor, is removed (no
#       --force) while a registry_gc-kind `env-image-gc` entry is held, and the
#       entry is released afterwards
#   E2  kept when an env row names it: tag under another prefix, exact ref, or
#       a digest pin resolving to the same image ID
#   E3  kept when a container (any state) uses it, or docker ps fails
#   E4  a runner-labelled image is never removed
#   E5  age floor: a recent LastTagTime (cached rebuild, old Created) or a
#       recent Created keeps it; an unparseable age keeps it; floor 0 removes
#   E6  no removal when the ledger refuses: an image build running or waiting,
#       or an unreadable ledger
#   E7  dry run (the default) removes nothing and takes no reservation
#   E8  an unreadable / non-array env registry or image list aborts
#   E9  a failed rm is reported and the entry is still released
#   E10 a renewal lost mid-pass stops the pass (lock_lost)
#   E11 an env row written after the pre-pass is honoured (re-check under the
#       reservation)
#   E12 an image build cannot be admitted while the removal runs
#   E13 sweep.sh runs it before registry GC; run-tests.sh runs us
#   E14 an empty, whitespace-only, truncated, object or multi-document env
#       registry aborts (Codex P2); `[]` is a valid empty registry
#   E15 a row pinned to the bare image ID keeps it (review MINOR-1)
#   E16 release grace (review MAJOR-1): kept until RL_ENV_IMAGE_GC_RELEASE_GRACE_HOURS
#       after env-destroy recorded the release; no record → recorded now and
#       kept; an unwritable record dir keeps it; use clears the record
#   E17 env-destroy records the release before it removes the row
#   E18 review r2 MINOR-1: neither the sweep nor env-destroy creates the record
#       dir; a missing dir is logged once per sweep and keeps every image; a
#       failed env-destroy record write warns and still returns 0
#   E19 review r2 MINOR-2: records with no local image, or older than grace +
#       margin, are pruned; nothing is pruned when the image list is unreadable

set -uo pipefail
CURRENT_TEST_FILE="env-image-gc.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"
BIN="$(cd "$TEST_DIR/../bin" && pwd)"
LIB="${ENV_IMAGE_GC_LIB_UNDER_TEST:-$BIN/_env_image_gc.sh}"
SWEEP="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"
REPO="registry.rl.lan:5000/rl-allinone"
NOW=1800000000   # 2027-01-15; the default image times below are far older
OLD="2026-01-01T00:00:00.123456789Z"
ZERO="0001-01-01T00:00:00Z"

command -v flock >/dev/null 2>&1 || flock() { return 0; }
timeout() { shift; "$@"; }

# docker stub. LOCAL_REFS: `image ls` lines (LS_FAIL=1: fails). META: lines
# "ref|id|role|created|lasttag" (default id sha256:id-of-<ref>, old, untagged
# time zero); ABSENT_REFS / FAIL_REFS: lines answering "No such image" / a
# daemon error. PS_IDS: image ids `ps -aq --filter ancestor=` reports in use
# (PS_FAIL=1: fails). RM_FAIL=1: rm fails. RM_HOOK: a function run on each rm.
_stub_inspect() {
    local ref="$3" line id role created lasttag
    grep -qxF -- "$ref" <<<"${ABSENT_REFS:-}" && { echo "Error: No such image: $ref" >&2; return 1; }
    grep -qxF -- "$ref" <<<"${FAIL_REFS:-}" && { echo "Cannot connect to the Docker daemon" >&2; return 1; }
    line=$(awk -F'|' -v r="$ref" '$1 == r' <<<"${META:-}")
    IFS='|' read -r _ id role created lasttag <<<"$line"
    jq -nc --arg id "${id:-sha256:id-of-$ref}" --arg role "${role:-}" --arg c "${created:-$OLD}" \
        --arg t "${lasttag:-$ZERO}" \
        '[{Id: $id, Created: $c, Metadata: {LastTagTime: $t},
           Config: {Labels: (if $role == "" then null else {"rl.role": $role} end)}}]'
}
docker() {
    echo "docker $*" >> "$CALL_LOG"
    case "$1 ${2:-}" in
        "image ls") [[ -n "${LS_FAIL:-}" ]] && return 1; [[ -n "${LOCAL_REFS:-}" ]] && echo "$LOCAL_REFS"; return 0 ;;
        "image inspect") _stub_inspect "$@"; return $? ;;
        "image rm")
            cp "$RL_ADMISSION_FILE" "$RL_STATE_DIR/during-rm.json"
            [[ -n "${RM_HOOK:-}" ]] && "$RM_HOOK"
            [[ -n "${RM_FAIL:-}" ]] && { echo "conflict: unable to remove" >&2; return 1; }
            return 0 ;;
        "ps -aq")
            [[ -n "${PS_FAIL:-}" ]] && return 1
            grep -qxF -- "${4#ancestor=}" <<<"${PS_IDS:-}" && echo c0ffee
            return 0 ;;
    esac
    return 0
}

_setup() {
    CALL_LOG="$RL_STATE_DIR/calls.log"; : > "$CALL_LOG"
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json" RL_ADMISSION_FILE="$RL_STATE_DIR/admission.json"
    export RL_ENV_IMAGE_GC_NOW=$NOW RL_ENV_IMAGE_GC_DRY_RUN=0 RL_ENV_IMAGE_GC_MIN_AGE_HOURS=2
    export RL_ENV_IMAGE_GC_RELEASE_GRACE_HOURS=0   # E16 turns it on; release-grace records live beside RL_ENVS_FILE
    printf 'MemTotal:       16777216 kB\nMemAvailable:   16000000 kB\n' > "$RL_STATE_DIR/meminfo"
    export RL_MEMINFO_PATH="$RL_STATE_DIR/meminfo" RL_HEAVY_TASK_SETTLE_SECONDS=0 RL_DISK_GATE=0
    export RL_HEAVY_TASK_POLL_SECONDS=1 RL_LEDGER_ADMISSION_TIMEOUT_SECONDS=2 RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS=2
    export RL_MAX_IMAGE_BUILDS=1 RL_MAX_HEAVY_CONCURRENT=2 RL_ADMISSION_BUDGET_MB=12288
    echo '{"heavy_running":[],"heavy_waiting":[]}' > "$RL_ADMISSION_FILE"
    jq -nc --arg r "$REPO" '[{slug:"live", image:($r + ":live")}]' > "$RL_ENVS_FILE"
    LOCAL_REFS="$REPO:gone"; META=""; ABSENT_REFS=""; FAIL_REFS=""; PS_IDS=""; PS_FAIL=""
    RM_FAIL=""; RM_HOOK=""; LS_FAIL=""
    # shellcheck disable=SC1091
    source "$BIN/_registry_gc.sh"
    # shellcheck disable=SC1090
    source "$LIB"
}

_rm_refs() { grep '^docker image rm' "$CALL_LOG" | sed 's/^docker image rm //'; }
_entries() { jq -c '[.heavy_running[] | select(.key == "env-image-gc")] | length' "$1"; }

test_removes_orphan() {
    _setup
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "$REPO:gone" "E1: the orphan image is removed by ref, no --force"
    assert_eq "$(jq -r '.removed[0].image' <<<"$out")" "$REPO:gone" "E1: reported as removed"
    assert_eq "$(jq -c '[.heavy_running[] | select(.key == "env-image-gc") | .kind]' "$RL_STATE_DIR/during-rm.json")" \
        '["registry_gc"]' "E1: a registry_gc-kind env-image-gc entry is held during the rm"
    assert_eq "$(_entries "$RL_ADMISSION_FILE")" "0" "E1: the entry is released afterwards"
}

test_env_row_keeps() {
    _setup
    jq -nc --arg r "$REPO" '[{slug:"a", image:"127.0.0.1:5000/rl-allinone:t1"}, {slug:"b", image:"other/img:x"},
        {slug:"c", image:($r + "@sha256:pin")}]' > "$RL_ENVS_FILE"
    LOCAL_REFS=$(printf '%s\n' "$REPO:t1" "$REPO:t2" "$REPO:t3")
    META=$(printf '%s\n' "$REPO:t2|sha256:same" "$REPO@sha256:pin|sha256:same")
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "$REPO:t3" "E2: only the unreferenced t3 is removed"
    assert_contains "$(jq -c .kept <<<"$out")" "an env uses tag t1" "E2: tag under another prefix keeps t1"
    assert_contains "$(jq -c .kept <<<"$out")" "an env pins the same image as $REPO@sha256:pin" "E2: digest pin keeps t2"
    echo '[{"slug":"x","image":"registry.rl.lan:5000/rl-allinone:t3"}]' > "$RL_ENVS_FILE"
    : > "$CALL_LOG"; META=""; env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(_rm_refs | grep -c ':t3$')" "0" "E2: exact ref keeps t3"
    assert_eq "$(_rm_refs | grep -c ':t[12]$')" "2" "E2: t1/t2 go once no row names them"
}

test_container_keeps() {
    _setup
    PS_IDS="sha256:id-of-$REPO:gone"
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "" "E3: a container of any state uses it"
    assert_contains "$out" "1 container(s) use it" "E3: reason reported"
    assert_contains "$(cat "$CALL_LOG")" "docker ps -aq --filter ancestor=sha256:id-of-$REPO:gone" "E3: -a by image id"
    PS_IDS=""; PS_FAIL=1; : > "$CALL_LOG"; env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(_rm_refs)" "" "E3: an unreadable container list keeps it"
}

test_runner_keeps() {
    _setup
    META="$REPO:gone|sha256:r|runner"
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "" "E4: rl.role=runner is never removed"
    assert_contains "$out" "labelled rl.role=runner" "E4: reason reported"
}

test_age_floor() {
    _setup
    local recent; recent=$(jq -rn --argjson t $((NOW - 600)) '$t | todate')
    META="$REPO:gone|sha256:a||$OLD|$recent"
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "" "E5: re-tagged 10 min ago (old Created) is kept"
    assert_contains "$out" "younger than 2h" "E5: reason names the floor"
    META="$REPO:gone|sha256:a||$recent|$ZERO"; : > "$CALL_LOG"; env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(_rm_refs)" "" "E5: created 10 min ago is kept"
    META="$REPO:gone|sha256:a||garbage|garbage"; : > "$CALL_LOG"
    out=$(env_image_gc::sweep 2>/dev/null)
    assert_contains "$out" "age unknown" "E5: an unparseable age keeps it"
    META="$REPO:gone|sha256:a||$recent|$ZERO"; RL_ENV_IMAGE_GC_MIN_AGE_HOURS=0; : > "$CALL_LOG"
    env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(_rm_refs)" "$REPO:gone" "E5: floor 0 removes it"
}

test_ledger_refuses() {
    _setup
    local h; h=$(hostname 2>/dev/null || echo unknown)
    jq -nc --argjson n "$(date +%s)" --arg h "$h" --argjson p $$ '{heavy_running:[{key:"b1", task_id:"b1",
        kind:"image_build", weight:"medium", admitted_epoch:$n, pid:$p, host:$h}], heavy_waiting:[]}' > "$RL_ADMISSION_FILE"
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "" "E6: no removal while an image build runs"
    assert_eq "$(jq -c '[.skipped, .blocked_by]' <<<"$out")" '["admission_refused","image_build_running"]' "E6: refusal reported"
    jq -nc --argjson n "$(date +%s)" --arg h "$h" --argjson p $$ '{heavy_running:[], heavy_waiting:[{key:"b2",
        task_id:"b2", kind:"image_build", weight:"medium", since_epoch:$n, pid:$p, host:$h}]}' > "$RL_ADMISSION_FILE"
    out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(jq -r .blocked_by <<<"$out")" "image_build_waiting" "E6: a waiting build also refuses"
    echo 'not json' > "$RL_ADMISSION_FILE"
    out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "" "E6: an unreadable ledger removes nothing"
    assert_eq "$(jq -r .skipped <<<"$out")" "admission_refused" "E6: unreadable ledger reported as refused"
}

test_dry_run_default() {
    _setup
    unset RL_ENV_IMAGE_GC_DRY_RUN
    # shellcheck disable=SC1090
    source "$LIB"
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "" "E7: dry run by default removes nothing"
    assert_eq "$(jq -r '.would_remove[0].image' <<<"$out")" "$REPO:gone" "E7: lists would_remove"
    assert_eq "$(jq -c . "$RL_ADMISSION_FILE")" '{"heavy_running":[],"heavy_waiting":[]}' "E7: no reservation taken"
}

test_unreadable_inputs() {
    _setup
    echo '{"slug":"x"}' > "$RL_ENVS_FILE"
    assert_eq "$(env_image_gc::sweep 2>/dev/null)" '{"error":"env_registry_unreadable"}' "E8: non-array registry aborts"
    rm -f "$RL_ENVS_FILE"
    assert_eq "$(env_image_gc::sweep 2>/dev/null)" '{"error":"env_registry_unreadable"}' "E8: missing registry aborts"
    echo '[]' > "$RL_ENVS_FILE"; LS_FAIL=1
    assert_eq "$(env_image_gc::sweep 2>/dev/null)" '{"error":"image_list_unreadable"}' "E8: image ls failure aborts"
    assert_eq "$(_rm_refs)" "" "E8: nothing removed"
}

test_rm_failure_releases() {
    _setup
    RM_FAIL=1
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_contains "$(jq -c .failed <<<"$out")" "conflict: unable to remove" "E9: the failure is reported"
    assert_eq "$(_entries "$RL_ADMISSION_FILE")" "0" "E9: the entry is released after a failed rm"
}

_drop_entry() { jq '.heavy_running = [.heavy_running[] | select(.key != "env-image-gc")]' \
    "$RL_ADMISSION_FILE" > "$RL_STATE_DIR/x" && mv "$RL_STATE_DIR/x" "$RL_ADMISSION_FILE"; }
test_lock_lost_stops() {
    _setup
    LOCAL_REFS=$(printf '%s\n' "$REPO:g1" "$REPO:g2"); RM_HOOK=_drop_entry
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "$REPO:g1" "E10: no rm after the entry was lost"
    assert_eq "$(jq -r .stopped <<<"$out")" "lock_lost" "E10: reported as lock_lost"
}

test_recheck_under_reservation() {
    _setup
    eval "$(declare -f env_image_gc::_renew | sed '1s/env_image_gc::_renew/_orig_renew/')"
    env_image_gc::_renew() {
        jq -nc --arg r "$REPO" '[{slug:"new", image:($r + ":gone")}]' > "$RL_ENVS_FILE"; _orig_renew
    }
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "" "E11: a row written after the pre-pass keeps the image"
    assert_contains "$(jq -c .kept <<<"$out")" "an env uses tag gone" "E11: re-check reason"
}

_try_build() { admission::acquire b9 b9 "" "" 5120 medium image_build >/dev/null 2>&1; echo $? > "$RL_STATE_DIR/build-rc"; }
test_build_blocked_during_rm() {
    _setup
    RM_HOOK=_try_build
    env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(cat "$RL_STATE_DIR/build-rc")" "1" "E12: an image build is not admitted during the removal"
    admission::acquire b9 b9 "" "" 5120 medium image_build >/dev/null 2>&1
    assert_eq "$?" "0" "E12: and is admitted once the pass released the entry"
}

test_wiring() {
    local eig rgc
    eig=$(grep -n 'env_image_gc::sweep' "$SWEEP" | head -1 | cut -d: -f1)
    rgc=$(grep -n 'registry_gc::sweep "' "$SWEEP" | head -1 | cut -d: -f1)
    assert_neq "${eig:-}" "" "E13: sweep.sh calls env_image_gc::sweep"
    assert_eq "$(( ${eig:-99999} < ${rgc:-0} ))" "1" "E13: before registry GC (line $eig vs $rgc)"
    assert_contains "$(cat "$TEST_DIR/run-tests.sh")" "env-image-gc.test.sh" "E13: run-tests.sh runs us"
}

test_registry_must_be_one_array() {
    _setup
    local doc
    for doc in "" "   " $'\n\t\n' '[{"slug":"live","image":' '{}' '[] []'; do
        printf '%s' "$doc" > "$RL_ENVS_FILE"; : > "$CALL_LOG"
        assert_eq "$(env_image_gc::sweep 2>/dev/null)" '{"error":"env_registry_unreadable"}' \
            "E14: env registry $(jq -Rc . <<<"$doc") aborts the sweep"
        assert_eq "$(_rm_refs)" "" "E14: nothing removed for $(jq -Rc . <<<"$doc")"
    done
    echo '[]' > "$RL_ENVS_FILE"; : > "$CALL_LOG"
    env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(_rm_refs)" "$REPO:gone" "E14: [] is a valid empty registry"
}

test_bare_id_pin_keeps() {
    _setup
    META="$REPO:gone|sha256:0b5e55ed"
    echo '[{"slug":"respun","image":"sha256:0b5e55ed"}]' > "$RL_ENVS_FILE"
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "" "E15: a row pinned to the bare image id keeps it"
    assert_contains "$(jq -c .kept <<<"$out")" "an env pins image id sha256:0b5e55ed" "E15: reason reported"
}

_recdir() { echo "$RL_STATE_DIR/env-image-released"; }
_rec() { cat "$(_recdir)/$1" 2>/dev/null; }
_exists() { [[ -e "$1" ]] && echo created || echo absent; }
test_release_grace() {
    _setup
    export RL_ENV_IMAGE_GC_RELEASE_GRACE_HOURS=2
    mkdir -p "$(_recdir)"   # deploy provisions it (ensure-runner-dirs.sh)
    local out; out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "" "E16: no release record → kept"
    assert_contains "$(jq -c .kept <<<"$out")" "release time unknown: 2h grace starts now" "E16: reason reported"
    assert_eq "$(_rec gone)" "$NOW" "E16: the first unused sighting records the release"
    env_image_gc::mark_released gone $((NOW - 600)); : > "$CALL_LOG"
    out=$(env_image_gc::sweep 2>/dev/null)
    assert_eq "$(_rm_refs)" "" "E16: released 10 min ago (image itself old) → kept"
    assert_contains "$(jq -c .kept <<<"$out")" "released less than 2h ago" "E16: grace reason"
    env_image_gc::mark_released gone $((NOW - 3 * 3600)); : > "$CALL_LOG"
    env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(_rm_refs)" "$REPO:gone" "E16: released 3h ago → removed"
    assert_eq "$(_rec gone)" "" "E16: the record goes with the image"
    # destroy → re-spin: env-destroy records the release, the sweep in between keeps it.
    LOCAL_REFS="$REPO:live"; env_image_gc::mark_released live $((NOW - 9 * 3600))
    : > "$CALL_LOG"; env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(_rec live)" "" "E16: a tag an env row uses has its stale record cleared"
    env_image_gc::mark_env_released live
    assert_eq "$(_rec live)" "$NOW" "E16: mark_env_released records the row's tag"
    echo '[]' > "$RL_ENVS_FILE"; : > "$CALL_LOG"; env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(_rm_refs)" "" "E16: a sweep right after the destroy keeps the image for the re-spin"
    rm -rf "$RL_STATE_DIR/env-image-released"; : > "$CALL_LOG"
    RL_ENV_IMAGE_GC_RELEASED_DIR=/dev/null/nope env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(_rm_refs)" "" "E16: an unwritable record dir keeps it"
}

test_destroy_records_release() {
    local destroy="$BIN/env-destroy" mark del drop
    mark=$(grep -n 'env_image_gc::mark_env_released "$SLUG"' "$destroy" | head -1 | cut -d: -f1)
    del=$(grep -n 'registry_gc::delete_env_tag "$SLUG"' "$destroy" | head -1 | cut -d: -f1)
    drop=$(grep -n "state::mutate \"\$RL_ENVS_FILE\" --arg slug \"\$SLUG\" 'map(select(.slug != \$slug))'" "$destroy" | head -1 | cut -d: -f1)
    assert_neq "${mark:-}" "" "E17: env-destroy records the release"
    assert_eq "$(( ${mark:-0} > ${del:-99999} && ${mark:-99999} < ${drop:-0} ))" "1" \
        "E17: after the registry tag delete ($del), before the row is removed ($drop): $mark"
}

test_record_dir_not_created() {
    _setup
    export RL_ENV_IMAGE_GC_RELEASE_GRACE_HOURS=2
    rm -rf "$(_recdir)"; LOCAL_REFS="$REPO:gone"$'\n'"$REPO:gone2"
    local out err="$RL_STATE_DIR/err" rc
    out=$(env_image_gc::sweep 2>"$err")
    assert_eq "$(_rm_refs)" "" "E18: missing record dir → nothing removed"
    assert_eq "$(_exists "$(_recdir)")" "absent" "E18: the sweep never creates the record dir"
    assert_eq "$(grep -c 'release-record dir .* is missing' "$err")" "1" "E18: the missing dir is logged once per sweep"
    assert_contains "$(jq -c .kept <<<"$out")" "no release record and none can be written: kept" "E18: reason reported"
    env_image_gc::mark_env_released live 2>"$err"; rc=$?
    assert_eq "$rc" "0" "E18: the env-destroy hook returns 0 when the dir is missing"
    assert_contains "$(cat "$err")" "WARNING could not record the release of live" "E18: missing dir → warning"
    assert_eq "$(_exists "$(_recdir)")" "absent" "E18: env-destroy never creates the record dir"
    mkdir -p "$(_recdir)"
    mv() { return 1; }
    env_image_gc::mark_env_released live 2>"$err"; rc=$?
    unset -f mv
    assert_eq "$rc" "0" "E18: a failed record write still returns 0"
    assert_contains "$(cat "$err")" "WARNING could not record the release of live" "E18: a failed write → warning"
    assert_eq "$(ls -A "$(_recdir)")" "" "E18: the failed write leaves no tmp file"
}

test_records_pruned() {
    _setup
    export RL_ENV_IMAGE_GC_RELEASE_GRACE_HOURS=2 RL_ENV_IMAGE_GC_DRY_RUN=1   # dry run: records outlive the grace
    mkdir -p "$(_recdir)"; LOCAL_REFS="$REPO:gone"$'\n'"$REPO:old"$'\n'"$REPO:mid"
    env_image_gc::mark_released gone $((NOW - 600)); env_image_gc::mark_released vanished $((NOW - 600))
    env_image_gc::mark_released old $((NOW - 27 * 3600)); env_image_gc::mark_released mid $((NOW - 25 * 3600))
    local err="$RL_STATE_DIR/err"; env_image_gc::sweep >/dev/null 2>"$err"
    assert_eq "$(_rec gone)" "$((NOW - 600))" "E19: a fresh record of a local image survives"
    assert_eq "$(_rec vanished)" "" "E19: a record whose image is no longer local is pruned"
    assert_eq "$(_rec old)" "" "E19: a record older than grace + margin (2h + 24h) is pruned"
    assert_eq "$(_rec mid)" "$((NOW - 25 * 3600))" "E19: a record inside grace + margin is kept"
    assert_contains "$(cat "$err")" "pruned 2 stale release record(s)" "E19: the prune is logged"
    env_image_gc::mark_released vanished $((NOW - 600)); LS_FAIL=1
    env_image_gc::sweep >/dev/null 2>&1
    assert_eq "$(_rec vanished)" "$((NOW - 600))" "E19: nothing is pruned when the image list is unreadable"
}

run_test "e1-removes-orphan" test_removes_orphan
run_test "e2-env-row-keeps" test_env_row_keeps
run_test "e3-container-keeps" test_container_keeps
run_test "e4-runner-keeps" test_runner_keeps
run_test "e5-age-floor" test_age_floor
run_test "e6-ledger-refuses" test_ledger_refuses
run_test "e7-dry-run-default" test_dry_run_default
run_test "e8-unreadable-inputs" test_unreadable_inputs
run_test "e9-rm-failure-releases" test_rm_failure_releases
run_test "e10-lock-lost" test_lock_lost_stops
run_test "e11-recheck" test_recheck_under_reservation
run_test "e12-build-blocked" test_build_blocked_during_rm
run_test "e13-wiring" test_wiring
run_test "e14-registry-one-array" test_registry_must_be_one_array
run_test "e15-bare-id-pin" test_bare_id_pin_keeps
run_test "e16-release-grace" test_release_grace
run_test "e17-destroy-records-release" test_destroy_records_release
run_test "e18-record-dir-provisioned-not-created" test_record_dir_not_created
run_test "e19-records-pruned" test_records_pruned
print_test_summary
