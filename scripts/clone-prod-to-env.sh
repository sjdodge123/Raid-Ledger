#!/usr/bin/env bash
# =============================================================================
# clone-prod-to-env.sh - Clone prod data into an rl-infra test env
# =============================================================================
# Two-step pipeline: (1) refresh operator's local DB from prod via the existing
# clone-prod-to-local.sh, then (2) push that local DB into the test env using
# sync-local-to-env.sh in `full` mode. Both steps are idempotent.
#
# Requires:
#   - A clone env file (~/.config/raid-ledger/env.clone recommended; see
#     clone-prod-to-local.sh --help for the lookup order).
#   - The local Postgres container running (raid-ledger-db). The local API
#     does not need to be up.
#   - The target env spun: `rl env spin --slug <slug>`.
#
# Usage:
#   ./scripts/clone-prod-to-env.sh <slug> [--skip-local-refresh] [--tree <path>]
#
# --tree <path> is forwarded to clone-prod-to-local.sh: the checkout whose
# deploy_dev.sh resets the admin password and whose .env.clone is a fallback.
#
# Skip the prod-refresh step if you've recently cloned prod to local and just
# want to push that snapshot into another env (much faster — no prod backup).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SLUG=""
SKIP_LOCAL_REFRESH=false
TREE_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-local-refresh) SKIP_LOCAL_REFRESH=true; shift ;;
        --tree)
            [[ $# -ge 2 ]] || { echo "--tree needs a path" >&2; exit 2; }
            TREE_ARGS=(--tree "$2"); shift 2 ;;
        -*) echo "unknown flag: $1" >&2; exit 2 ;;
        *) [[ -z "$SLUG" ]] && SLUG="$1"; shift ;;
    esac
done

[[ -z "$SLUG" ]] && { echo "usage: $0 <slug> [--skip-local-refresh] [--tree <path>]" >&2; exit 2; }

if [[ "$SKIP_LOCAL_REFRESH" == "true" ]]; then
    echo "Skipping prod→local refresh (--skip-local-refresh)." >&2
else
    echo "Step 1: refreshing operator's local DB from prod..." >&2
    "$SCRIPT_DIR/clone-prod-to-local.sh" --fresh --yes ${TREE_ARGS[@]+"${TREE_ARGS[@]}"}
fi

echo "Step 2: pushing local DB into env '$SLUG'..." >&2
"$SCRIPT_DIR/sync-local-to-env.sh" "$SLUG" full

echo "Clone-prod-to-env complete: env '$SLUG' now has prod-shaped data." >&2
