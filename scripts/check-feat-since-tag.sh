#!/usr/bin/env bash
# ROK-1475 — "no feat: since the last tag" gate.
#
# A version number should only move when something a user would call a feature
# shipped. This answers that question from the git history, so the rule is
# enforced by CI instead of remembered by whoever cuts the release.
#
#   scripts/check-feat-since-tag.sh [--ref <ref>] [--mode fail|warn]
#
#     --ref   commit-ish the release would be cut at (default HEAD).
#     --mode  fail (default) -> exit 1 when no feature commit is found.
#             warn           -> always exit 0, printing a ::warning:: line.
#
#   exit 0  a feature-class commit exists in the span (or there is no previous
#           v* tag yet, i.e. the first-ever release), or --mode warn.
#   exit 1  --mode fail and the span holds no feature-class commit.
#   exit 2  usage error / not a git repository / SHALLOW checkout — a checkout
#           without tag history cannot answer the question, so it must not be
#           allowed to fail open (never silently green).
#
# Feature-class = the FULL commit body (%B) of any commit in the span matches
# `feat:` / `feat(scope):` / `feat!:` (unanchored — real squash subjects look
# like `fix(events) + feat(lfg-board): ...`, and combined-merge commits carry
# their `feat(...)` lines in the body) or a `BREAKING CHANGE:` footer.
#
# bash 3.2 safe (macOS); ci.yml runs `bash -n` over scripts/*.sh.
set -uo pipefail

REF="HEAD"
MODE="fail"

# `feat` must not be preceded by an alphanumeric (so `featured` never matches)
# and must be followed by the conventional-commit colon, optionally after a
# (scope) and/or a `!`.
FEAT_RE='(^|[^[:alnum:]])feat(\([^)]+\))?!?:'
BREAK_RE='(^|[[:space:]])BREAKING[ -]CHANGE:'

usage() {
    echo "usage: $(basename "$0") [--ref <ref>] [--mode fail|warn]" >&2
    exit 2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ref)  [[ $# -ge 2 ]] || usage; REF="$2"; shift 2 ;;
        --mode) [[ $# -ge 2 ]] || usage; MODE="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "error: unknown argument '$1'" >&2; usage ;;
    esac
done

[[ "$MODE" == "fail" || "$MODE" == "warn" ]] || { echo "error: --mode must be fail or warn" >&2; usage; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "error: not a git repository" >&2; exit 2; }

# A shallow clone carries no tag history, so `git describe` finds nothing and the
# script would print the permissive `first-tag:` line — disarming the guard on
# every run without anyone noticing. Refuse instead of failing open.
if [[ "$(git rev-parse --is-shallow-repository 2>/dev/null || echo false)" == "true" ]]; then
    echo "error: shallow checkout — no tag history, so this guard cannot answer. Use 'fetch-depth: 0' (and fetch-tags: true) on actions/checkout." >&2
    exit 2
fi

git rev-parse --verify --quiet "${REF}^{commit}" >/dev/null || { echo "error: cannot resolve ref '$REF'" >&2; exit 2; }

# Where to describe the previous release tag from:
#
#   REF is itself a v* tag  -> describe from its PARENT ("the tag before this
#                              one"): docker-publish's warn mode runs ON the tag
#                              being published and must not describe itself.
#   anything else (HEAD)    -> describe from REF itself. release.yml's pre-flight
#                              runs before the tag is cut; if HEAD already CARRIES
#                              a v* tag, the parent form would skip it and rescan
#                              the previous release span, letting an old feat:
#                              authorise a no-op version bump (span must be empty).
#
# --match 'v*' is load-bearing: non-release tags exist in this repo.
DESCRIBE_FROM="$REF"
case "$REF" in
    v*) git rev-parse --verify --quiet "refs/tags/${REF}" >/dev/null && DESCRIBE_FROM="${REF}^" ;;
esac

PREV="$(git describe --tags --abbrev=0 --match 'v*' "$DESCRIBE_FROM" 2>/dev/null || true)"

if [[ -z "$PREV" ]]; then
    echo "first-tag: no previous v* tag reachable from ${DESCRIBE_FROM}, allowing"
    exit 0
fi

SPAN="${PREV}..${REF}"
COUNT="$(git rev-list --count "$SPAN")"
echo "prev-tag: $PREV"
echo "span: $SPAN ($COUNT commits)"

MATCH="NONE"
while IFS= read -r sha; do
    [[ -n "$sha" ]] || continue
    body="$(git log -1 --format=%B "$sha")"
    if grep -Eq "$FEAT_RE" <<<"$body" || grep -Eq "$BREAK_RE" <<<"$body"; then
        MATCH="$(git log -1 --format=%s "$sha")"
        break
    fi
done < <(git rev-list --reverse "$SPAN")

echo "match: $MATCH"

if [[ "$MATCH" != "NONE" ]]; then
    echo "result: PASS — a feature-class commit shipped since $PREV"
    exit 0
fi

if [[ "$MODE" == "warn" ]]; then
    echo "::warning::No feat:/BREAKING CHANGE commit between $PREV and $REF — this version bump carries no features."
    echo "======================================================================"
    echo " WARNING: $REF has no feature-class commit since $PREV."
    echo " Fix-only spans should ship as a build, not as a new version."
    echo "======================================================================"
    exit 0
fi

echo "error: no feat:/BREAKING CHANGE commit between $PREV and $REF — do not cut a version for a fix-only span." >&2
exit 1
