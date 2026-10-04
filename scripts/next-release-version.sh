#!/usr/bin/env bash
# Print the next release version, derived from the repo's existing v* tags.
#
#   bash scripts/next-release-version.sh <patch|minor|major>
#
# stdout: the bare next version (X.Y.Z, no leading v) and nothing else.
# Base:   the GLOBAL highest tag matching ^v[0-9]+\.[0-9]+\.[0-9]+$ exactly, not
#         the one reachable from HEAD, so a cut can never collide with an
#         existing version. Pre-release (v2.0.0-rc1) and non-semver tags are
#         ignored.
# Exit:   0 ok; 1 if tag vNEW already exists; 2 on a missing/invalid argument,
#         outside a git repo, or when no matching tag exists (message on stderr).
#
# bash 3.2 safe: no mapfile, no ${var,,}, no associative arrays.
set -euo pipefail

die() { echo "next-release-version: $1" >&2; exit "${2:-2}"; }

[[ $# -eq 1 ]] || die "usage: next-release-version.sh <patch|minor|major>"
BUMP="$1"
case "$BUMP" in
    patch | minor | major) ;;
    *) die "invalid bump '$BUMP' (expected patch, minor or major)" ;;
esac

git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"

# Capture the full list first: piping straight into head/grep under pipefail
# would turn a SIGPIPE or an empty grep into a spurious failure.
TAGS="$(git tag -l 'v*' --sort=-v:refname)"
BASE=""
while IFS= read -r t; do
    if [[ "$t" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        BASE="$t"
        break
    fi
done <<<"$TAGS"

[[ -n "$BASE" ]] || die "no tag matching vX.Y.Z found (fetch tags: fetch-depth 0)"

IFS=. read -r MAJOR MINOR PATCH <<<"${BASE#v}"
# 10# forces base 10 so a zero-padded component is not read as octal.
MAJOR=$((10#$MAJOR))
MINOR=$((10#$MINOR))
PATCH=$((10#$PATCH))

case "$BUMP" in
    patch) PATCH=$((PATCH + 1)) ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac
NEW="$MAJOR.$MINOR.$PATCH"

if git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null; then
    die "tag v$NEW already exists (base $BASE)" 1
fi

printf '%s\n' "$NEW"
