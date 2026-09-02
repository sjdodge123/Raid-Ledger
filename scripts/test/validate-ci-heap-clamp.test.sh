#!/usr/bin/env bash
# ROK-1451 L4 — validate-ci.sh must clamp the cgroup-derived V8 heap ceiling.
#
# The container branch of run_unit_tests read /sys/fs/cgroup/memory.max
# verbatim. Cgroup v2 writes the literal "max" for "no limit" (already
# handled), but some runtimes report the PAGE_COUNTER_MAX sentinel
# (9223372036854771712) instead. 75% of that is a nonsense
# --max-old-space-size that breaks the run in a way that looks like a test
# failure rather than a misconfiguration.
#
# `resolve_heap_mb` is the pure clamp: it echoes a heap size only when the
# derived value is in (0, 16384] MB, and echoes nothing otherwise so the
# caller falls through to the npm script's own ceiling.
#
# Sourced with RL_VALIDATE_CI_DRY=1, which exposes the functions without
# running the pipeline.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-heap-clamp.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

TEST_PASS_COUNT=0
TEST_FAIL_COUNT=0
TEST_FAIL_NAMES=()

pass() { TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1)); }
fail() {
    TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
    TEST_FAIL_NAMES+=("$1")
    echo "FAIL [$CURRENT_TEST_FILE] $1"
}

# shellcheck source=/dev/null
RL_VALIDATE_CI_DRY=1 . "$REPO_ROOT/scripts/validate-ci.sh"

if ! declare -F resolve_heap_mb >/dev/null 2>&1; then
    fail "resolve_heap_mb is not defined in scripts/validate-ci.sh"
    echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
    exit 1
fi

assert_heap() {
    local input="$1" expected="$2" label="$3" actual
    actual="$(resolve_heap_mb "$input" || true)"
    if [ "$actual" = "$expected" ]; then
        pass
    else
        fail "$label: resolve_heap_mb '$input' -> '$actual', expected '$expected'"
    fi
}

# A real 4 GiB container still gets its 75% ceiling (the ROK-1451 slot-1 case).
assert_heap 4294967296 3072 "4 GiB cgroup limit"
# 2 GiB -> 1536 MB, still inside the clamp.
assert_heap 2147483648 1536 "2 GiB cgroup limit"
# Cgroup v2 "no limit" sentinel, spelled as a word.
assert_heap max "" "literal max"
# PAGE_COUNTER_MAX — the sentinel this fix exists for.
assert_heap 9223372036854771712 "" "PAGE_COUNTER_MAX sentinel"
# Anything above the 16 GiB clamp falls through to the npm script.
assert_heap 34359738368 "" "32 GiB limit exceeds the clamp"
# Unreadable / absent cgroup file.
assert_heap "" "" "empty limit"
# Garbage must not be arithmetic-expanded.
assert_heap "not-a-number" "" "non-numeric limit"
# A limit so small the 75% share rounds to zero.
assert_heap 1024 "" "sub-megabyte limit"

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do echo "  - $f"; done
    exit 1
fi
exit 0
