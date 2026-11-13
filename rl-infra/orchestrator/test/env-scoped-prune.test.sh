#!/usr/bin/env bash
# ROK-2181 — gc-sweeper step 3, the scoped rl.role=env prune.
#
# The step ran `docker {image,volume,container} prune -f --filter
# label=rl.role=env` every cycle with no look at env-registry, so a pinned
# (rl_env_pin) or preserved (rl_release default, claimable_by_next) env lost its
# stopped containers, then its rl-data-<slug> volume, then its image.
# `_env_scoped_prune.sh` now decides per resource from env-registry.json.
#
# docker is a stub EXECUTABLE on PATH: listings come from files, every
# rm/prune call is appended to $DLOG.
#
# Covered:
#   S-a  pinned + preserved envs' stopped containers and volumes survive; the
#        dead (unregistered) env's are removed, one `docker rm` each, no prune
#   S-b  a container is kept by its rl.env_slug label alone (odd name) and by
#        its rl-env-<slug>-pg name alone (no label)
#   S-c  dangling images: a registry row's sha256 image id is kept, others go
#   S-d  unreadable / non-array registry prunes NOTHING
#   S-e  RL_ENV_SCOPED_PRUNE_DRY_RUN=1 reports would_remove, removes nothing
#   S-f  a failing listing skips only that kind
#   S-g  sweep.sh sources the lib and has no blanket rl.role=env prune left

set -uo pipefail

# shellcheck disable=SC2034  # read by test_helpers.sh
CURRENT_TEST_FILE="env-scoped-prune.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

LIB="$(cd "$TEST_DIR/../bin" && pwd)/_env_scoped_prune.sh"
SWEEP_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"

# Fresh stub docker + fixture dir under $TMP_STATE.
_setup() {
    D="$TMP_STATE/docker"; DLOG="$D/calls.log"; ENVS="$TMP_STATE/env-registry.json"
    mkdir -p "$D/bin"; : > "$DLOG"; : > "$D/ps"; : > "$D/volumes"; : > "$D/images"
    cat > "$D/bin/docker" <<EOF
#!/usr/bin/env bash
case "\$1 \${2-}" in
    "ps "*)        [[ -e "$D/fail-ps" ]] && exit 1; cat "$D/ps" ;;
    "volume ls")   cat "$D/volumes" ;;
    "images "*)    cat "$D/images" ;;
    "rm "*|"volume rm"|"image rm") echo "\$*" >> "$DLOG" ;;
    *prune*|"volume prune"|"image prune"|"container prune") echo "PRUNE \$*" >> "$DLOG" ;;
    *) echo "UNEXPECTED \$*" >> "$DLOG" ;;
esac
EOF
    chmod +x "$D/bin/docker"
    export PATH="$D/bin:$PATH"
    unset RL_ENV_SCOPED_PRUNE_DRY_RUN
    # shellcheck disable=SC1090
    source "$LIB"
}

# Registry: pinned1 (pinned), pres1 (preserved by rl_release), no row for dead1.
_seed_registry() {
    jq -n '[{slug:"pinned1", slot:1, image:"registry.rl.lan:5000/rl-allinone:a", pinned:true, claimable_by_next:false},
            {slug:"pres1", slot:2, image:"sha256:keepme", pinned:false, claimable_by_next:true}]' > "$ENVS"
}

_seed_dead_and_kept_resources() {
    printf '%s\n' "c1|pinned1|rl-env-pinned1-pg" "c2|pres1|rl-env-pres1-allinone" \
        "c3|pres1|rl-env-pres1-pg" "c4|dead1|rl-env-dead1-pg" > "$D/ps"
    printf '%s\n' "rl-data-pinned1|pinned1" "rl-data-pres1|pres1" "rl-data-dead1|dead1" > "$D/volumes"
}

test_preserved_and_pinned_survive() {
    _setup; _seed_registry; _seed_dead_and_kept_resources
    local out; out=$(env_scoped_prune::run "$ENVS")
    assert_eq "$(sort "$DLOG" | tr '\n' ';')" "rm c4;volume rm rl-data-dead1;" "S-a only the dead env's container + volume are removed"
    assert_eq "$(grep -c PRUNE "$DLOG")" "0" "S-a no blanket prune is issued"
    assert_eq "$(jq -c '[.kept[].id] | sort' <<<"$out")" '["c1","c2","c3","rl-data-pinned1","rl-data-pres1"]' "S-a pinned + preserved resources reported kept"
    assert_eq "$(jq -c '[.removed[].id] | sort' <<<"$out")" '["c4","rl-data-dead1"]' "S-a removals reported"
}

