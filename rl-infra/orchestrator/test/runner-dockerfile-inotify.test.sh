#!/usr/bin/env bash
# ROK-1331 M4 — runner Dockerfile must include inotify-tools in apt install list.
# Covers AC10 (static-source check; live container check is documented in spec
# but requires a VM rebuild).

set -uo pipefail

CURRENT_TEST_FILE="runner-dockerfile-inotify.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

WORKTREE_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
DOCKERFILE="$WORKTREE_ROOT/rl-infra/runner/Dockerfile"

# AC10: Dockerfile contains inotify-tools as an apt package.
test_dockerfile_has_inotify_tools() {
    CURRENT_TEST_NAME="AC10: rl-infra/runner/Dockerfile installs inotify-tools"
    if [[ ! -f "$DOCKERFILE" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: Dockerfile not found")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] Dockerfile not found at $DOCKERFILE"
        return
    fi
    # Looking for `inotify-tools` token (must be present, ideally in the apt
    # install RUN block — but a literal presence check is sufficient for AC10).
    if grep -q 'inotify-tools' "$DOCKERFILE"; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: inotify-tools not in Dockerfile")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] inotify-tools not in Dockerfile"
        echo "  Dockerfile apt-install block:"
        sed -n '/apt-get install/,/&&[[:space:]]*$/p' "$DOCKERFILE" | head -10
    fi
}

# AC10 strengthened: inotify-tools must be in the first apt-get install RUN
# (not in some downstream layer where a rebuild of upper layers would lose it).
test_dockerfile_inotify_in_apt_install() {
    CURRENT_TEST_NAME="AC10: inotify-tools is in the apt-get install RUN block"
    if [[ ! -f "$DOCKERFILE" ]]; then
        return
    fi
    # Extract the multi-line apt-get install block starting from the first
    # `RUN apt-get update && apt-get install -y` and find where inotify-tools
    # appears within it.
    local block
    block=$(awk '
        /^RUN apt-get update && apt-get install -y --no-install-recommends/ {flag=1}
        flag {print}
        flag && /rm -rf \/var\/lib\/apt\/lists/ {flag=0}
    ' "$DOCKERFILE")
    if echo "$block" | grep -q 'inotify-tools'; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: inotify-tools not in apt-get install block")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] inotify-tools missing from apt-get install RUN"
        echo "$block"
    fi
}

run_test "ac10-inotify-present" test_dockerfile_has_inotify_tools
run_test "ac10-inotify-in-apt-block" test_dockerfile_inotify_in_apt_install

print_test_summary
