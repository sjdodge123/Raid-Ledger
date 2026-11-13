#!/usr/bin/env bash
# ROK-2181 — gc-sweeper step 3, the scoped rl.role=env prune.
#
# The step ran `docker {image,volume,container} prune -f --filter
# label=rl.role=env` every cycle with no look at env-registry, so a pinned
# (rl_env_pin) or preserved (rl_release default, claimable_by_next) env lost its
# stopped containers, then its rl-data-<slug> volume, then its image.
# `_env_scoped_prune.sh` now decides per resource from env-registry.json.
#
# docker is a stub EXECUTABLE on PATH. It honours the --filter args the lib
# relies on (label=rl.role=env, status=…, dangling=true) — fixture rows that a
# filter excludes are never listed — and answers `inspect` / `volume inspect`
# from the fixture's created column. Every list call is logged to $LLOG, every
# rm to $DLOG; any other call lands in $DLOG as UNEXPECTED.
#
# Covered:
#   S-a  pinned + preserved envs' stopped containers survive; the dead env's
#        stopped container and anonymous volume go, one rm each, no prune;
#        running / non-env / non-dangling fixtures are filtered by the stub
#   S-b  a container is kept by its rl.env_slug label alone (odd name) and by
#        its rl-env-<slug>-pg name alone (no label)
#   S-c  named rl-data-<slug> volumes are never removed (old-prune parity) and
#        no image call is ever made
#   S-d  missing / empty / partial / non-array registry prunes NOTHING
#   S-d2 a `[]` registry is readable: old stopped containers go, named volumes stay
#   S-e  RL_ENV_SCOPED_PRUNE_DRY_RUN=1 reports would_remove, removes nothing
#   S-f  a failing listing skips only that kind
#   S-h  spin-race grace: candidates younger than RL_ENV_SCOPED_PRUNE_MIN_AGE_MIN
#        or with no readable creation time are kept
#   S-i  needs_audit: errors are audited, a clean run is not (sweep.sh glue)
#   S-g  sweep.sh sources the lib, gates the audit on needs_audit, and has no
#        blanket rl.role=env prune left

set -uo pipefail

# shellcheck disable=SC2034  # read by test_helpers.sh
CURRENT_TEST_FILE="env-scoped-prune.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

LIB="$(cd "$TEST_DIR/../bin" && pwd)/_env_scoped_prune.sh"
SWEEP_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"
OLD=$(jq -nr 'now - 7200 | todate')
NEW=$(jq -nr 'now - 60 | todate')
ANON_A=$(printf '%064d' 0 | tr 0 a)
ANON_B=$(printf '%064d' 0 | tr 0 b)
ANON_C=$(printf '%064d' 0 | tr 0 c)

# Fresh stub docker + fixture dir under $TMP_STATE.
# Fixture rows — ps: id|slug|name|status|role|created;
#               volumes: name|slug|dangling|role|created.
_setup() {
    D="$TMP_STATE/docker"; DLOG="$D/calls.log"; LLOG="$D/list.log"; ENVS="$TMP_STATE/env-registry.json"
    mkdir -p "$D/bin"; rm -f "$D/fail-ps"; : > "$DLOG"; : > "$LLOG"; : > "$D/ps"; : > "$D/volumes"
    export FAKE_D="$D"
    cat > "$D/bin/docker" <<'EOF'
#!/usr/bin/env bash
D="$FAKE_D"; filters=(); args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do [[ "${args[i]}" == --filter ]] && filters+=("${args[i+1]}"); done
has() { local f; for f in "${filters[@]}"; do [[ "$f" == "$1" ]] && return 0; done; return 1; }
case "$1 ${2-}" in
    "ps "*)
        [[ -e "$D/fail-ps" ]] && exit 1
        echo "ps ${filters[*]}" >> "$D/list.log"
        while IFS='|' read -r id slug name status role _; do
            [[ -z "$id" ]] && continue
            if has label=rl.role=env && [[ "$role" != env ]]; then continue; fi
            if [[ " ${filters[*]} " == *" status="* ]] && ! has "status=$status"; then continue; fi
            echo "$id|$slug|$name"
        done < "$D/ps" ;;
    "volume ls")
        echo "volume ls ${filters[*]}" >> "$D/list.log"
        while IFS='|' read -r name slug dangling role _; do
            [[ -z "$name" ]] && continue
            if has label=rl.role=env && [[ "$role" != env ]]; then continue; fi
            if has dangling=true && [[ "$dangling" != true ]]; then continue; fi
            echo "$name|$slug"
        done < "$D/volumes" ;;
    "inspect "*)      awk -F'|' -v k="${!#}" '$1 == k {print $6}' "$D/ps" ;;
    "volume inspect") awk -F'|' -v k="${!#}" '$1 == k {print $5}' "$D/volumes" ;;
    "rm "*|"volume rm") echo "$*" >> "$D/calls.log" ;;
    *) echo "UNEXPECTED $*" >> "$D/calls.log" ;;
