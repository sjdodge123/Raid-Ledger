#!/usr/bin/env bash
# scripts/ci/discord-smoke-lease.sh: release_earlier_attempts re-reads a slot
# ref right before it deletes it.
#
# Why: the function reads the ref, confirms its holder is an EARLIER attempt of
# this run, then deletes the ref. A waiter can take the stale slot over (the
# fast-forward PATCH in try_slot) between that read and the DELETE, and an
# unconditional DELETE then drops the waiter's fresh lease. The re-read skips
# the DELETE when the ref is gone or now points at a different commit.
#
# Harness: a stub `curl` first on PATH answers the GitHub REST calls with canned
# JSON and appends `METHOD URL` per call to the case's `calls` file; jq is the
# real binary. The lease script is sourced with LEASE_LIB_ONLY=1, so only its
# functions load. Slot 0 is first read as commit aaa; this run is run 111,
# attempt 2.
#
#   a  re-read still aaa                  -> exactly 1 DELETE
#   b  re-read now bbb (taken over)       -> 0 DELETEs, "changed hands"
#   c  re-read 404 (already gone)         -> 0 DELETEs
#   d  aaa belongs to another run (999)   -> 0 DELETEs, 1 ref read

set -uo pipefail

CURRENT_TEST_FILE="discord-smoke-lease.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
LEASE_SCRIPT="$REPO_ROOT/scripts/ci/discord-smoke-lease.sh"
REF_GET='^GET .*/git/ref/locks/discord-smoke/0$'

TEST_PASS_COUNT=0
TEST_FAIL_COUNT=0
TEST_FAIL_NAMES=()
CURRENT_TEST_NAME=""
CASE_DIR=""
CASE_RC=0

pass() { TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1)); }
fail() {
    TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
    TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $1")
    echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $1"
}

# assert_count <pattern> <file> <expected> <label>
assert_count() {
    local pattern="$1" file="$2" expected="$3" label="$4" actual
    actual=$(grep -c -E -e "$pattern" "$file" || true)
    if [ "$actual" -eq "$expected" ]; then pass; else
        fail "$label: expected $expected match(es) for '$pattern', got $actual ($(tr '\n' '|' <"$file"))"
    fi
}

# assert_out <pattern> <label>: matches the case's combined stdout + stderr.
assert_out() {
    if grep -E -q -e "$1" "$CASE_DIR/out"; then pass; else
        fail "$2: output did not match '$1' (got: $(tr '\n' '|' <"$CASE_DIR/out"))"
    fi
}

assert_rc0() {
    if [ "$CASE_RC" -eq 0 ]; then pass; else
        fail "release_earlier_attempts exited $CASE_RC (output: $(tr '\n' '|' <"$CASE_DIR/out"))"
    fi
}

WORK="$(mktemp -d -t rl-lease-test.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# Stub curl, shaped to api() in the lease script: `-o FILE` receives the body,
# stdout receives the HTTP code (`-w '%{http_code}'`), the URL is the last arg.
# The slot ref's 1st read returns aaa; later reads follow $STUB_REGET.
cat >"$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
url="${!#}" method=GET out=/dev/null
while [ $# -gt 0 ]; do
    case "$1" in
        -X) method="$2"; shift 2 ;;
        -o) out="$2"; shift 2 ;;
        *) shift ;;
    esac
done
echo "$method $url" >>"$STUB_DIR/calls"
respond() { printf '%s' "$2" >"$out"; printf '%s' "$1"; }
case "$method $url" in
    "GET "*/git/ref/locks/discord-smoke/0)
        n=$(( $(cat "$STUB_DIR/ref-gets" 2>/dev/null || echo 0) + 1 ))
        echo "$n" >"$STUB_DIR/ref-gets"
        if [ "$n" -eq 1 ]; then respond 200 '{"object":{"sha":"aaa"}}'; exit 0; fi
        case "$STUB_REGET" in
            same) respond 200 '{"object":{"sha":"aaa"}}' ;;
            diff) respond 200 '{"object":{"sha":"bbb"}}' ;;
            *) respond 404 '{}' ;;
        esac ;;
    "GET "*/git/commits/aaa)
        msg="$(printf 'discord-smoke lease 0\n\nrun_id=%s\nrun_attempt=1\nrun_url=http://stub.invalid/run\nacquired_at=%s\n' \
            "$STUB_HOLDER_RUN_ID" "$(date +%s)")"
        respond 200 "$(jq -nc --arg m "$msg" '{message: $m}')" ;;
    "DELETE "*/git/refs/locks/discord-smoke/0) respond 204 '' ;;
    *) respond 500 '{}' ;;
esac
STUB
chmod +x "$WORK/bin/curl"

# run_case <name> <reget: same|diff|gone> <holder run_id>: sources the lease
# script in a subshell and runs release_earlier_attempts against the stub.
run_case() {
    CURRENT_TEST_NAME="$1"
    CASE_DIR="$WORK/case-$2-$3"
    mkdir -p "$CASE_DIR"
    : >"$CASE_DIR/calls"
    (
        unset GITHUB_TOKEN GITHUB_SERVER_URL LEASE_REF_NAMESPACE LEASE_NAME
        export PATH="$WORK/bin:$PATH" STUB_DIR="$CASE_DIR" STUB_REGET="$2" STUB_HOLDER_RUN_ID="$3"
        export GITHUB_REPOSITORY=o/r GITHUB_RUN_ID=111 GITHUB_RUN_ATTEMPT=2 \
            GH_TOKEN=stub-not-a-real-token GITHUB_API_URL=http://stub.invalid \
            LEASE_POOL_SIZE=1 LEASE_LIB_ONLY=1
        # shellcheck disable=SC1090
        source "$LEASE_SCRIPT"
        release_earlier_attempts
    ) >"$CASE_DIR/out" 2>&1
    CASE_RC=$?
}

run_case "a: holder unchanged on re-read is released" same 111
assert_rc0
assert_count '^DELETE ' "$CASE_DIR/calls" 1 "unchanged holder"
assert_count "$REF_GET" "$CASE_DIR/calls" 2 "ref read, then re-read before the DELETE"
assert_out 'lease: released locks/discord-smoke/0, left by attempt 1 of this run' "release message"

run_case "b: slot taken over between read and DELETE is kept" diff 111
assert_rc0
assert_count '^DELETE ' "$CASE_DIR/calls" 0 "taken-over slot must not be deleted"
assert_out 'changed hands since it was read \(now bbb\); not releasing' "takeover message"

run_case "c: slot already gone on re-read is not deleted" gone 111
assert_rc0
assert_count '^DELETE ' "$CASE_DIR/calls" 0 "gone slot"
assert_count "$REF_GET" "$CASE_DIR/calls" 2 "ref read, then re-read"

run_case "d: slot held by another run is left alone" same 999
assert_rc0
assert_count '^DELETE ' "$CASE_DIR/calls" 0 "another run's lease"
assert_count "$REF_GET" "$CASE_DIR/calls" 1 "no re-read for another run's lease"

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do echo "  - $f"; done
    exit 1
fi
exit 0
