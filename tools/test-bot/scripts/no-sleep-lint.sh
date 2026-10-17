#!/bin/bash
# Fail if sleep() or raw setTimeout() appears in smoke test files.
# Deterministic wait helpers should be used instead — see TESTING.md.
#
# Comments are STRIPPED before matching. Without that, the guard trips on any
# prose that merely names the thing it forbids — including its own explanatory
# comments. That exact defect has now landed three times (ROK-1314 twice, then
# ROK-1454's AC1 comment "no `sleep()` anywhere"), so the strip is the fix
# rather than rewording each comment that happens to say the word.
#
# Known limitation: a `//` inside a string literal (e.g. a URL) truncates the
# rest of that line, so a `sleep(` placed AFTER a URL on the SAME line would be
# missed. Accepted — `sleep(` before the `//` is still caught, and the
# alternative is a full TS parser in a shell guard.

set -euo pipefail

SMOKE_DIR="tools/test-bot/src/smoke/tests"

# Find from repo root (handle being called from any directory)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Blank out comment text while PRESERVING line numbering (one line out per
# line in), so grep -n still reports the real line.
strip_comments() {
  awk '
    {
      line = $0
      if (inblock) {
        idx = index(line, "*/")
        if (idx == 0) { print ""; next }
        line = substr(line, idx + 2); inblock = 0
      }
      while ((s = index(line, "/*")) > 0) {
        rest = substr(line, s + 2)
        e = index(rest, "*/")
        if (e == 0) { line = substr(line, 1, s - 1); inblock = 1; break }
        line = substr(line, 1, s - 1) substr(rest, e + 2)
      }
      c = index(line, "//")
      if (c > 0) line = substr(line, 1, c - 1)
      print line
    }
  ' "$1"
}

matches=""
while IFS= read -r file; do
  hits=$(strip_comments "$file" | grep -n 'sleep\s*(' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r hit; do
      matches="${matches}${file}:${hit}"$'\n'
    done <<< "$hits"
  fi
done < <(find "$REPO_ROOT/$SMOKE_DIR" -type f -name '*.ts' 2>/dev/null)

matches="$(printf '%s' "$matches" | sed '/^$/d')"

if [ -n "$matches" ]; then
  count=$(printf '%s\n' "$matches" | wc -l | tr -d ' ')
  echo "ERROR: $count sleep() call(s) found in smoke tests."
  echo "Use deterministic wait helpers instead (pollForCondition, waitForDM, awaitProcessing, etc.)"
  echo ""
  echo "$matches"
  exit 1
fi

echo "OK: No sleep() calls found in smoke tests."