test_kept_by_label_or_name() {
    _setup; _seed_registry
    printf '%s\n' "c5|pinned1|someone-renamed-it" "c6||rl-env-pres1-pg" "c7||rl-env-dead1-allinone" > "$D/ps"
    printf '%s\n' "rl-data-pres1|" "rl-data-dead1|" > "$D/volumes"
    env_scoped_prune::run "$ENVS" >/dev/null
    assert_eq "$(sort "$DLOG" | tr '\n' ';')" "rm c7;volume rm rl-data-dead1;" "S-b label-only and name-only registered envs are kept"
}

test_images() {
    _setup; _seed_registry
    printf '%s\n' "sha256:keepme" "sha256:orphan" > "$D/images"
    env_scoped_prune::run "$ENVS" >/dev/null
    assert_eq "$(cat "$DLOG")" "image rm sha256:orphan" "S-c registry-referenced image id kept, orphan dangling image removed"
}

test_unreadable_registry_prunes_nothing() {
    _setup; _seed_dead_and_kept_resources
    local out shape
    for shape in missing '{}' '[{"slug":"x"' ''; do
        : > "$DLOG"; rm -f "$ENVS"
        [[ "$shape" == missing ]] || printf '%s' "$shape" > "$ENVS"
        out=$(env_scoped_prune::run "$ENVS")
        assert_eq "$(wc -l < "$DLOG" | tr -d ' ')" "0" "S-d registry '$shape' → no docker removal at all"
        assert_eq "$(jq -r .error <<<"$out")" "env_registry_unreadable" "S-d registry '$shape' → error reported"
    done
}

test_dry_run() {
    _setup; _seed_registry; _seed_dead_and_kept_resources
    local out; out=$(RL_ENV_SCOPED_PRUNE_DRY_RUN=1 env_scoped_prune::run "$ENVS")
    assert_eq "$(wc -l < "$DLOG" | tr -d ' ')" "0" "S-e dry run removes nothing"
    assert_eq "$(jq -c '[.would_remove[].id] | sort' <<<"$out")" '["c4","rl-data-dead1"]' "S-e dry run lists the dead env's resources"
    assert_eq "$(jq -r .dry_run <<<"$out")" "true" "S-e dry_run flag set"
}

test_failing_listing_skips_only_that_kind() {
    _setup; _seed_registry; _seed_dead_and_kept_resources; touch "$D/fail-ps"
    local out; out=$(env_scoped_prune::run "$ENVS")
    assert_eq "$(cat "$DLOG")" "volume rm rl-data-dead1" "S-f container listing failure skips containers only"
    assert_eq "$(jq -r .error <<<"$out")" "containers_unreadable" "S-f error names the kind"
}

test_sweep_wiring() {
    local code
    code=$(grep -v '^[[:space:]]*#' "$SWEEP_SCRIPT")
    assert_eq "$(grep -cE 'prune -f --filter "?label=rl\.role=env' <<<"$code")" "0" "S-g sweep.sh has no blanket rl.role=env prune"
    assert_eq "$(grep -cF '/_env_scoped_prune.sh' <<<"$code")" "1" "S-g sweep.sh resolves the scoped-prune lib"
    # shellcheck disable=SC2016  # literal source text, not an expansion
    assert_eq "$(grep -cF 'env_scoped_prune::run "$ENVS"' <<<"$code")" "1" "S-g sweep.sh runs it against env-registry"
}

run_test "S-a pinned + preserved survive, dead pruned" test_preserved_and_pinned_survive
run_test "S-b kept by label or name" test_kept_by_label_or_name
run_test "S-c images" test_images
run_test "S-d unreadable registry prunes nothing" test_unreadable_registry_prunes_nothing
run_test "S-e dry run" test_dry_run
run_test "S-f failing listing" test_failing_listing_skips_only_that_kind
run_test "S-g sweep wiring" test_sweep_wiring
print_test_summary
