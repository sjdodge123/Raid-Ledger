#!/usr/bin/env bash
# ROK-1846 — release --destroy-envs must not take a container's rl.* labels on
# trust. A runner can build an image with LABEL rl.role=env rl.env_slug=<victim>;
# its container sits on the releasing slot, so the docker-label sweep in release
# would force-destroy another slot's env. Release acts on a docker-only slug
# only through a container named for that env, and never on a slug env-registry
# gives to another slot. A genuine orphan (named right, not registered) is
# still destroyed — that is what the docker sweep is for.
#
# Stubs `docker` on PATH and `env-destroy` / `task-cancel` / `lease-advance` by
# symlink into BIN_DIR — the release-runner-cleanup.test.sh pattern.

set -uo pipefail

CURRENT_TEST_FILE="release-forged-env-labels.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

_seed() {
    local now
    now=$(date -u +%FT%TZ)
    jq -n --arg t "$now" '[
        {slot:1, claimed:true, agent_id:"agent-forge", branch:"b", started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0},
        {slot:2, claimed:true, agent_id:"agent-victim", branch:"v", started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0}
    ]' > "$RL_STATE_DIR/claims.json"
    jq -n --arg t "$now" '[
        {slug:"mine", slot:1, image:"x", ttl:"24h", created_at:$t, last_touched:$t, pinned:false, claimable_by_next:false},
        {slug:"victim", slot:2, image:"x", ttl:"24h", created_at:$t, last_touched:$t, pinned:false, claimable_by_next:false}
    ]' > "$RL_STATE_DIR/env-registry.json"
}

_install_stubs() {
    local sentinel="$1"
    FAKE_BIN=$(mktemp -d -t rl-forge-bin.XXXXXX)
    cat > "$FAKE_BIN/docker" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == "ps" && "$*" == *"label=rl.role=env"* ]]; then
    printf '%s\n' "victim runner-child-abc" "victim rl-env-victim-allinone" "ghost runner-child-def" "orphan rl-env-orphan-pg"
fi
exit 0
STUB
    for name in env-destroy task-cancel lease-advance; do
        printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\nexit 0\n' "$name" "$sentinel" > "$FAKE_BIN/$name"
    done
    chmod +x "$FAKE_BIN"/*
    STUB_BACKUP_DIR=$(mktemp -d -t rl-forge-backups.XXXXXX)
    for name in env-destroy task-cancel lease-advance; do
        [[ -e "$BIN_DIR/$name" || -L "$BIN_DIR/$name" ]] && mv "$BIN_DIR/$name" "$STUB_BACKUP_DIR/$name"
        ln -s "$FAKE_BIN/$name" "$BIN_DIR/$name"
    done
}

_restore_stubs() {
    for name in env-destroy task-cancel lease-advance; do
        rm -f "$BIN_DIR/$name"
        [[ -e "$STUB_BACKUP_DIR/$name" ]] && mv "$STUB_BACKUP_DIR/$name" "$BIN_DIR/$name"
    done
    rm -rf "$STUB_BACKUP_DIR" "$FAKE_BIN"
}

test_forged_env_slug_is_not_destroyed() {
    local sentinel="$RL_STATE_DIR/calls.log" log
    : > "$sentinel"
    _seed
    _install_stubs "$sentinel"
    RL_AGENT_ID="agent-forge" PATH="$FAKE_BIN:$PATH" bash "$BIN_DIR/release" --destroy-envs >/dev/null 2>&1 || true
    log=$(cat "$sentinel")
    _restore_stubs
    assert_contains "$log" "env-destroy --slug mine --force" "the slot's own registered env is destroyed"
    assert_contains "$log" "env-destroy --slug orphan --force" "a correctly named, unregistered orphan is still destroyed"
    if [[ "$log" == *"--slug victim"* || "$log" == *"--slug ghost"* ]]; then
        assert_eq "$log" "<no victim/ghost destroy>" "release must not destroy a slug another slot owns, or one whose container is not that env's"
    else
        assert_eq "ok" "ok" "victim and ghost left alone"
    fi
}

run_test "rok-1846-release-forged-env-labels" test_forged_env_slug_is_not_destroyed

print_test_summary
