#!/usr/bin/env bash
# ROK-1331 M6a — rl-reencrypt-settings.mjs cleanups (TDD red).
#
# AC8 — Dollar-quoted SQL: INSERT VALUES uses `$rl$...$rl$` literals
#       (NOT `'...'` single-quote escaping). Lets values containing
#       single quotes round-trip without doubling.
# AC9 — End-of-run summary on stderr matches the canonical shape:
#       `decrypted N, substituted M, total K` (or with the source/synthetic
#       breakdown the spec specifies). Operator sees `decrypted 0` as a
#       loud canary when --src-secret is wrong.

set -uo pipefail
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
HELPER="$REPO_ROOT/scripts/rl-reencrypt-settings.mjs"

PASS=0
FAIL=0
FAILED_NAMES=()
pass() { PASS=$((PASS + 1)); }
fail() {
    FAIL=$((FAIL + 1))
    FAILED_NAMES+=("$1")
    echo "FAIL: $1" >&2
}

[[ -f "$HELPER" ]] || { echo "missing $HELPER"; exit 1; }

# Stub input: one TSV row carrying a synthetic encrypted_value. We don't
# need decryption to round-trip — substitutes bypass decrypt for that key,
# so we test the substitute path which still flows through buildUpsert.
SRC_SECRET="test-src-secret-not-real-32-chars"
DST_SECRET="test-dst-secret-not-real-32-chars"

# Build one input row whose key matches a substitute we'll pass.
INPUT_TSV=$'client_url\t00000000000000000000000000000000:00000000000000000000000000000000:abcdef'

# Capture both stdout (SQL stream) and stderr (summary line).
TMP_OUT=$(mktemp)
TMP_ERR=$(mktemp)
trap 'rm -f "$TMP_OUT" "$TMP_ERR"' EXIT

set +e
echo "$INPUT_TSV" | RL_REENCRYPT_SRC_SECRET="$SRC_SECRET" \
    RL_REENCRYPT_DST_SECRET="$DST_SECRET" \
    node "$HELPER" --substitute "client_url=https://slot-1.example.com" \
    > "$TMP_OUT" 2> "$TMP_ERR"
RC=$?
set -e

SQL=$(cat "$TMP_OUT")
SUMMARY=$(cat "$TMP_ERR")

# ----------------------------------------------------------------------
# AC8 — Output SQL uses dollar-quoted literals.
# ----------------------------------------------------------------------

# The INSERT line for client_url MUST use $rl$...$rl$ wrappers.
if echo "$SQL" | grep -qE 'VALUES\s*\(\s*\$rl\$.*\$rl\$\s*,'; then
    pass
else
    fail "AC8a: INSERT VALUES does not use dollar-quoted literals (\$rl\$...\$rl\$)"
fi

# AC8b — there MUST NOT be a single-quoted INSERT value form anymore.
#       (The legacy `'...'` form is what AC8 replaces.)
if echo "$SQL" | grep -qE "VALUES\s*\(\s*'[^']*'\s*,\s*'[^']*'"; then
    fail "AC8b: INSERT still uses legacy single-quoted literals — dollar-quote not applied"
else
    pass
fi

# ----------------------------------------------------------------------
# AC9 — Stderr summary line includes `decrypted N, substituted M`.
# ----------------------------------------------------------------------

# Spec text canonical form (line 24-26 of spec):
#   decrypted N, substituted M, total K
#   OR
#   decrypted X, substituted Y from source + Z synthetic
# Either form satisfies AC9 as long as both `decrypted` and `substituted`
# appear with numbers.
if echo "$SUMMARY" | grep -qE 'decrypted\s+[0-9]+.*substituted\s+[0-9]+'; then
    pass
else
    fail "AC9: stderr summary missing 'decrypted N, substituted M' shape (got: $SUMMARY)"
fi

# AC9 canary — when ALL rows are substitute-overridden, decrypted MUST be 0.
# Our input has exactly one row whose key matches the substitute, so the
# decrypt path is never invoked; decrypted MUST report 0.
if echo "$SUMMARY" | grep -qE 'decrypted\s+0\b'; then
    pass
else
    fail "AC9 canary: when every input key was substitute-overridden, summary must show 'decrypted 0'"
fi

# ----------------------------------------------------------------------
# Exit code MUST be 0 for the substitute-only path (no decrypt attempted).
# ----------------------------------------------------------------------
if [[ "$RC" -eq 0 ]]; then
    pass
else
    fail "AC8/AC9: helper exited $RC (expected 0)"
fi

echo "==="
echo "rl-reencrypt-settings.test.sh: $PASS passed, $FAIL failed"
if (( FAIL > 0 )); then
    printf '  - %s\n' "${FAILED_NAMES[@]}"
    exit 1
fi
