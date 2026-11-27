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
#   e-h  stale_reason input validation (TDB:3194)
#   i-m  FIFO queue: oldest waiter wins, pool of 2 admits two, dead tickets
#        skipped, a re-run keeps its place, release dequeues

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
            "$STUB_HOLDER_RUN_ID" "${STUB_ACQUIRED_AT:-$(date +%s)}")"
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

# TDB:3194 — stale_reason must never put a commit-message field into bash
# arithmetic unvalidated. stale_case <name> <holder run_id> <acquired_at>
# calls stale_reason aaa 0 (no run-status API call) and records its output.
stale_case() {
    CURRENT_TEST_NAME="$1"
    CASE_DIR="$WORK/stale-$(printf '%s' "$1" | tr -c 'a-z0-9' _)"
    mkdir -p "$CASE_DIR"
    : >"$CASE_DIR/calls"
    (
        unset GITHUB_TOKEN GITHUB_SERVER_URL LEASE_REF_NAMESPACE LEASE_NAME
        export PATH="$WORK/bin:$PATH" STUB_DIR="$CASE_DIR" STUB_REGET=same \
            STUB_HOLDER_RUN_ID="$2" STUB_ACQUIRED_AT="$3"
        export GITHUB_REPOSITORY=o/r GITHUB_RUN_ID=111 GITHUB_RUN_ATTEMPT=2 \
            GH_TOKEN=stub-not-a-real-token GITHUB_API_URL=http://stub.invalid \
            LEASE_POOL_SIZE=1 LEASE_LIB_ONLY=1
        cd "$CASE_DIR" || exit 1
        # shellcheck disable=SC1090
        source "$LEASE_SCRIPT"
        stale_reason aaa 0
    ) >"$CASE_DIR/out" 2>&1
    CASE_RC=$?
}
assert_no_pwn() {
    if [ -e "$CASE_DIR/PWNED" ]; then fail "acquired_at payload executed a command"; else pass; fi
}

stale_case "e: command-substitution acquired_at is not evaluated" 999 'RUN_ID[$(touch PWNED)]'
assert_no_pwn
assert_out '^holder acquired_at is malformed$' "malformed acquired_at is stale"

stale_case "f: malformed run_id is stale" 'RUN_ID[$(touch PWNED)]' "$(date +%s)"
assert_no_pwn
assert_out '^holder run_id is malformed$' "malformed run_id is stale"

stale_case "g: future acquired_at is stale" 999 "$(( $(date +%s) + 999999 ))"
assert_out '^holder acquired_at is in the future$' "future lease is stale"

stale_case "h: fresh numeric lease is not stale" 999 "$(date +%s)"
if [ -s "$CASE_DIR/out" ]; then fail "fresh lease reported stale: $(tr '\n' '|' <"$CASE_DIR/out")"; else pass; fi

# --- FIFO queue (scripts/ci/discord-smoke-lease-queue.sh) -------------------
# A second, stateful stub: refs live as files under $FIFO/refs/<path> (content =
# sha), commits under $FIFO/commits/<sha> (message) + <sha>.parent, run status
# under $FIFO/runs/<id> (missing = 404). POST git/refs is 422 on an existing
# ref, PATCH is fast-forward only, as on GitHub. Each poll_as is a separate
# process (fresh cache), as two waiting jobs would be.
mkdir -p "$WORK/bin2"
cat >"$WORK/bin2/curl" <<'STUB'
#!/usr/bin/env bash
url="${!#}" method=GET out=/dev/null data=""
while [ $# -gt 0 ]; do
    case "$1" in
        -X) method="$2"; shift 2 ;;
        -o) out="$2"; shift 2 ;;
        --data) data="$2"; shift 2 ;;
        *) shift ;;
    esac
