#!/usr/bin/env bash
# The stat-probe portability guard for rl-infra/runner/ensure-runner-dirs.sh.
#
# WHY THIS EXISTS
# ---------------
# `owner_of` used to try BSD `stat -f '%Su:%Sg'` first and fall through with
# `||`. On Linux — the only place this script actually runs — `-f` means
# "filesystem status", so stat printed the Blocks/Inodes block to STDOUT, failed
# on the format operand, and the `||` then appended the GNU result. The captured
# value was therefore never equal to `rl-agent:rl-fleet`, and EVERY deploy
# reported FATAL with ten paragraphs of filesystem trivia even when ownership
# was already correct. As root the resulting no-op chown "fixed" it, so the exit
# code looked sane and the noise was written off as cosmetic for two days.
#
# The bug is not the probe order — it is that a FAILED probe could still
# contribute stdout. These cases pin the observable property: one line out, and
# it equals what the caller compares against.
set -uo pipefail
TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$(cd "$TEST_DIR/../.." && pwd)/runner/ensure-runner-dirs.sh"
PASS=0; FAIL=0

check() { # name, actual, expected
    if [[ "$2" == "$3" ]]; then PASS=$((PASS+1));
    else FAIL=$((FAIL+1)); echo "FAIL [ensure-runner-dirs-stat::$1] got [$2] want [$3]" >&2; fi
}

# Source only the helpers: the script exits on args, so pull the two functions out.
eval "$(sed -n '/^mode_of() {/,/^}/p;/^owner_of() {/,/^}/p' "$SCRIPT")"

d=$(mktemp -d)

# 1 — owner_of returns exactly one line. This is the whole bug: the broken
#     version returned six, five of them filesystem trivia.
lines=$(owner_of "$d" | wc -l | tr -d ' ')
check "owner_of returns a single line" "$lines" "1"

# 2 — and that line is owner:group, matching what ensure_dir compares against.
check "owner_of matches the live owner" "$(owner_of "$d")" "$(id -un):$(id -gn)"

# 3 — no filesystem-status leakage, on either platform.
case "$(owner_of "$d")" in
    *Inodes*|*"Block size"*|*Namelen*) check "owner_of carries no fs block" "leaked" "clean" ;;
    *) check "owner_of carries no fs block" "clean" "clean" ;;
esac

# 4 — mode_of is four octal digits (it survived the original bug only by
#     slicing the last four chars; pin the contract explicitly now).
m=$(mode_of "$d")
case "$m" in [0-7][0-7][0-7][0-7]) check "mode_of is 4 octal digits" "ok" "ok" ;;
             *) check "mode_of is 4 octal digits" "$m" "4 octal digits" ;; esac

# 5 — both fail cleanly (no stdout) on a path that does not exist.
missing="$d/nope"
check "owner_of is silent when the path is missing" "$(owner_of "$missing" 2>/dev/null)" ""
check "mode_of is silent when the path is missing"  "$(mode_of  "$missing" 2>/dev/null)" ""

rmdir "$d"
echo "--- ensure-runner-dirs-stat.test.sh: $PASS pass, $FAIL fail ---"
[[ "$FAIL" -eq 0 ]]
