#!/usr/bin/env bash
# ROK-1475 AC5: unit coverage for scripts/check-feat-since-tag.sh.
#
# Every case builds a THROWAWAY git repo under a mktemp -d dir and runs the real
# script inside it, so tag resolution (`git describe --tags --abbrev=0 --match 'v*'`)
# is exercised for real and the checkout's own tags are never touched.
#
# bash 3.2 safe: no mapfile, no ${var,,}, no associative arrays.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/check-feat-since-tag.sh"

PASS=0
FAIL=0
ok()  { echo "PASS: $1"; PASS=$((PASS + 1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

if [[ ! -f "$SCRIPT" ]]; then
    echo "FAIL: missing $SCRIPT"
    exit 1
fi

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

export GIT_AUTHOR_NAME="ROK-1475 Test"
export GIT_AUTHOR_EMAIL="test@example.invalid"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

# new_repo <name> -> prints the repo path
new_repo() {
    local d="$TMPROOT/$1"
    mkdir -p "$d"
    git -c init.defaultBranch=main init -q "$d"
    printf '%s' "$d"
}

# commit <repo> <subject> [body]
commit() {
    if [[ $# -ge 3 ]]; then
        git -C "$1" commit -q --allow-empty -m "$2" -m "$3"
    else
        git -C "$1" commit -q --allow-empty -m "$2"
    fi
}

# tag <repo> <tagname>
tag() { git -C "$1" tag "$2"; }

OUT=""
RC=0
# run_check <repo> [args...] -> sets OUT and RC
run_check() {
    local repo="$1"
    shift
    OUT="$(cd "$repo" && bash "$SCRIPT" "$@" 2>&1)"
    RC=$?
}

# assert_rc <label> <expected> — reports the real exit code AND the script output.
assert_rc() {
    local label="$1" expected="$2"
    if [[ "$RC" == "$expected" ]]; then
        ok "$label"
    else
        bad "$label (expected exit $expected, got $RC; output: ${OUT//$'\n'/ | })"
    fi
}

assert_out() {
    local label="$1" needle="$2"
    if grep -qF -- "$needle" <<<"$OUT"; then
        ok "$label"
    else
        bad "$label (expected output to contain '$needle'; got: ${OUT//$'\n'/ | })"
    fi
}

# --- 1. a plain `feat:` in the span passes -----------------------------------
R="$(new_repo feat-only)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "feat: add the widget"
run_check "$R"
assert_rc "feat: alone -> exit 0" 0
assert_out "feat: alone reports the resolved previous tag" "prev-tag: v1.0.0"
assert_out "feat: alone reports the matching subject" "feat: add the widget"

# --- 2. only fix/chore/perf: fails in fail mode, warns in warn mode ----------
R="$(new_repo no-feat)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "fix: a thing"
commit "$R" "chore: another thing"
commit "$R" "perf(games): faster"
run_check "$R" --mode fail
assert_rc "fix/chore/perf only -> --mode fail exits 1" 1
assert_out "fix/chore/perf only reports NONE" "NONE"
run_check "$R" --mode warn
assert_rc "fix/chore/perf only -> --mode warn exits 0" 0
assert_out "--mode warn emits a ::warning:: line" "::warning::"
run_check "$R"
assert_rc "fail is the default mode" 1

# --- 3. feat(scope): passes (AC2 names it explicitly) ------------------------
R="$(new_repo feat-scope)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "feat(games): configured list"
run_check "$R"
assert_rc "feat(scope): -> exit 0" 0

# --- 4. mixed span: four fixes and one feat ----------------------------------
R="$(new_repo mixed)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "fix: one"
commit "$R" "fix(events): two"
commit "$R" "feat(games): the only feature"
commit "$R" "fix: three"
commit "$R" "fix: four"
run_check "$R"
assert_rc "mixed span with one feat -> exit 0" 0
assert_out "mixed span names the feat subject" "feat(games): the only feature"

# --- 5. the real two-type squash subject from main (#1287) -------------------
R="$(new_repo two-type-subject)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "fix(events) + feat(lfg-board): ROK-1631 invite reuse (#1287)"
run_check "$R"
assert_rc "unanchored match: 'fix(events) + feat(lfg-board):' -> exit 0" 0

# --- 6. feat!: and a BREAKING CHANGE footer ----------------------------------
R="$(new_repo breaking)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "feat!: drop the v1 payload"
run_check "$R"
assert_rc "feat!: -> exit 0" 0

R="$(new_repo breaking-footer)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "fix: tighten the guard" "BREAKING CHANGE: removed the legacy field"
run_check "$R"
assert_rc "fix: with a BREAKING CHANGE footer -> exit 0" 0

R="$(new_repo breaking-hyphen)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "chore: sweep" "BREAKING-CHANGE: dropped an endpoint"
run_check "$R"
assert_rc "BREAKING-CHANGE (hyphen form) -> exit 0" 0

# --- 7. combined-merge body: chore: subject, feat(...) lines in the body -----
R="$(new_repo combined-merge)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" \
    "chore: combined merge — #1283 (ROK-1617 anti-vote) + #1285 (#1286)" \
    "- feat(lineups): anti-vote on the scheduling poll
- fix(events): stale signup counter"
run_check "$R"
assert_rc "combined-merge body listing feat(...) -> exit 0" 0

# --- 8. no false positives on 'feature' / 'featured' -------------------------
R="$(new_repo false-positives)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "feature: add a thing"
commit "$R" "chore: featured games page copy"
run_check "$R"
assert_rc "'feature:' / 'featured' are not features -> exit 1" 1

# --- 9. no previous v* tag (first-ever release) ------------------------------
R="$(new_repo first-tag)"
commit "$R" "chore: init"
commit "$R" "fix: only fixes here"
run_check "$R"
assert_rc "no previous v* tag -> exit 0" 0
assert_out "no previous v* tag prints the first-tag line" "first-tag"

# --- 10. a non-v tag must not be picked as the previous tag ------------------
# Without --match 'v*', describe resolves rok-backup and the span shrinks to the
# trailing `fix:` only, which would fail.
R="$(new_repo non-v-tag)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "feat(games): inside the real span"
tag "$R" rok1565-prerebase-backup
commit "$R" "fix: after the backup tag"
run_check "$R"
assert_rc "non-v tag is ignored when resolving the previous tag -> exit 0" 0
assert_out "non-v tag is ignored: prev-tag is v1.0.0" "prev-tag: v1.0.0"

# --- 11. explicit --ref (docker-publish post-hoc form) -----------------------
R="$(new_repo explicit-ref)"
commit "$R" "chore: init"
tag "$R" v1.0.0
commit "$R" "feat(web): shipped in v1.1.0"
tag "$R" v1.1.0
commit "$R" "fix: after the release"
run_check "$R" --ref v1.1.0
assert_rc "--ref v1.1.0 scans v1.0.0..v1.1.0 -> exit 0" 0
assert_out "--ref v1.1.0 resolves the previous tag" "prev-tag: v1.0.0"

# --- 12. usage errors never exit 0 or 1 --------------------------------------
R="$(new_repo usage)"
commit "$R" "chore: init"
run_check "$R" --nonsense
assert_rc "unknown flag -> exit 2" 2
run_check "$R" --mode sideways
assert_rc "invalid --mode value -> exit 2" 2
OUT="$(cd "$TMPROOT" && bash "$SCRIPT" 2>&1)"
RC=$?
assert_rc "outside a git repo -> exit 2" 2

echo "==="
echo "check-feat-since-tag: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
