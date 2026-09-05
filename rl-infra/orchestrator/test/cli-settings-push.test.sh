#!/usr/bin/env bash
# ROK-1469 D6 — `rl settings push` argument/precondition contract.
#
# The push is the operator-side half of the laptop-independence fix: it
# encrypts the shared API keys into /srv/rl-infra/settings/bundle.enc so
# env-spin can seed them without the laptop DB. These assertions cover the
# guards that run BEFORE any docker/ssh work, so the suite needs neither.
#
# Why guards matter here: pushing without RL_SETTINGS_BUNDLE_KEY would either
# write an unencrypted bundle or one the VM cannot decrypt — both silently
# produce keyless envs later, far from the cause.

set -uo pipefail

CURRENT_TEST_FILE="cli-settings-push.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RL_CLI="$(cd "$TEST_DIR/../../cli" && pwd)/rl"

PASS=0; FAIL=0; FAILED=()
check() {
    if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else
        FAIL=$((FAIL+1)); FAILED+=("$1"); echo "FAIL [$CURRENT_TEST_FILE] $1"
        echo "  expected: $3"; echo "  actual:   $2"
    fi
}
pass() { PASS=$((PASS+1)); }
fail() {
    FAIL=$((FAIL+1)); FAILED+=("${CURRENT_TEST_NAME:-?}: $1")
    echo "FAIL [$CURRENT_TEST_FILE] ${CURRENT_TEST_NAME:-?}: $1"
}
contains() {
    if [[ "$2" == *"$3"* ]]; then PASS=$((PASS+1)); else
        FAIL=$((FAIL+1)); FAILED+=("$1"); echo "FAIL [$CURRENT_TEST_FILE] $1"
        echo "  expected to contain: $3"; echo "  actual: $2"
    fi
}

export RL_TARGET=remote   # never probe SSH from a unit test
# The fleet runner has no $USER and its Mutagen-synced worktree has no .git,
# so both of the CLI's ambient assumptions have to be neutralised for this
# spec to mean the same thing on the laptop and on a runner.
export RL_TEST_SKIP_REPO_GUARD=1

OUT=$(RL_SETTINGS_BUNDLE_KEY= "$RL_CLI" settings 2>&1); RC=$?
check "bare 'settings' exits 2" "$RC" "2"
contains "bare 'settings' prints usage" "$OUT" "settings push"

OUT=$(RL_SETTINGS_BUNDLE_KEY= "$RL_CLI" settings bogus 2>&1); RC=$?
check "unknown subcommand exits 2" "$RC" "2"

# Run from an EMPTY dir: `_settings_bundle_key` falls back to the repo-root
# .env, where the operator's real key lives, so running from the repo would
# sail past the guard under test and start dumping the local DB.
SANDBOX=$(mktemp -d -t rl-cli-settings.XXXXXX)
OUT=$(cd "$SANDBOX" && RL_SETTINGS_BUNDLE_KEY= LOCAL_JWT_SECRET=x "$RL_CLI" settings push 2>&1); RC=$?
rmdir "$SANDBOX" 2>/dev/null || true
check "push without a bundle key exits 2" "$RC" "2"
contains "the error names RL_SETTINGS_BUNDLE_KEY" "$OUT" "RL_SETTINGS_BUNDLE_KEY"
# …and NOT the repo-root guard, which would make the exit-2 above pass for the
# wrong reason on a runner.
if [[ "$OUT" == *"inside the project git repo"* ]]; then
    FAIL=$((FAIL+1)); FAILED+=("repo guard masked the bundle-key check")
    echo "FAIL [$CURRENT_TEST_FILE] repo guard masked the bundle-key check"
else
    PASS=$((PASS+1))
fi

# The fleet runner container has no $USER; `set -u` turned the RL_AGENT_ID
# derivation into a hard `USER: unbound variable` abort, so EVERY rl command
# died there before doing anything.
CURRENT_TEST_NAME="runs with \$USER unset (fleet runner)"
OUT=$(env -u USER RL_SETTINGS_BUNDLE_KEY= "$RL_CLI" settings 2>&1); RC=$?
check "no-\$USER invocation still reaches the usage guard" "$RC" "2"
if [[ "$OUT" == *"unbound variable"* ]]; then
    FAIL=$((FAIL+1)); FAILED+=("USER unbound abort")
    echo "FAIL [$CURRENT_TEST_FILE] rl aborts with 'unbound variable' when \$USER is unset"
else
    PASS=$((PASS+1))
fi
contains "usage still printed without \$USER" "$OUT" "settings push"

# --- bundle-file permissions (live finding 2026-09-02) ----------------------
#
# The push wrote /srv/rl-infra/settings/bundle.enc as rl:rl 640 while the
# orchestrator runs as rl-agent (group rl-fleet). Every read then took the
# "no file" branch and the env silently came up with none of the shared keys.
# The write side must hand the file to the rl-fleet group — and must never
# make it world-readable, since it holds every community API key.
#
# Comments are stripped before scanning: the paragraph above mentions the
# very strings under test.
CODE_ONLY=$(mktemp -t rl-cli-code.XXXXXX)
sed -e 's/#.*$//' "$RL_CLI" > "$CODE_ONLY"
DEPLOY_CODE=$(mktemp -t rl-deploy-code.XXXXXX)
sed -e 's/#.*$//' "$(cd "$TEST_DIR/../.." && pwd)/deploy.sh" > "$DEPLOY_CODE"

CURRENT_TEST_NAME="push hands the bundle to the rl-fleet group"
if grep -q 'chgrp rl-fleet' "$CODE_ONLY"; then pass; else
    fail "the remote write must chgrp rl-fleet, or rl-agent cannot read the bundle"
fi

CURRENT_TEST_NAME="push sets 2750 on the settings dir and 640 on the file"
if grep -q 'chmod 2750' "$CODE_ONLY"; then pass; else fail "settings dir must be 2750 (setgid, no o+x)"; fi
if grep -q 'chmod 640' "$CODE_ONLY"; then pass; else fail "bundle file must be 640"; fi

CURRENT_TEST_NAME="the bundle is never world-readable"
if grep -Eq 'chmod (o\+r|[0-7][0-7][4-7])[^0-9]*bundle\.enc' "$CODE_ONLY"; then
    fail "a world-readable mode was applied to bundle.enc"
else
    pass
fi

CURRENT_TEST_NAME="deploy.sh re-asserts the same perms"
if grep -q 'settings' "$DEPLOY_CODE" && grep -q 'chmod 2750' "$DEPLOY_CODE"; then
    pass
else
    fail "deploy.sh must re-assert settings-dir perms next to traefik/conf.d (rsync resets them)"
fi
rm -f "$CODE_ONLY" "$DEPLOY_CODE"

echo "--- $CURRENT_TEST_FILE: $PASS pass, $FAIL fail ---"
if (( FAIL > 0 )); then printf '  - %s\n' "${FAILED[@]}"; exit 1; fi