esac
EOF
    chmod +x "$D/bin/docker"
    export PATH="$D/bin:$PATH"
    unset RL_ENV_SCOPED_PRUNE_DRY_RUN RL_ENV_SCOPED_PRUNE_MIN_AGE_MIN
    # shellcheck disable=SC1090
    source "$LIB"
}

# Registry: pinned1 (pinned), pres1 (preserved by rl_release), no row for dead1.
_seed_registry() {
    jq -n '[{slug:"pinned1", slot:1, image:"registry.rl.lan:5000/rl-allinone:a", pinned:true, claimable_by_next:false},
            {slug:"pres1", slot:2, image:"sha256:keepme", pinned:false, claimable_by_next:true}]' > "$ENVS"
}

_seed_dead_and_kept_resources() {
    printf '%s\n' "c1|pinned1|rl-env-pinned1-pg|exited|env|$OLD" "c2|pres1|rl-env-pres1-allinone|exited|env|$OLD" \
        "c3|pres1|rl-env-pres1-pg|created|env|$OLD" "c4|dead1|rl-env-dead1-pg|exited|env|$OLD" \
        "c8|dead1|rl-env-dead1-allinone|running|env|$OLD" "c9||some-runner|exited|runner|$OLD" > "$D/ps"
    printf '%s\n' "rl-data-pinned1|pinned1|true|env|$OLD" "rl-data-pres1|pres1|true|env|$OLD" \
        "rl-data-dead1|dead1|true|env|$OLD" "$ANON_A|dead1|true|env|$OLD" "$ANON_B|pres1|true|env|$OLD" \
        "$ANON_C|dead1|false|env|$OLD" > "$D/volumes"
}

test_preserved_and_pinned_survive() {
    _setup; _seed_registry; _seed_dead_and_kept_resources
    local out; out=$(env_scoped_prune::run "$ENVS")
    assert_eq "$(sort "$DLOG" | tr '\n' ';')" "rm c4;volume rm $ANON_A;" "S-a only the dead env's container + anonymous volume are removed"
    assert_eq "$(jq -c '[.kept[] | select(.kind == "container") | .id] | sort' <<<"$out")" '["c1","c2","c3"]' "S-a pinned + preserved containers reported kept"
    assert_eq "$(jq -c '[.removed[].id] | sort' <<<"$out")" "[\"$ANON_A\",\"c4\"]" "S-a removals reported"
    assert_contains "$(cat "$LLOG")" "ps label=rl.role=env status=exited status=created status=dead" "S-a container listing filters env + stopped states"
    assert_contains "$(cat "$LLOG")" "volume ls label=rl.role=env dangling=true" "S-a volume listing filters env + dangling"
}

