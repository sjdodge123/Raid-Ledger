#!/usr/bin/env bash
# ROK-1469 D6 — `rl settings push`'s plaintext-bundle builder.
#
# The bundle carries COMMUNITY-WIDE API keys to the VM so a fleet deploy no
# longer needs the operator's laptop DB (Docker Desktop off ⇒ every env came
# up keyless). What it must NOT carry is anything slot- or identity-scoped:
# a bot token in the bundle would be re-applied to every env and undo the
# per-slot identities this story exists to create.
#
# Real crypto round-trip: fixtures are encrypted with rl-encrypt-setting.mjs
# (the same algorithm as api/src/settings/encryption.util.ts).

set -uo pipefail

CURRENT_TEST_FILE="rl-settings-bundle.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
ENCRYPT="$REPO_ROOT/scripts/rl-encrypt-setting.mjs"
BUNDLE="$REPO_ROOT/scripts/rl-settings-bundle.mjs"
SECRET="bundle-test-secret"

PASS=0; FAIL=0; FAILED=()
check() { # check <label> <actual> <expected>
    if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else
        FAIL=$((FAIL+1)); FAILED+=("$1"); echo "FAIL [$CURRENT_TEST_FILE] $1"
        echo "  expected: $3"; echo "  actual:   $2"
    fi
}

row() { printf '%s\t%s\n' "$1" "$(node "$ENCRYPT" "$SECRET" "$2")"; }

TSV=$( { row itad_api_key "itad-123"
         row cooptimus_user_agent "RL/1.0"
         row blizzard_client_id "bliz-id"
         row ai_openai_api_key "sk-openai"
         row discord_bot_token "SHOULD-NOT-TRAVEL"
         row discord_client_secret "SHOULD-NOT-TRAVEL"
         row discord_callback_url "http://localhost:3000/cb"
         row client_url "http://localhost:5173"; } )

OUT=$(printf '%s\n' "$TSV" | RL_BUNDLE_SRC_SECRET="$SECRET" node "$BUNDLE" 2>/dev/null)
RC=$?

check "exits 0 on a well-formed TSV" "$RC" "0"
check "shared ITAD key is included" "$(jq -r '.itad_api_key' <<<"$OUT")" "itad-123"
check "Co-Optimus UA is included" "$(jq -r '.cooptimus_user_agent' <<<"$OUT")" "RL/1.0"
check "Blizzard id is included" "$(jq -r '.blizzard_client_id' <<<"$OUT")" "bliz-id"
check "LLM key is included" "$(jq -r '.ai_openai_api_key' <<<"$OUT")" "sk-openai"
check "bot token is EXCLUDED (per-slot identity)" "$(jq -r '.discord_bot_token // "absent"' <<<"$OUT")" "absent"
check "OAuth client secret is EXCLUDED" "$(jq -r '.discord_client_secret // "absent"' <<<"$OUT")" "absent"
check "deployment-bound callback URL is EXCLUDED" "$(jq -r '.discord_callback_url // "absent"' <<<"$OUT")" "absent"
check "deployment-bound client_url is EXCLUDED" "$(jq -r '.client_url // "absent"' <<<"$OUT")" "absent"

if [[ "$OUT" == *"SHOULD-NOT-TRAVEL"* ]]; then
    FAIL=$((FAIL+1)); FAILED+=("identity secret leaked into the bundle")
    echo "FAIL [$CURRENT_TEST_FILE] identity secret leaked into the bundle"
else
    PASS=$((PASS+1))
fi

# An undecryptable row must fail loudly — a silently-dropped API key looks
# like a working deploy until a feature 404s.
BAD=$(printf 'itad_api_key\tnot-hex-garbage\n' | RL_BUNDLE_SRC_SECRET="$SECRET" node "$BUNDLE" 2>/dev/null; echo "rc=$?")
check "undecryptable row exits non-zero" "$(grep -o 'rc=[0-9]*' <<<"$BAD")" "rc=3"

# No secret configured is an invocation error, not an empty bundle.
printf 'itad_api_key\tx\n' | node "$BUNDLE" >/dev/null 2>&1
check "missing RL_BUNDLE_SRC_SECRET exits 2" "$?" "2"

# Empty input yields an empty object (a wiped local DB), never a crash.
EMPTY=$(printf '' | RL_BUNDLE_SRC_SECRET="$SECRET" node "$BUNDLE" 2>/dev/null)
check "empty stdin yields {}" "$EMPTY" "{}"

echo "--- $CURRENT_TEST_FILE: $PASS pass, $FAIL fail ---"
if (( FAIL > 0 )); then printf '  - %s\n' "${FAILED[@]}"; exit 1; fi
