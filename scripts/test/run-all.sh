#!/usr/bin/env bash
# Run every scripts/test/*.test.sh in sequence. Used as a single entrypoint
# for the M6a chunk-2 SUGGESTION assertions (sync-local-to-env quote-strip,
# worktree-fallback stderr trace, rl-reencrypt dollar-quoting + summary).
#
# Each .test.sh script must:
#   - Exit 0 on success.
#   - Exit non-zero on any failure (set -e suffices for most).
#   - Print FAIL/PASS lines to stdout.

set -uo pipefail
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TOTAL=0
PASS=0
FAIL=0
FAILED=()
for t in "$TEST_DIR"/*.test.sh; do
    [[ -e "$t" ]] || { echo "no .test.sh files in $TEST_DIR"; exit 1; }
    TOTAL=$((TOTAL + 1))
    if "$t"; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        FAILED+=("$(basename "$t")")
    fi
done

echo "==="
echo "scripts/test: $PASS/$TOTAL passed"
if (( FAIL > 0 )); then
    printf '  - %s\n' "${FAILED[@]}"
    exit 1
fi