test_kept_by_label_or_name() {
    _setup; _seed_registry
    printf '%s\n' "c5|pinned1|someone-renamed-it|exited|env|$OLD" "c6||rl-env-pres1-pg|exited|env|$OLD" \
        "c7||rl-env-dead1-allinone|exited|env|$OLD" > "$D/ps"
    env_scoped_prune::run "$ENVS" >/dev/null
    assert_eq "$(cat "$DLOG")" "rm c7" "S-b label-only and name-only registered envs are kept"
}

test_named_volumes_and_images_untouched() {
    _setup; _seed_registry; _seed_dead_and_kept_resources
    local out; out=$(env_scoped_prune::run "$ENVS")
    assert_eq "$(grep -c 'rl-data-' "$DLOG")" "0" "S-c no named rl-data-<slug> volume is removed (old-prune parity)"
    assert_eq "$(jq -r '[.kept[] | select(.id == "rl-data-dead1") | .reason] | join(",")' <<<"$out")" "named_volume" "S-c an unregistered named volume is kept as named_volume"
    assert_eq "$(grep -ciE 'image|prune|UNEXPECTED' "$DLOG")" "0" "S-c no image, prune or unexpected docker call"
}

test_unreadable_registry_prunes_nothing() {
    _setup; _seed_dead_and_kept_resources
    local out shape
    for shape in missing '{}' '[{"slug":"x"' '' '"str"' '[] []'; do
        : > "$DLOG"; rm -f "$ENVS"
        [[ "$shape" == missing ]] || printf '%s' "$shape" > "$ENVS"
        out=$(env_scoped_prune::run "$ENVS")
        assert_eq "$(wc -l < "$DLOG" | tr -d ' ')" "0" "S-d registry '$shape' → no docker removal at all"
        assert_eq "$(jq -r .error <<<"$out")" "env_registry_unreadable" "S-d registry '$shape' → error reported"
    done
}

test_empty_array_registry() {
    _setup; _seed_dead_and_kept_resources; echo '[]' > "$ENVS"
    local out; out=$(env_scoped_prune::run "$ENVS")
    assert_eq "$(sort "$DLOG" | tr '\n' ';')" "rm c1;rm c2;rm c3;rm c4;volume rm $ANON_A;volume rm $ANON_B;" "S-d2 [] registry: old stopped containers + anonymous volumes go"
    assert_eq "$(jq -c '[.kept[] | select(.reason == "named_volume") | .id] | sort' <<<"$out")" '["rl-data-dead1","rl-data-pinned1","rl-data-pres1"]' "S-d2 [] registry: every named volume kept"
    assert_eq "$(jq -r '.error // "none"' <<<"$out")" "none" "S-d2 [] registry is not an error"
}

test_dry_run() {
    _setup; _seed_registry; _seed_dead_and_kept_resources
    local out; out=$(RL_ENV_SCOPED_PRUNE_DRY_RUN=1 env_scoped_prune::run "$ENVS")
    assert_eq "$(wc -l < "$DLOG" | tr -d ' ')" "0" "S-e dry run removes nothing"
    assert_eq "$(jq -c '[.would_remove[].id] | sort' <<<"$out")" "[\"$ANON_A\",\"c4\"]" "S-e dry run lists the dead env's resources"
    assert_eq "$(jq -r .dry_run <<<"$out")" "true" "S-e dry_run flag set"
}

test_failing_listing_skips_only_that_kind() {
    _setup; _seed_registry; _seed_dead_and_kept_resources; touch "$D/fail-ps"
    local out; out=$(env_scoped_prune::run "$ENVS")
    assert_eq "$(cat "$DLOG")" "volume rm $ANON_A" "S-f container listing failure skips containers only"
    assert_eq "$(jq -r .error <<<"$out")" "containers_unreadable" "S-f error names the kind"
}

