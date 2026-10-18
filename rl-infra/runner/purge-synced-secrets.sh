#!/usr/bin/env bash
# ROK-1849 — remove laptop `.env` secrets from a fleet runner's synced worktree.
#
# Usage: bash purge-synced-secrets.sh <worktree-root>
#   in the runner:  bash /workspace/rl-infra/runner/purge-synced-secrets.sh /workspace
#   on the VM host: bash purge-synced-secrets.sh /srv/rl-infra/runners/slot-N/worktree
#
# The Mutagen session (rl-infra/cli/rl::ensure_mutagen_sync) used to sync every
# gitignored `.env` file to the VM at 0644, so root `.env`, `api/.env` and
# `tools/test-bot/.env` were readable by any branch code in the runner. The
# session now ignores them, but Mutagen never deletes an ignored path on the
# beta side, so copies left by an older session have to be removed here.
#
# Deletes regular files named `.env` or `.env.*`, keeping tracked templates
# (`*.example`). Prunes node_modules (never synced from the laptop — any `.env`
# there belongs to a package) and .git (scaffolded on the runner). Prints the
# relative path of each file removed, never its contents.

set -euo pipefail

root="${1:-}"
if [[ -z "$root" || ! -d "$root" ]]; then
    echo "purge-synced-secrets: worktree root '$root' is not a directory" >&2
    exit 2
fi

find "$root" \
    \( -name node_modules -o -name .git \) -prune -o \
    -type f \( -name '.env' -o -name '.env.*' \) ! -name '*.example' \
    -print -exec rm -f {} + \
    | sed "s|^$root/|purged: |"
