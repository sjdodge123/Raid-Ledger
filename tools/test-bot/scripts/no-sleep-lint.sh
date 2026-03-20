#!/bin/bash
# Fail if sleep() or raw setTimeout() appears in smoke test files.
# Deterministic wait helpers should be used instead — see TESTING.md.

set -euo pipefail

SMOKE_DIR="tools/test-bot/src/smoke/tests"

# Find from repo root (handle being called from any directory)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

matches=$(grep -rn 'sleep\s*(' "$REPO_ROOT/$SMOKE_DIR" 2>/dev/null || true)

if [ -n "$matches" ]; then
  count=$(echo "$matches" | wc -l | tr -d ' ')
  echo "ERROR: $count sleep() call(s) found in smoke tests."
  echo "Use deterministic wait helpers instead (pollForCondition, waitForDM, awaitProcessing, etc.)"
  echo ""
  echo "$matches"
  exit 1
fi

echo "OK: No sleep() calls found in smoke tests."
