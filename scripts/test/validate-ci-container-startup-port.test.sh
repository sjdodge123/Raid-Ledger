#!/usr/bin/env bash
# ROK-1331 M13 — validate-ci.sh container-startup test must use a non-conflicting host port.
#
# The fleet VM's rl-dashboard service is permanently bound to :8080, so
# validate-ci's `docker run -p 8080:80` on the freshly-built rl:ci-test
# image collides. The fix:
#   - RL_CONTAINER_STARTUP_PORT env var overrides the host port.
#   - On the fleet (detected via `[ -d /workspace ]`), default to 8090.
#   - On the laptop (no /workspace), default to 8080 (preserves current behavior).
#   - docker run AND every curl healthcheck in the test must use the chosen port.
#
# Strategy: pure structural grep against scripts/validate-ci.sh.
# These tests MUST fail before the M13 implementation lands.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-container-startup-port.test.sh"
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
    if grep -E -q -- "$pattern" "$file"; then
        pass
    else
        fail "$message (pattern not found in $file: $pattern)"
    fi
}

assert_not_grep() {
    local pattern="$1" file="$2" message="${3:-}"
    if grep -E -q -- "$pattern" "$file"; then
        fail "$message (pattern unexpectedly found in $file: $pattern)"
    else
        pass
    fi
}

# AC-M13-1: validate-ci.sh references RL_CONTAINER_STARTUP_PORT for override.
CURRENT_TEST_NAME="AC-M13-1: RL_CONTAINER_STARTUP_PORT env var honored"
assert_grep 'RL_CONTAINER_STARTUP_PORT' "$VALIDATE_CI_PATH" \
    "container-startup test must reference RL_CONTAINER_STARTUP_PORT env var"

# AC-M13-2: fleet detection — `-d /workspace` guard defaults to 8090.
CURRENT_TEST_NAME="AC-M13-2: fleet (-d /workspace) defaults to 8090"
assert_grep '/workspace' "$VALIDATE_CI_PATH" \
    "container-startup test must detect the fleet via /workspace directory"
assert_grep '8090' "$VALIDATE_CI_PATH" \
    "fleet default host port for container-startup must be 8090 (rl-dashboard owns 8080)"

# AC-M13-3: laptop default preserved at 8080.
CURRENT_TEST_NAME="AC-M13-3: laptop default preserved (8080)"
assert_grep '8080' "$VALIDATE_CI_PATH" \
    "laptop default for container-startup host port must remain 8080"

# AC-M13-4: docker run + curl healthchecks both use the chosen port (no
# hard-coded 8080 inside the container-startup test body — the only 8080
# references remaining must be in the default-assignment line).
CURRENT_TEST_NAME="AC-M13-4: docker run + curl use the chosen port var"
# A variable named *PORT* (matching RL_CONTAINER_STARTUP_PORT) must be
# substituted into the docker run -p mapping (quoted or not).
assert_grep '[[:space:]]-p[[:space:]]"?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?:80' "$VALIDATE_CI_PATH" \
    "docker run -p must use a port variable, not a literal 8080"
# At least one curl health line must reference the port var (not a literal).
assert_grep 'http://127\.0\.0\.1:\$\{?[A-Za-z_][A-Za-z0-9_]*' "$VALIDATE_CI_PATH" \
    "container-startup curl health URLs must reference the port var, not literal 8080"

# AC-M13-5: the hard-coded `127.0.0.1:8080` URLs from the pre-M13 code path
# must be gone. Anything that previously read `http://127.0.0.1:8080/...`
# inside the container-startup test should now interpolate the port var.
# This is the regression guard — if a future edit reintroduces a literal,
# this test catches it.
CURRENT_TEST_NAME="AC-M13-5: no literal 127.0.0.1:8080 URLs remain in container-startup"
assert_not_grep 'http://127\.0\.0\.1:8080/' "$VALIDATE_CI_PATH" \
    "container-startup test must not contain literal http://127.0.0.1:8080/ URLs after M13"