done
echo "$method $url" >>"$STUB_DIR/calls"
respond() { printf '%s' "$2" >"$out"; printf '%s' "$1"; }
path="${url#*/repos/o/r/}" R="$STUB_DIR/refs"
case "$method $path" in
    "GET git/matching-refs/"*)
        pre="${path#git/matching-refs/}"
        respond 200 "$(cd "$R" && find . -type f | sed 's|^\./||' | grep "^${pre}" | while read -r f; do
            jq -nc --arg r "refs/$f" --arg s "$(cat "$f")" '{ref: $r, object: {sha: $s}}'; done | jq -sc .)" ;;
    "GET git/ref/"*) f="$R/${path#git/ref/}"
        if [ -f "$f" ]; then respond 200 "$(jq -nc --arg s "$(cat "$f")" '{object: {sha: $s}}')"; else respond 404 '{}'; fi ;;
    "POST git/refs") f="$R/$(jq -r '.ref' <<<"$data" | sed 's|^refs/||')"
        if [ -f "$f" ]; then respond 422 '{}'; else mkdir -p "$(dirname "$f")"; jq -r .sha <<<"$data" >"$f"; respond 201 '{}'; fi ;;
    "PATCH git/refs/"*) f="$R/${path#git/refs/}" new="$(jq -r .sha <<<"$data")"
        if [ -f "$f" ] && [ "$(cat "$f")" = "$(cat "$STUB_DIR/commits/$new.parent")" ]; then
            echo "$new" >"$f"; respond 200 '{}'; else respond 422 '{}'; fi ;;
    "DELETE git/refs/"*) f="$R/${path#git/refs/}"
        if [ -f "$f" ]; then rm "$f"; respond 204 ''; else respond 422 '{}'; fi ;;
    "POST git/commits")
        n=$(( $(cat "$STUB_DIR/n" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$STUB_DIR/n"
        sha="$(printf 'c%05d' "$n")"
        jq -j .message <<<"$data" >"$STUB_DIR/commits/$sha"
        jq -r '.parents[0] // ""' <<<"$data" >"$STUB_DIR/commits/$sha.parent"
        respond 201 "{\"sha\":\"$sha\"}" ;;
    "GET git/commits/head") respond 200 '{"tree":{"sha":"tree0"}}' ;;
    "GET git/commits/"*) f="$STUB_DIR/commits/${path#git/commits/}"
        if [ -f "$f" ]; then respond 200 "$(jq -nc --rawfile m "$f" '{message: $m}')"; else respond 404 '{}'; fi ;;
    "GET actions/runs/"*) f="$STUB_DIR/runs/${path#actions/runs/}"
        if [ -f "$f" ]; then respond 200 "$(jq -nc --arg s "$(cat "$f")" '{status: $s}')"; else respond 404 '{}'; fi ;;
    *) respond 500 '{}' ;;
esac
STUB
chmod +x "$WORK/bin2/curl"

FIFO="" POLL_RC=0
QREF=locks/discord-smoke/queue
fifo_reset() {
    CURRENT_TEST_NAME="$1"; FIFO="$WORK/fifo-$(printf '%s' "$1" | cut -c1 | tr -c 'a-z' _)"
    mkdir -p "$FIFO/refs/$QREF" "$FIFO/commits" "$FIFO/runs"; : >"$FIFO/calls"
}
set_run() { echo "$2" >"$FIFO/runs/$1"; }
# seed_ticket <run_id> <attempt> [queued_at]: a ticket some other job wrote earlier.
seed_ticket() {
    local sha; sha="$(printf 'd%05d%s' "$1" "$2")"
    printf 'discord-smoke queue\n\nrun_id=%s\nrun_attempt=%s\nrun_url=http://stub.invalid/%s\nqueued_at=%s\n' \
        "$1" "$2" "$1" "${3:-$(date +%s)}" >"$FIFO/commits/$sha"
    echo "$sha" >"$FIFO/refs/$QREF/$1-$2"
}
# poll_as <run_id> <attempt> <pool>: one poll_once (with a run-status check) as that run.
poll_as() {
    (
        unset GITHUB_TOKEN GITHUB_SERVER_URL LEASE_REF_NAMESPACE LEASE_NAME GITHUB_ENV
        export PATH="$WORK/bin2:$PATH" STUB_DIR="$FIFO" GITHUB_SHA=head GITHUB_OUTPUT="$FIFO/gho-$1"
        export GITHUB_REPOSITORY=o/r GITHUB_RUN_ID="$1" GITHUB_RUN_ATTEMPT="$2" \
            GH_TOKEN=stub-not-a-real-token GITHUB_API_URL=http://stub.invalid \
            LEASE_POOL_SIZE="$3" LEASE_LIB_ONLY=1
        # shellcheck disable=SC1090
        source "$LEASE_SCRIPT"
        poll_once 1
    ) >"$FIFO/out-$1-$2" 2>&1
    POLL_RC=$?
}
# release_as <run_id> <attempt>: the always() release step with no lease held.
release_as() {
    (
        unset GITHUB_TOKEN GITHUB_SERVER_URL LEASE_REF_NAMESPACE LEASE_NAME LEASE_REF LEASE_SHA
        export PATH="$WORK/bin2:$PATH" STUB_DIR="$FIFO" GITHUB_REPOSITORY=o/r GITHUB_RUN_ID="$1" \
            GITHUB_RUN_ATTEMPT="$2" GH_TOKEN=stub-not-a-real-token GITHUB_API_URL=http://stub.invalid
        bash "$LEASE_SCRIPT" release
    ) >"$FIFO/out-release" 2>&1
}
expect_rc() {  # expect_rc <expected> <label>
    if [ "$POLL_RC" -eq "$1" ]; then pass; else fail "$2: poll_once returned $POLL_RC, expected $1"; fi
}
slot_run() {  # prints the run_id holding slot <idx>, or "free"
    local f="$FIFO/refs/locks/discord-smoke/$1"
    if [ -f "$f" ]; then sed -n 's/^run_id=//p' "$FIFO/commits/$(cat "$f")"; else echo free; fi
}
expect_slot() {  # expect_slot <idx> <run_id|free> <label>
    local got; got="$(slot_run "$1")"
    if [ "$got" = "$2" ]; then pass; else fail "$3: slot $1 held by '$got', expected '$2'"; fi
}
expect_ticket() {  # expect_ticket <name> <present|absent> <label>
    local got=absent; [ -f "$FIFO/refs/$QREF/$1" ] && got=present
    if [ "$got" = "$2" ]; then pass; else fail "$3: ticket $1 is $got, expected $2"; fi
}

