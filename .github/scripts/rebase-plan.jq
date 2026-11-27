# Rebase-bot plan (.github/workflows/dependabot-rebase-on-main.yml).
#
# Input (stdin): `gh pr list --json number,mergeStateStatus,autoMergeRequest,
#                 isDraft,updatedAt,statusCheckRollup`
# Args:
#   $req       branch-protection required contexts, e.g. ["lint","unit-tests"]
#   $runs      main head's check runs (REST check_runs[], projected to
#              name/status/conclusion/started_at/completed_at)
#   $statuses  main head's commit statuses (REST combined /status .statuses)
# Output: {inflight: [string], candidates: [{number, why}], skipped: [string]}
#
# Offline test: .github/scripts/rebase-plan.test.sh. This file is fetched from
# the base ref by the workflow and only ever reads JSON — no PR code runs.

def terminal: IN("SUCCESS","FAILURE","ERROR","TIMED_OUT","ACTION_REQUIRED",
                 "STARTUP_FAILURE","CANCELLED","SKIPPED","NEUTRAL","STALE");
def failing: IN("FAILURE","ERROR","TIMED_OUT","ACTION_REQUIRED","STARTUP_FAILURE");

# Latest attempt per REQUIRED context from rollup-shaped entries. The rollup
# keeps superseded attempts; an old FAILURE of a re-run job or a CANCELLED
# superseded run must not count.
def latest:
  [.[]?
   | {k: (.name // .context),
      t: ((.startedAt // "") + (.completedAt // "")),
      v: (if (.conclusion // "") != "" then .conclusion else (.state // .status // "") end)}
   | select(.k | IN($req[]))]
  | group_by(.k) | map(max_by(.t));

# REST (lower case, snake_case) -> the GraphQL rollup shape gh pr list returns.
def up: if . == null then null else ascii_upcase end;
def main_rollup:
  [($runs[]? | {name, status: (.status | up), conclusion: (.conclusion | up),
                startedAt: .started_at, completedAt: .completed_at}),
   ($statuses[]? | {context, state: (.state | up), startedAt: (.updated_at // .created_at)})];

(main_rollup | latest | map({key: .k, value: .v}) | from_entries) as $main
| map(
    (.statusCheckRollup | latest) as $l
    | {number,
       mss: .mergeStateStatus,
       ready: (.autoMergeRequest != null and (.isDraft | not)),
       red: [$l[] | select(.v | failing)],
       pending: [$l[] | select(.v | terminal | not) | .k],
       reported: ($l | length),
       fresh: ((.updatedAt | fromdateiso8601) > (now - 600))}
    # Red only on contexts that main has since fixed: rebasing picks the fix up.
    | .fixed = ((.red | length) > 0 and (.red | all(.[]; $main[.k] == "SUCCESS"))))
| sort_by(.number) as $all
| {inflight: [$all[]
     | select(.ready and (.mss | IN("BEHIND","DIRTY") | not) and (.red | length == 0)
              and ((.pending | length > 0) or (.reported == 0 and .fresh)))
     | "#\(.number) (\(.mss), pending: \(if .reported == 0 then "no required checks reported yet" else (.pending | join(",")) end))"],
   candidates: [$all[]
     | select(.mss == "BEHIND" and .ready and ((.red | length == 0) or .fixed))
     | {number, why: (if .fixed then "red only on \(.red | map(.k) | join(",")), green on main" else "" end)}],
   skipped: [$all[]
     | select(.mss == "BEHIND" and ((.ready | not) or ((.red | length > 0) and (.fixed | not))))
     | "#\(.number): \(if .ready | not then "no auto-merge or draft"
         else "required check failing: \(.red | map("\(.k)=\(.v) (main: \($main[.k] // "not reported"))") | join(","))" end)"]}