# TDB:3795/3861/4085 — behavioural: two fleet slots must not share the image
# tag or host port. The helpers are pulled out of validate-ci.sh and the fleet
# marker /workspace is pointed at a temp dir (it does not exist on a laptop).
extract_fn() {
    awk -v name="$1" '
        $0 ~ "^" name "\\(\\)" { in_fn=1; print; next }
        in_fn && /^}/ { print; exit }
        in_fn { print }
    ' "$VALIDATE_CI_PATH"
}
SLOT_WORK="$(mktemp -d -t rl-ci-slot.XXXXXX)"
trap 'rm -rf "$SLOT_WORK"' EXIT
mkdir -p "$SLOT_WORK/ws"
SLOT_FNS="$(extract_fn _container_startup_slot_suffix; extract_fn _container_startup_port)"
FLEET_FNS="${SLOT_FNS//\/workspace/$SLOT_WORK/ws}"
LAPTOP_FNS="${SLOT_FNS//\/workspace/$SLOT_WORK/absent}"

# startup_target <fns> <RL_SLOT or -> <RL_CONTAINER_STARTUP_PORT or ->: prints "<suffix> <port>".
startup_target() {
    (
        unset RL_SLOT RL_CONTAINER_STARTUP_PORT
        [ "$2" = - ] || export RL_SLOT="$2"
        [ "$3" = - ] || export RL_CONTAINER_STARTUP_PORT="$3"
        eval "$1"
        echo "[$(_container_startup_slot_suffix)] $(_container_startup_port)"
    ) 2>&1
}
assert_target() {
    local actual
    actual=$(startup_target "$1" "$2" "$3")
    if [ "$actual" = "$4" ]; then pass; else
        fail "RL_SLOT=$2 RL_CONTAINER_STARTUP_PORT=$3: expected '$4', got '$actual'"
    fi
}

CURRENT_TEST_NAME="TDB:3795 helpers exist"
if [ -n "$SLOT_FNS" ] && grep -q '/workspace' <<<"$SLOT_FNS"; then pass; else
    fail "_container_startup_slot_suffix / _container_startup_port not found in validate-ci.sh"
fi
CURRENT_TEST_NAME="TDB:3795 fleet slots get distinct tag suffix + port"
assert_target "$FLEET_FNS" 2 - "[-slot2] 8092"
assert_target "$FLEET_FNS" 3 - "[-slot3] 8093"
CURRENT_TEST_NAME="TDB:3795 fleet without a numeric RL_SLOT keeps rl:ci-test + 8090"
assert_target "$FLEET_FNS" - - "[] 8090"
assert_target "$FLEET_FNS" 'x;id' - "[] 8090"
CURRENT_TEST_NAME="TDB:3795 explicit RL_CONTAINER_STARTUP_PORT still wins"
assert_target "$FLEET_FNS" 2 9555 "[-slot2] 9555"
CURRENT_TEST_NAME="TDB:3795 laptop keeps rl:ci-test + 8080 even with RL_SLOT set"
assert_target "$LAPTOP_FNS" - - "[] 8080"
assert_target "$LAPTOP_FNS" 2 - "[] 8080"
CURRENT_TEST_NAME="TDB:3795 build, run and container name use the per-slot values"
assert_grep 'docker build -f Dockerfile\.allinone -t "\$image_tag"' "$VALIDATE_CI_PATH" \
    "docker build must tag the per-slot image"
assert_grep '^    "\$image_tag"$' "$VALIDATE_CI_PATH" "docker run must start the per-slot image"
assert_not_grep '-t rl:ci-test \.' "$VALIDATE_CI_PATH" "fixed rl:ci-test build tag must be gone"
assert_grep 'cname="rl-ci-test\$\{slot_sfx\}-\$\$"' "$VALIDATE_CI_PATH" "container name must carry the slot"

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
