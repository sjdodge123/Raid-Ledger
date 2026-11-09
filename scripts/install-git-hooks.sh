#!/bin/sh
# Install the repo's local git hooks (scripts/git-hooks/*) into the shared
# hooks dir, so every worktree uses them. Safe to re-run; refuses to replace
# a hook that is not ours.
set -eu
root=$(git rev-parse --show-toplevel)
hooks=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)/hooks
mkdir -p "$hooks"
for src in "$root"/scripts/git-hooks/*; do
  name=$(basename "$src")
  dest="$hooks/$name"
  if [ -e "$dest" ] && ! grep -q "Raid Ledger:" "$dest"; then
    echo "skip $name: $dest exists and is not a Raid Ledger hook" >&2
    continue
  fi
  cp "$src" "$dest"
  chmod +x "$dest"
  echo "installed $name"
done
