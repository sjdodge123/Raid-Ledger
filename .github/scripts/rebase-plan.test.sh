#!/usr/bin/env bash
# Offline test for rebase-plan.jq (the rebase bot's plan,
# .github/workflows/dependabot-rebase-on-main.yml). jq only — no network.
# Run: bash .github/scripts/rebase-plan.test.sh
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FX="$DIR/fixtures/rebase-plan"
REQ='["integration-tests","smoke-tests","lint","unit-tests","discord-smoke","container-startup","tools-tests"]'
fails=0

plan() { # $1 = prs JSON, $2 = main check runs, $3 = main statuses
  jq -c --argjson req "$REQ" --argjson runs "$2" --argjson statuses "$3" \
    -f "$DIR/rebase-plan.jq" <<<"$1"
}
eq() { # $1 = label, $2 = expected, $3 = actual
  if [ "$2" == "$3" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "     expected: $2"; echo "     actual:   $3"; fails=$((fails + 1)); fi
}
has() { # $1 = label, $2 = needle, $3 = haystack (newline-separated)
  if grep -qxF -- "$2" <<<"$3"; then echo "ok   $1"
  else echo "FAIL $1"; echo "     missing: $2"; echo "     in:"; sed 's/^/       /' <<<"$3"; fails=$((fails + 1)); fi
}

prs=$(cat "$FX/prs.json"); runs=$(cat "$FX/main-check-runs.json"); sts=$(cat "$FX/main-statuses.json")
p=$(plan "$prs" "$runs" "$sts")
skipped=$(jq -r '.skipped[]' <<<"$p")

eq  "candidates are green or red-only-on-main-fixed, lowest number first" \
    "[3,5,9,12]" "$(jq -c '[.candidates[].number]' <<<"$p")"
eq  "red-on-main-fixed (check run) carries the distinct log reason" \
    "red only on lint, green on main" "$(jq -r '.candidates[] | select(.number == 3) | .why' <<<"$p")"
eq  "red-on-main-fixed (commit status) is a candidate too" \
    "red only on tools-tests, green on main" "$(jq -r '.candidates[] | select(.number == 12) | .why' <<<"$p")"
eq  "green PR has no reason (plain update-branch log line)" \
    "" "$(jq -r '.candidates[] | select(.number == 5) | .why' <<<"$p")"
eq  "superseded red attempt does not count (latest attempt wins)" \
    "" "$(jq -r '.candidates[] | select(.number == 9) | .why' <<<"$p")"
has "red also red on main is skipped" \
    "#4: required check failing: unit-tests=FAILURE (main: FAILURE)" "$skipped"
has "red also pending on main is skipped" \
    "#7: required check failing: smoke-tests=FAILURE (main: IN_PROGRESS)" "$skipped"
has "red on a context main never reported is skipped" \
    "#11: required check failing: discord-smoke=FAILURE (main: not reported)" "$skipped"
has "one fixed + one still-red-on-main context is skipped" \
    "#8: required check failing: lint=FAILURE (main: SUCCESS),unit-tests=FAILURE (main: FAILURE)" "$skipped"
has "draft is skipped even when its red is fixed on main" "#6: no auto-merge or draft" "$skipped"
has "no auto-merge is skipped" "#10: no auto-merge or draft" "$skipped"
eq  "nothing in flight" "[]" "$(jq -c '.inflight' <<<"$p")"

# Main's state unreadable (workflow falls back to empty arrays): red PRs skip as before.
p=$(plan "$prs" '[]' '[]')
eq  "main unknown -> only green PRs are candidates" "[5,9]" "$(jq -c '[.candidates[].number]' <<<"$p")"

# An up-to-date ready PR with a pending required check takes the slot.
inflight_pr='{"number": 2, "mergeStateStatus": "BLOCKED", "autoMergeRequest": {"mergeMethod": "SQUASH"}, "isDraft": false, "updatedAt": "2026-01-01T00:00:00Z",
  "statusCheckRollup": [{"name": "lint", "status": "IN_PROGRESS", "conclusion": "", "startedAt": "2026-01-01T00:00:00Z", "completedAt": null}]}'
p=$(plan "$(jq -c --argjson x "$inflight_pr" '. + [$x]' <<<"$prs")" "$runs" "$sts")
eq  "pending up-to-date PR is in flight" '["#2 (BLOCKED, pending: lint)"]' "$(jq -c '.inflight' <<<"$p")"

echo
if [ "$fails" -eq 0 ]; then echo "rebase-plan: all passed"; else echo "rebase-plan: $fails failed"; exit 1; fi
