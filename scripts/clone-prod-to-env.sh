#!/usr/bin/env bash
# =============================================================================
# clone-prod-to-env.sh - Clone prod data into an rl-infra test env
# =============================================================================
# Three-step pipeline: (1) refresh operator's local DB from prod via
# clone-prod-to-local.sh, (2) apply the tree's migrations to that clone with
# `npm run db:migrate -w api` (the programmatic migrator), then (3) push the
# local DB into the test env with sync-local-to-env.sh in `full` mode.
#
# Why step 2 (D11): the sync is data-only and skips drizzle.*, and the env's
# API migrated its own (seed) DB at boot, so a branch migration — schema OR a
# data re-credit — would otherwise never run on the prod rows. Migrating the
# local clone first is exactly what prod's next deploy will do, and leaves the
# local schema equal to the env's, so the data-only sync lines up.
#
# Requires:
#   - A clone env file (~/.config/raid-ledger/env.clone recommended; see
#     clone-prod-to-local.sh --help for the lookup order).
#   - The local Postgres container running (raid-ledger-db). The local API
#     does not need to be up.
#   - The target env spun: `rl env spin --slug <slug>`.
#
# Usage:
#   ./scripts/clone-prod-to-env.sh <slug> [--skip-local-refresh] [--skip-migrate] [--tree <path>]
#
# --tree <path> (default: git top-level of $PWD) is the checkout whose
# migrations step 2 applies, whose deploy_dev.sh resets the admin password and
# whose .env.clone is a fallback. The clone env file is resolved ONCE here and
# its DATABASE_URL / LOCAL_DB_CONTAINER are handed to every step, so all three
# hit the same database. --skip-migrate skips step 2 (tree not npm-installed).
#
# Skip the prod-refresh step if you've recently cloned prod to local and just
# want to push that snapshot into another env (much faster — no prod backup).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/clone-prod-env.sh
source "$SCRIPT_DIR/lib/clone-prod-env.sh"
USAGE="usage: $0 <slug> [--skip-local-refresh] [--skip-migrate] [--tree <path>]"

SLUG=""
SKIP_LOCAL_REFRESH=false
SKIP_MIGRATE=false
TREE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-local-refresh) SKIP_LOCAL_REFRESH=true; shift ;;
        --skip-migrate) SKIP_MIGRATE=true; shift ;;
        --tree)
            [[ $# -ge 2 ]] || { echo "--tree needs a path" >&2; exit 2; }
            TREE="$2"; shift 2 ;;
        -*) echo "unknown flag: $1" >&2; exit 2 ;;
        *) [[ -z "$SLUG" ]] && SLUG="$1"; shift ;;
    esac
done

[[ -z "$SLUG" ]] && { echo "$USAGE" >&2; exit 2; }
[[ -n "$TREE" ]] || TREE="$(clone_env_default_tree)"
[[ -n "$TREE" && -d "$TREE" ]] || { clone_env_err "no tree: pass --tree <path> (got '${TREE}')"; exit 2; }
TREE="$(cd "$TREE" && pwd)"

# Resolve the clone env ONCE (review fix B5). The child clone script re-reads
# the same file via RL_ENV_CLONE_FILE; only the two local-DB values are read
# here, in a subshell, so no prod secret enters this process.
ENV_FILE="$(clone_env_resolve_file "$TREE")" || exit 1
export RL_ENV_CLONE_FILE="$ENV_FILE"
DB_VALUES="$(clone_env_load "$ENV_FILE"; printf '%s\n%s\n' "${DATABASE_URL:-}" "${LOCAL_DB_CONTAINER:-raid-ledger-db}")"
CLONE_DATABASE_URL="$(sed -n 1p <<<"$DB_VALUES")"
CLONE_DB_CONTAINER="$(sed -n 2p <<<"$DB_VALUES")"
clone_env_assert_local_db_url "$CLONE_DATABASE_URL" "DATABASE_URL in $ENV_FILE" || exit 1

if [[ "$SKIP_LOCAL_REFRESH" == "true" ]]; then
    echo "Skipping prod→local refresh (--skip-local-refresh)." >&2
else
    echo "Step 1: refreshing operator's local DB from prod..." >&2
    "$SCRIPT_DIR/clone-prod-to-local.sh" --fresh --yes --tree "$TREE"
fi

if [[ "$SKIP_MIGRATE" == "true" ]]; then
    echo "Skipping db:migrate (--skip-migrate): branch migrations will NOT reach '$SLUG'." >&2
else
    echo "Step 2: applying $TREE's migrations to the local clone (npm run db:migrate -w api)..." >&2
    if ! (cd "$TREE" && DATABASE_URL="$CLONE_DATABASE_URL" npm run db:migrate -w api); then
        clone_env_err "db:migrate failed in $TREE — not syncing a half-migrated DB into '$SLUG'."
        clone_env_err "Fix it, then re-run with --skip-local-refresh."
        exit 1
    fi
fi

echo "Step 3: pushing local DB into env '$SLUG'..." >&2
SYNC_DATABASE_URL="$CLONE_DATABASE_URL" SYNC_LOCAL_DB_CONTAINER="$CLONE_DB_CONTAINER" \
    "$SCRIPT_DIR/sync-local-to-env.sh" "$SLUG" full

echo "Clone-prod-to-env complete: env '$SLUG' now has prod-shaped data." >&2
