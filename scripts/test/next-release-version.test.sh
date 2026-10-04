#!/usr/bin/env bash
# Unit coverage for scripts/next-release-version.sh.
#
# Every case builds a THROWAWAY git repo under a mktemp -d dir and runs the real
# script inside it, so tag listing and version sorting are exercised for real
# and the checkout's own tags are never touched.
#
# bash 3.2 safe: no mapfile, no ${var,,}, no associative arrays.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/next-release-version.sh"

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

export GIT_AUTHOR_NAME="next-release-version Test"
export GIT_AUTHOR_EMAIL="test@example.invalid"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

# new_repo <name> -> prints the repo path (one initial commit on main)
new_repo() {
    local d="$TMPROOT/$1"
    mkdir -p "$d"
    git -c init.defaultBranch=main init -q "$d"
    commit "$d" "chore: init"
    printf '%s' "$d"
}

# commit <repo> <subject> — gpgsign forced off for hermeticity.
commit() { git -C "$1" -c commit.gpgsign=false commit -q --allow-empty -m "$2"; }

# tag <repo> <name> (lightweight); atag <repo> <name> (annotated)
tag()  { git -C "$1" -c tag.gpgsign=false tag "$2"; }
atag() { git -C "$1" -c tag.gpgsign=false tag -a "$2" -m "Release $2"; }

OUT=""
ERR=""
RC=0
# run_next <dir> [args...] -> sets OUT (stdout only), ERR (stderr) and RC
run_next() {
    local dir="$1"
    shift
    local errf="$TMPROOT/stderr"
    OUT="$(cd "$dir" && bash "$SCRIPT" "$@" 2>"$errf")"
    RC=$?
    ERR="$(cat "$errf")"
}

assert_rc() {
    local label="$1" expected="$2"
    if [[ "$RC" == "$expected" ]]; then
        ok "$label"
    else
        bad "$label (expected exit $expected, got $RC; stdout: '$OUT'; stderr: '$ERR')"
    fi
}

# assert_version <label> <expected> — exit 0 and stdout is EXACTLY the version.
assert_version() {
    local label="$1" expected="$2"
    if [[ "$RC" == 0 && "$OUT" == "$expected" ]]; then
        ok "$label"
    else
        bad "$label (expected exit 0 and stdout '$expected', got exit $RC and stdout '$OUT'; stderr: '$ERR')"
    fi
}

# assert_error <label> <expected-rc> — no stdout, a message on stderr.
assert_error() {
    local label="$1" expected="$2"
    if [[ "$RC" == "$expected" && -z "$OUT" && -n "$ERR" ]]; then
        ok "$label"
    else
        bad "$label (expected exit $expected, empty stdout, stderr message; got exit $RC, stdout '$OUT', stderr '$ERR')"
    fi
}

# --- 1. patch / minor / major from v1.1.0 (the repo's state today) -----------
R="$(new_repo basic)"
tag "$R" v1.0.0
commit "$R" "feat: a thing"
atag "$R" v1.1.0
commit "$R" "feat: another thing"
run_next "$R" patch
assert_version "v1.1.0 + patch -> 1.1.1" "1.1.1"
run_next "$R" minor
assert_version "v1.1.0 + minor -> 1.2.0" "1.2.0"
run_next "$R" major
assert_version "v1.1.0 + major -> 2.0.0" "2.0.0"

# A non-zero patch must reset on minor, and minor + patch must reset on major.
R="$(new_repo reset)"
atag "$R" v1.2.3
run_next "$R" patch
assert_version "v1.2.3 + patch -> 1.2.4" "1.2.4"
run_next "$R" minor
assert_version "v1.2.3 + minor resets patch -> 1.3.0" "1.3.0"
run_next "$R" major
assert_version "v1.2.3 + major resets minor and patch -> 2.0.0" "2.0.0"

# --- 2. stdout is exactly the version: one line, no leading v ----------------
R="$TMPROOT/basic"
run_next "$R" patch
if [[ "$OUT" == "1.1.1" && -z "$ERR" ]]; then
    ok "stdout is exactly '1.1.1' with nothing on stderr"
else
    bad "stdout is exactly the version (stdout '$OUT', stderr '$ERR')"
fi

# --- 3. mixed lightweight and annotated: the highest wins either way ---------
R="$(new_repo mixed-light-high)"
atag "$R" v1.1.0
commit "$R" "feat: x"
tag "$R" v1.2.0
run_next "$R" patch
assert_version "lightweight v1.2.0 beats annotated v1.1.0" "1.2.1"

R="$(new_repo mixed-annotated-high)"
tag "$R" v1.1.0
commit "$R" "feat: x"
atag "$R" v1.2.0
run_next "$R" patch
assert_version "annotated v1.2.0 beats lightweight v1.1.0" "1.2.1"

# --- 4. numeric sort: v1.10.0 beats v1.9.0 (a lexical sort picks v1.9.0) -----
R="$(new_repo numeric)"
tag "$R" v1.9.0
commit "$R" "feat: x"
tag "$R" v1.10.0
commit "$R" "feat: y"
tag "$R" v1.2.0
run_next "$R" patch
assert_version "v1.10.0 beats v1.9.0 and v1.2.0" "1.10.1"
run_next "$R" minor
assert_version "v1.10.0 + minor -> 1.11.0" "1.11.0"

# --- 5. a higher tag NOT reachable from HEAD still wins ----------------------
R="$(new_repo unreachable)"
atag "$R" v1.1.0
git -C "$R" checkout -q -b hotfix
commit "$R" "fix: on a side branch"
atag "$R" v1.5.0
git -C "$R" checkout -q main
commit "$R" "feat: main moves on"
run_next "$R" patch
assert_version "global highest v1.5.0 (off HEAD) wins over reachable v1.1.0" "1.5.1"

# --- 6. pre-release and non-semver tags are ignored --------------------------
R="$(new_repo ignored)"
atag "$R" v1.1.0
commit "$R" "feat: x"
tag "$R" v2.0.0-rc1
tag "$R" vfoo
tag "$R" v3.0
tag "$R" v4.0.0.1
tag "$R" release-9.0.0
run_next "$R" patch
assert_version "v2.0.0-rc1 / vfoo / v3.0 / v4.0.0.1 / release-9.0.0 ignored" "1.1.1"

# --- 7. no matching tag -> exit 2 --------------------------------------------
R="$(new_repo no-tags)"
run_next "$R" patch
assert_error "no tags at all -> exit 2" 2

R="$(new_repo only-prerelease)"
tag "$R" v1.0.0-rc1
tag "$R" vnext
run_next "$R" patch
assert_error "only pre-release / non-semver tags -> exit 2" 2

# --- 8. bad or missing argument -> exit 2 ------------------------------------
R="$(new_repo args)"
tag "$R" v1.1.0
run_next "$R"
assert_error "missing argument -> exit 2" 2
run_next "$R" bogus
assert_error "unknown bump 'bogus' -> exit 2" 2
run_next "$R" Patch
assert_error "case-sensitive: 'Patch' -> exit 2" 2
run_next "$R" patch minor
assert_error "two arguments -> exit 2" 2
run_next "$R" v1.2.0
assert_error "an explicit version is not a bump -> exit 2" 2

# --- 9. outside a git repo -> exit 2 -----------------------------------------
mkdir -p "$TMPROOT/not-a-repo"
GIT_CEILING_DIRECTORIES="$TMPROOT" run_next "$TMPROOT/not-a-repo" patch
assert_error "outside a git repo -> exit 2" 2

echo "==="
echo "next-release-version: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
