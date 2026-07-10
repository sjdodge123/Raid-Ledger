#!/usr/bin/env bash
# clone-prod-to-local.sh prod_get_safe whitelist test.
#
# The GET whitelist must be a strict regex, not a bash glob — [[ ]] glob `*`
# matches `/`, so `*/download` would allow traversal shapes like
# `/admin/backups/../users/1/download`. Allowed shapes are exactly:
#   - /admin/backups (list endpoint)
#   - /admin/backups/(daily|migration)/<file>/download
#
# Strategy: extract just the prod_get_safe function from the script, stub
# red() and curl(), then call it in a subshell and assert exit status.

set -uo pipefail
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
CLONE_SCRIPT="$REPO_ROOT/scripts/clone-prod-to-local.sh"

PASS=0
FAIL=0
FAILED_NAMES=()

pass() {
    PASS=$((PASS + 1))
}
fail() {
    FAIL=$((FAIL + 1))
    FAILED_NAMES+=("$1")
    echo "FAIL: $1" >&2
}

[[ -f "$CLONE_SCRIPT" ]] || { echo "missing $CLONE_SCRIPT"; exit 1; }

# Extract only the function under test; stub its dependencies.
eval "$(sed -n '/^prod_get_safe()/,/^}/p' "$CLONE_SCRIPT")"
red() { :; }
curl() { :; }
PROD_GET_ALLOWED_PREFIX="/admin/backups"
PROD_URL="https://example.invalid"

assert_allowed() {
    if ( prod_get_safe "$1" ) >/dev/null 2>&1; then
        pass
    else
        fail "expected ALLOW: $1"
    fi
}

assert_blocked() {
    if ( prod_get_safe "$1" ) >/dev/null 2>&1; then
        fail "expected BLOCK: $1"
    else
        pass
    fi
}

assert_allowed "/admin/backups"
assert_allowed "/admin/backups/daily/raid_ledger_20260101_000000.dump/download"
assert_allowed "/admin/backups/migration/pre_foo_20260101.dump/download"
assert_blocked "/admin/backups/../users/1/download"
assert_blocked "/admin/backups/daily/../../admin/settings/x/download"
assert_blocked "/admin/backups/a/b/c/download"

echo ""
if [[ $FAIL -eq 0 ]]; then
    echo "PASS: clone-prod-get-whitelist ($PASS assertions)"
    exit 0
else
    echo "FAIL: clone-prod-get-whitelist ($FAIL of $((PASS + FAIL)) assertions failed)" >&2
    exit 1
fi
