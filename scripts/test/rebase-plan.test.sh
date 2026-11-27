#!/usr/bin/env bash
# Offline test for .github/scripts/rebase-plan.jq (the rebase bot's plan,
# .github/workflows/dependabot-rebase-on-main.yml). jq only — no network.
# Run: bash scripts/test/rebase-plan.test.sh (also run by scripts/test/run-all.sh)
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JQ="$DIR/../../.github/scripts/rebase-plan.jq"
FX="$DIR/fixtures/rebase-plan"
REQ='["integration-tests","smoke-tests","lint","unit-tests","discord-smoke","container-startup","tools-tests"]'
fails=0

plan() { # $1 = prs JSON, $2 = main check runs, $3 = main statuses, $4 = merge bases ({} on pass 1)
  jq -c --argjson req "$REQ" --slurpfile runs <(printf '%s' "$2") \
    --slurpfile statuses <(printf '%s' "$3") --slurpfile bases <(printf '%s' "${4:-}") \
    -f "$JQ" <<<"$1"
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
bases=$(cat "$FX/merge-bases.json")

# Pass 1 (no merge-base data yet): which PRs need the extra reads.
p=$(plan "$prs" "$runs" "$sts" '{}')
eq  "need_base = ready BEHIND PRs whose every red context is green on main" \
    "[2,3,12,13,17]" "$(jq -c '.need_base' <<<"$p")"
eq  "pass 1 (no merge bases) -> only green PRs are candidates" "[5,9]" "$(jq -c '[.candidates[].number]' <<<"$p")"

# Pass 2.
p=$(plan "$prs" "$runs" "$sts" "$bases")
skipped=$(jq -r '.skipped[]' <<<"$p")
eq  "green PRs first, then main-fixed reds, each by number" \
    "[5,9,3,12,17]" "$(jq -c '[.candidates[].number]' <<<"$p")"
eq  "main-fixed (check run) names both sides" \
    "red on lint: failing at merge-base aaaaaaa, green on main" "$(jq -r '.candidates[] | select(.number == 3) | .why' <<<"$p")"
eq  "main-fixed (commit status) is a candidate too" \
    "red on tools-tests: failing at merge-base bbbbbbb, green on main" "$(jq -r '.candidates[] | select(.number == 12) | .why' <<<"$p")"
eq  "main-fixed PR with another required check still pending is a candidate" \
    "red on lint: failing at merge-base 1111111, green on main" "$(jq -r '.candidates[] | select(.number == 17) | .why' <<<"$p")"
eq  "green PR has no reason (plain update-branch log line)" \
    "" "$(jq -r '.candidates[] | select(.number == 5) | .why' <<<"$p")"
eq  "superseded red attempt does not count (latest attempt wins)" \
    "" "$(jq -r '.candidates[] | select(.number == 9) | .why' <<<"$p")"
has "red, green on main but GREEN at merge base (the PR's own failure) is skipped" \
    "#2: required check failing: lint=FAILURE (main: SUCCESS, merge-base ccccccc: SUCCESS)" "$skipped"
has "merge-base read failed (no entry) is skipped" \
    "#13: required check failing: lint=FAILURE (main: SUCCESS, merge-base not read)" "$skipped"
has "main SKIPPED is not green" \
    "#15: required check failing: container-startup=FAILURE (main: SKIPPED)" "$skipped"
has "main NEUTRAL is not green" \
    "#16: required check failing: integration-tests=FAILURE (main: NEUTRAL)" "$skipped"
eq  "main-fixed PR that is DIRTY is neither a candidate nor a skip line" \
    "00" "$(jq '[.candidates[] | select(.number == 14)] | length' <<<"$p")$(grep -c '^#14:' <<<"$skipped")"
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

# Main's state unreadable (workflow passes empty files): red PRs skip as before.
p=$(plan "$prs" '' '' '')
eq  "main unknown -> only green PRs are candidates" "[5,9]" "$(jq -c '[.candidates[].number]' <<<"$p")"
eq  "main unknown -> no merge-base reads" "[]" "$(jq -c '.need_base' <<<"$p")"

# need_base is capped at the first 10 PRs by number.
many=$(jq -c '[range(30; 42) as $n | .[] | select(.number == 3) | .number = $n]' <<<"$prs")
eq  "need_base capped at 10, lowest numbers" "[30,31,32,33,34,35,36,37,38,39]" \
    "$(plan "$many" "$runs" "$sts" '{}' | jq -c '.need_base')"

# An up-to-date ready PR with a pending required check takes the slot.
inflight_pr='{"number": 20, "mergeStateStatus": "BLOCKED", "autoMergeRequest": {"mergeMethod": "SQUASH"}, "isDraft": false, "updatedAt": "2026-01-01T00:00:00Z",
  "statusCheckRollup": [{"name": "lint", "status": "IN_PROGRESS", "conclusion": "", "startedAt": "2026-01-01T00:00:00Z", "completedAt": null}]}'
p=$(plan "$(jq -c --argjson x "$inflight_pr" '. + [$x]' <<<"$prs")" "$runs" "$sts" "$bases")
eq  "pending up-to-date PR is in flight" '["#20 (BLOCKED, pending: lint)"]' "$(jq -c '.inflight' <<<"$p")"

# Just rebased: nothing reported yet but updated within 10 min -> in flight.
fresh_pr=$(jq -cn '{number: 21, mergeStateStatus: "BLOCKED", autoMergeRequest: {mergeMethod: "SQUASH"},
  isDraft: false, updatedAt: (now - 60 | todate), statusCheckRollup: []}')
p=$(plan "$(jq -c --argjson x "$fresh_pr" '. + [$x]' <<<"$prs")" "$runs" "$sts" "$bases")
eq  "fresh PR with no checks reported yet is in flight" \
    '["#21 (BLOCKED, pending: no required checks reported yet)"]' "$(jq -c '.inflight' <<<"$p")"

echo
if [ "$fails" -eq 0 ]; then echo "rebase-plan: all passed"; else echo "rebase-plan: $fails failed"; exit 1; fi