fifo_reset "i: older waiter wins a freed slot over a newer one that polls first"
set_run 200 in_progress; set_run 300 in_progress
seed_ticket 200 1
poll_as 300 1 1
expect_rc 1 "newer run 300 must wait behind 200"
expect_slot 0 free "newer run must not take the slot"
expect_ticket 300-1 present "newer run queues a ticket"
poll_as 200 1 1
expect_rc 0 "older run 200 acquires"
expect_slot 0 200 "older run holds slot 0"
expect_ticket 200-1 absent "ticket deleted on acquire"
poll_as 300 1 1
expect_rc 1 "300 still waits while 200 holds the slot"
rm "$FIFO/refs/locks/discord-smoke/0"   # 200 releases
poll_as 300 1 1
expect_rc 0 "300 acquires once it is the oldest"
expect_slot 0 300 "300 holds slot 0"

fifo_reset "j: two free slots admit the two oldest waiters"
set_run 100 in_progress; set_run 200 in_progress; set_run 300 in_progress
seed_ticket 100 1; seed_ticket 200 1
poll_as 300 1 2
expect_rc 1 "third-oldest waits with two older live tickets"
poll_as 200 1 2
expect_rc 0 "second-oldest is admitted to a pool of 2"
poll_as 100 1 2
expect_rc 0 "oldest is admitted to the remaining slot"
expect_slot 0 200 "slot 0"
expect_slot 1 100 "slot 1"
poll_as 300 1 2
expect_rc 1 "third-oldest waits while both slots are held"

fifo_reset "k: dead tickets ahead are skipped and dropped"
set_run 100 completed; set_run 150 in_progress; set_run 200 in_progress
seed_ticket 100 1                                  # run finished, ticket left behind
seed_ticket 120 1                                  # run gone (404)
seed_ticket 150 1 "$(( $(date +%s) - 99999 ))"     # older than LEASE_STALE_S
poll_as 200 1 1
expect_rc 0 "dead tickets do not block run 200"
expect_slot 0 200 "run 200 holds slot 0"
expect_ticket 100-1 absent "completed run's ticket dropped"
expect_ticket 120-1 absent "gone run's ticket dropped"
expect_ticket 150-1 absent "over-age ticket dropped"
CASE_DIR="$FIFO"; cp "$FIFO/out-200-1" "$FIFO/out"
assert_out 'dropping queue ticket 100-1 \(run 100 is completed\)' "drop reason logged"

fifo_reset "l: a re-run keeps its run's place and drops its earlier attempt's ticket"
set_run 200 in_progress; set_run 300 in_progress
seed_ticket 200 1; seed_ticket 300 1
poll_as 200 2 1
expect_rc 0 "attempt 2 of the older run goes ahead of run 300"
expect_ticket 200-1 absent "earlier attempt's ticket dropped"

fifo_reset "m: release deletes this run's ticket even when no lease is held"
seed_ticket 200 1
release_as 200 1
expect_ticket 200-1 absent "release step dequeues a run that never acquired"

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do echo "  - $f"; done
    exit 1
fi
exit 0