test_spin_race_grace() {
    _setup; echo '[]' > "$ENVS"
    printf '%s\n' "c10|new1|rl-env-new1-pg|created|env|$NEW" "c11|new1|rl-env-new1-allinone|exited|env|" > "$D/ps"
    printf '%s\n' "$ANON_A|new1|true|env|$NEW" > "$D/volumes"
    local out; out=$(env_scoped_prune::run "$ENVS")
    assert_eq "$(wc -l < "$DLOG" | tr -d ' ')" "0" "S-h young / undated candidates are not removed"
    assert_eq "$(jq -r '[.kept[].reason] | unique | join(",")' <<<"$out")" "too_young" "S-h kept as too_young"
    : > "$DLOG"
    RL_ENV_SCOPED_PRUNE_MIN_AGE_MIN=0 env_scoped_prune::run "$ENVS" >/dev/null
    assert_eq "$(sort "$DLOG" | tr '\n' ';')" "rm c10;volume rm $ANON_A;" "S-h min age 0 removes dated candidates (undated stays)"
    env_scoped_prune::_old_enough "2020-01-01T00:00:00.123456789+02:00"; assert_eq "$?" "0" "S-h offset timestamp parses as old"
    env_scoped_prune::_old_enough "garbage"; assert_eq "$?" "1" "S-h garbage timestamp counts as young"
}

test_needs_audit_glue() {
    _setup
    env_scoped_prune::needs_audit '{"dry_run":false,"removed":[],"would_remove":[],"kept":[{"id":"c1"}],"failed":[]}'
    assert_eq "$?" "1" "S-i a clean run is not audited"
    env_scoped_prune::needs_audit '{"error":"containers_unreadable","removed":[],"would_remove":[],"kept":[],"failed":[]}'
    assert_eq "$?" "0" "S-i a listing error with nothing removed is audited"
    env_scoped_prune::needs_audit '{"removed":[{"id":"c4"}],"kept":[]}'
    assert_eq "$?" "0" "S-i a removal is audited"
    env_scoped_prune::needs_audit ''; assert_eq "$?" "1" "S-i empty input is not audited"
    rm -f "$ENVS"
    env_scoped_prune::needs_audit "$(env_scoped_prune::run "$ENVS")"
    assert_eq "$?" "0" "S-i an unreadable registry run is audited"
}

test_sweep_wiring() {
    local code
    code=$(grep -v '^[[:space:]]*#' "$SWEEP_SCRIPT")
    assert_eq "$(grep -cE 'prune -f --filter "?label=rl\.role=env' <<<"$code")" "0" "S-g sweep.sh has no blanket rl.role=env prune"
    assert_eq "$(grep -cF '/_env_scoped_prune.sh' <<<"$code")" "1" "S-g sweep.sh resolves the scoped-prune lib"
    # shellcheck disable=SC2016  # literal source text, not an expansion
    assert_eq "$(grep -cF 'env_scoped_prune::run "$ENVS"' <<<"$code")" "1" "S-g sweep.sh runs it against env-registry"
    # shellcheck disable=SC2016  # literal source text, not an expansion
    assert_eq "$(grep -cF 'env_scoped_prune::needs_audit "$ENV_SCOPED_PRUNE_RESULT"' <<<"$code")" "1" "S-g sweep.sh gates the audit on needs_audit"
}

run_test "S-a pinned + preserved survive, dead pruned" test_preserved_and_pinned_survive
run_test "S-b kept by label or name" test_kept_by_label_or_name
run_test "S-c named volumes + images untouched" test_named_volumes_and_images_untouched
run_test "S-d unreadable registry prunes nothing" test_unreadable_registry_prunes_nothing
run_test "S-d2 empty array registry" test_empty_array_registry
run_test "S-e dry run" test_dry_run
run_test "S-f failing listing" test_failing_listing_skips_only_that_kind
run_test "S-h spin-race grace" test_spin_race_grace
run_test "S-i needs_audit glue" test_needs_audit_glue
run_test "S-g sweep wiring" test_sweep_wiring
print_test_summary
