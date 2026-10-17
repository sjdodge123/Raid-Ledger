#!/usr/bin/env bash
# =============================================================================
# clone-prod-to-env.sh - Clone prod data into an rl-infra test env
# =============================================================================
# Two-step pipeline: (1) refresh operator's local DB from prod via the existing
# clone-prod-to-local.sh, then (2) push that local DB into the test env using
# sync-local-to-env.sh in `full` mode. Both steps are idempotent.
#
# Requires:
#   - .env.clone at repo root (used by clone-prod-to-local.sh).
#   - Operator's local dev env running (raid-ledger-db container up).
#   - The target env spun: `rl env spin --slug <slug>`.
#
# Usage:
#   ./scripts/clone-prod-to-env.sh <slug> [--skip-local-refresh]
#
# Skip the prod-refresh step if you've recently cloned prod to local and just
# want to push that snapshot into another env (much faster — no prod backup).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SLUG="${1:-}"
SKIP_LOCAL_REFRESH=false
for arg in "$@"; do
    case "$arg" in
        --skip-local-refresh) SKIP_LOCAL_REFRESH=true ;;
    esac
done

[[ -z "$SLUG" ]] && { echo "usage: $0 <slug> [--skip-local-refresh]" >&2; exit 2; }

if [[ "$SKIP_LOCAL_REFRESH" == "true" ]]; then
    echo "Skipping prod→local refresh (--skip-local-refresh)." >&2
else
    echo "Step 1: refreshing operator's local DB from prod..." >&2
    "$SCRIPT_DIR/clone-prod-to-local.sh" --fresh --yes
fi

echo "Step 2: pushing local DB into env '$SLUG'..." >&2
"$SCRIPT_DIR/sync-local-to-env.sh" "$SLUG" full

echo "Clone-prod-to-env complete: env '$SLUG' now has prod-shaped data." >&2
