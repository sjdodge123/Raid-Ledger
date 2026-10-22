#!/usr/bin/env bash
# renumber-branch-migrations.sh
#
# Two open PRs both generated migration 0239 on top of the same main; the one
# that lands second collides (the index-collision guard in CI and in
# `validate-ci.sh --static` fails with this command as the fix). This moves
# THIS branch's new migrations after origin/main's newest: .sql filenames,
# journal idx/tag/when, snapshot filenames and the prevId chain. SQL bodies are
# never edited. Idempotent; refuses uncommitted changes to tracked files (untracked notes are fine) (commit first — never stash).
#
# Usage:
#   ./scripts/renumber-branch-migrations.sh                 # vs origin/main (fetched first)
#   ./scripts/renumber-branch-migrations.sh --base <ref>    # vs another ref
#   ./scripts/renumber-branch-migrations.sh --no-fetch      # skip `git fetch`
#
# The base is pinned to a commit SHA after the fetch. Then: commit, `git merge
# <that sha>` (the tool prints it — never a bare origin/main, which may have moved
# since), keep ours on _journal.json, and re-run this with `--no-fetch --base
# <sha>`: it must print `nothing to renumber`. Then ./scripts/validate-migrations.sh.
# Detail: docs/runbooks/migrations-and-backups.md → "Two PRs claimed the same migration number".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="origin/main"
FETCH=true
while [ $# -gt 0 ]; do
    case "$1" in
        --base) BASE="${2:?--base needs a git ref}"; shift ;;
        --no-fetch) FETCH=false ;;
        -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
        *) echo "ERROR: unknown argument: $1" >&2; exit 3 ;;
    esac
    shift
done

ROOT="$(git rev-parse --show-toplevel)"
if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]; then
    echo "✗ refusing: the working tree is dirty. Commit (a WIP commit is fine) and re-run — never git stash." >&2
    git -C "$ROOT" status --short >&2
    exit 1
fi

if $FETCH && [[ "$BASE" == origin/* ]]; then
    git -C "$ROOT" fetch --quiet origin "${BASE#origin/}" \
        || echo "⚠ git fetch origin ${BASE#origin/} failed — using the local $BASE ref" >&2
fi

# Pin the base: everything after this (the renumber AND the merge the user runs
# next) must use this exact commit, or a main that moved in between gets dropped.
BASE_SHA="$(git -C "$ROOT" rev-parse --verify --quiet "$BASE^{commit}")" \
    || { echo "ERROR: cannot resolve $BASE to a commit (git fetch origin?)" >&2; exit 3; }

exec node "$SCRIPT_DIR/renumber-branch-migrations.mjs" --root "$ROOT" --base "$BASE_SHA" --label "$BASE"
