#!/usr/bin/env bash
# ROK-1331 M6a — sync-local-to-env.sh cleanups (TDD red).
#
# AC1  — `dump_discord_identity` block emits BEGIN/DELETE-orphan/INSERT-ON-CONFLICT/COMMIT
#        with literal-value interpolation (NO $N placeholders), and the INSERT
#        includes the `username` column (NOT NULL constraint per api/src/drizzle/schema/users.ts).
# AC10 — `resolve_local_jwt_secret` strips surrounding double or single quotes.
# AC11 — worktree-fallback echoes the resolved source path to stderr.
#
# Strategy: shell-source the script's helper functions in a sub-shell so we
# can test individual hunks without actually invoking ssh/docker. The
# `dump_discord_identity` block tests grep the SCRIPT TEXT for a small set of
# canonical fragments (the dev MUST add them when implementing).

set -uo pipefail
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
SYNC_SCRIPT="$REPO_ROOT/scripts/sync-local-to-env.sh"

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

[[ -f "$SYNC_SCRIPT" ]] || { echo "missing $SYNC_SCRIPT"; exit 1; }

# ---------------------------------------------------------------------------
# AC1 — dump_discord_identity block exists and shapes correctly.
# ---------------------------------------------------------------------------

# 1a. The script MUST contain a `dump_discord_identity` function or block.
if grep -qE 'dump_discord_identity|DISCORD IDENTITY|discord identity' "$SYNC_SCRIPT"; then
    pass
else
    fail "AC1a: sync-local-to-env.sh has no 'dump_discord_identity' block"
fi

# 1b. The new block MUST contain a BEGIN; ... COMMIT; transaction.
if grep -qE 'BEGIN\s*;' "$SYNC_SCRIPT" && grep -qE 'COMMIT\s*;' "$SYNC_SCRIPT"; then
    pass
else
    fail "AC1b: sync-local-to-env.sh missing BEGIN;/COMMIT; transaction wrapper"
fi

# 1c. The block MUST DELETE the orphan local placeholder users + creds.
if grep -qE "DELETE\s+FROM\s+local_credentials\s+WHERE\s+email\s*=\s*'admin@local'" "$SYNC_SCRIPT" \
        && grep -qE "DELETE\s+FROM\s+users\s+WHERE\s+discord_id\s*=\s*'local:admin@local'" "$SYNC_SCRIPT"; then
    pass
else
    fail "AC1c: missing DELETE-orphan SQL for local_credentials + users"
fi

# 1d. The INSERT MUST include the `username` column (NOT NULL constraint).
#     Architect pre-dev 2026-05-20 corrected this — earlier draft omitted it.
if grep -qE "INSERT\s+INTO\s+users\s*\([^)]*username[^)]*\)" "$SYNC_SCRIPT"; then
    pass
else
    fail "AC1d: dump_discord_identity INSERT must include 'username' column"
fi

# 1e. The INSERT MUST use ON CONFLICT (discord_id) DO UPDATE for idempotency.
if grep -qE 'ON\s+CONFLICT\s*\(\s*discord_id\s*\)\s+DO\s+UPDATE' "$SYNC_SCRIPT"; then
    pass
else
    fail "AC1e: INSERT must use ON CONFLICT (discord_id) DO UPDATE"
fi

# 1f. The INSERT MUST use literal-value interpolation, NOT psql $N placeholders.
#     psql heredocs don't bind prepared params; agents must build the SQL
#     via bash printf/quote helpers, not parameterized placeholders.
#     Detect: any line near the INSERT that contains `$1` or `$2` placeholder
#     syntax (with `VALUES (...$N`).
if grep -E 'VALUES\s*\([^)]*\$[0-9]' "$SYNC_SCRIPT" >/dev/null 2>&1; then
    fail "AC1f: INSERT uses \$N placeholders — psql heredocs require literal-value interpolation"
else
    pass
fi

# ---------------------------------------------------------------------------
# AC10 — resolve_local_jwt_secret strips surrounding quotes.
# ---------------------------------------------------------------------------

# Quote stripping is implemented inside resolve_local_jwt_secret. We don't
# easily get to call the function in isolation because the script `set -e`'s
# and assumes docker is present. Instead source the script's function
# definition into a sub-shell by extracting between `resolve_local_jwt_secret() {`
# and the next closing `}` at column 0.
RESOLVE_FN=$(awk '
    /^resolve_local_jwt_secret\(\)/ { in_fn=1; print; next }
    in_fn && /^}/ { print; in_fn=0; exit }
    in_fn { print }
' "$SYNC_SCRIPT")

if [[ -z "$RESOLVE_FN" ]]; then
    fail "AC10: cannot find resolve_local_jwt_secret() function"
else
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT
    mkdir -p "$TMP_DIR/api"
    echo 'JWT_SECRET="quoted-double-abc"' > "$TMP_DIR/api/.env"

    # Synthesize a shim that exposes the function so we can call it.
    SHIM="$TMP_DIR/shim.sh"
    {
        echo "#!/usr/bin/env bash"
        echo "set -uo pipefail"
        echo "REPO_ROOT='$TMP_DIR'"
        # Quiet git so the function takes the fallback path.
        echo "git() { return 1; }"
        echo "export -f git"
        echo "$RESOLVE_FN"
        echo "resolve_local_jwt_secret"
    } > "$SHIM"
    chmod +x "$SHIM"

    actual_double=$(bash "$SHIM" 2>/dev/null || true)
    if [[ "$actual_double" == "quoted-double-abc" ]]; then
        pass
    else
        fail "AC10a: double quotes not stripped (got: $actual_double)"
    fi

    # Now single quotes.
    echo "JWT_SECRET='quoted-single-xyz'" > "$TMP_DIR/api/.env"
    actual_single=$(bash "$SHIM" 2>/dev/null || true)
    if [[ "$actual_single" == "quoted-single-xyz" ]]; then
        pass
    else
        fail "AC10b: single quotes not stripped (got: $actual_single)"
    fi
fi

# ---------------------------------------------------------------------------
# AC11 — worktree-fallback emits resolved-source-path to stderr.
# ---------------------------------------------------------------------------

if [[ -n "$RESOLVE_FN" ]]; then
    # Check the function body for an `echo ... resolved LOCAL_JWT_SECRET ... >&2`
    # trace. Dev MUST add this.
    if echo "$RESOLVE_FN" | grep -qE 'resolved\s+LOCAL_JWT_SECRET.*>&2'; then
        pass
    else
        fail "AC11: resolve_local_jwt_secret missing stderr trace 'resolved LOCAL_JWT_SECRET from <path>'"
    fi
fi

# ---------------------------------------------------------------------------
echo "==="
echo "sync-local-to-env.test.sh: $PASS passed, $FAIL failed"
if (( FAIL > 0 )); then
    printf '  - %s\n' "${FAILED_NAMES[@]}"
    exit 1
fi
