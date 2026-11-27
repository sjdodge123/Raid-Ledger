# Rebase-bot plan (.github/workflows/dependabot-rebase-on-main.yml).
#
# Input (stdin): `gh pr list --json number,headRefOid,mergeStateStatus,
#                 autoMergeRequest,isDraft,updatedAt,statusCheckRollup`
# Args (`--slurpfile`, so each variable is a one-element array; an empty
# file reads as [] and means "unknown"):
#   $req       (--argjson) branch-protection required contexts, e.g. ["lint"]
#   $runs      main head's check runs (REST check_runs[], projected to
#              name/status/conclusion/started_at/completed_at)
#   $statuses  main head's commit statuses (REST combined /status .statuses)
#   $bases     {"<pr number>": {sha, runs, statuses}} — each listed PR's
#              merge-base commit with main, same projections as above. The
#              workflow fills it only for `need_base` (pass 2); {} on pass 1.
# Output: {inflight: [string], need_base: [number],
#          candidates: [{number, why}], skipped: [string]}
#
# A red required context counts as "fixed by main" only if it was ALSO failing
# at the PR's merge base (main was red there) and is SUCCESS on main's head
# now. Green on main alone is not enough: main is green almost always, so that
# would rebase a PR that is red through its own bug or a flake on every merge.
#
# Offline test: scripts/test/rebase-plan.test.sh. This file is fetched from
# the base ref by the workflow and only ever reads JSON — no PR code runs.

def terminal: IN("SUCCESS","FAILURE","ERROR","TIMED_OUT","ACTION_REQUIRED",
                 "STARTUP_FAILURE","CANCELLED","SKIPPED","NEUTRAL","STALE");
def failing: IN("FAILURE","ERROR","TIMED_OUT","ACTION_REQUIRED","STARTUP_FAILURE");

# Latest attempt per REQUIRED context from rollup-shaped entries. The rollup
# keeps superseded attempts; an old FAILURE of a re-run job or a CANCELLED
# superseded run must not count. `t` is a string concat, so a queued re-run
# with no startedAt sorts below the attempt it supersedes; harmless for the
# REST reads (check-runs defaults to filter=latest) and pre-existing for PRs.
def latest:
  [.[]?
   | {k: (.name // .context),
      t: ((.startedAt // "") + (.completedAt // "")),
      v: (if (.conclusion // "") != "" then .conclusion else (.state // .status // "") end)}
   | select(.k | IN($req[]))]
  | group_by(.k) | map(max_by(.t));

# REST (lower case, snake_case) -> the GraphQL rollup shape gh pr list returns.
def up: if . == null then null else ascii_upcase end;
def rollup($r; $s):
  [($r[]? | {name, status: (.status | up), conclusion: (.conclusion | up),
             startedAt: .started_at, completedAt: .completed_at}),
   ($s[]? | {context, state: (.state | up), startedAt: (.updated_at // .created_at)})];
def states: latest | map({key: .k, value: .v}) | from_entries;

(rollup($runs[0]; $statuses[0]) | states) as $main
| ($bases[0] // {}) as $bases
| map(
    (.statusCheckRollup | latest) as $l
    | ($bases[.number | tostring]) as $b
    | {number,
       mss: .mergeStateStatus,
       ready: (.autoMergeRequest != null and (.isDraft | not)),
       red: [$l[] | select(.v | failing)],
       pending: [$l[] | select(.v | terminal | not) | .k],
       reported: ($l | length),
       fresh: ((.updatedAt | fromdateiso8601) > (now - 600)),
       base: (if $b then {sha7: ($b.sha // "" | .[0:7]), s: (rollup($b.runs; $b.statuses) | states)}
              else null end)}
    # Every red context is green on main's head: worth a merge-base read.
    | .main_fixed = ((.red | length) > 0 and (.red | all(.[]; $main[.k] == "SUCCESS")))
    # ...and every one was failing at the merge base too: main fixed it.
    | .base as $bs
    | .fixed = (.main_fixed and $bs != null
                and (.red | all(.[]; ($bs.s[.k] // "") | failing))))
| sort_by(.number) as $all
| {inflight: [$all[]
     | select(.ready and (.mss | IN("BEHIND","DIRTY") | not) and (.red | length == 0)
              and ((.pending | length > 0) or (.reported == 0 and .fresh)))
     | "#\(.number) (\(.mss), pending: \(if .reported == 0 then "no required checks reported yet" else (.pending | join(",")) end))"],
   # Bounded: at most 10 PRs get the extra merge-base reads per run.
   need_base: ([$all[] | select(.mss == "BEHIND" and .ready and .main_fixed) | .number] | .[:10]),
   # Known-green PRs first, then speculative fix-rebases; each by number.
   candidates: ([$all[] | select(.mss == "BEHIND" and .ready and ((.red | length == 0) or .fixed))]
     | sort_by(.fixed, .number)
     | map({number, why: (if .fixed
         then "red on \(.red | map(.k) | join(",")): failing at merge-base \(.base.sha7), green on main"
         else "" end)})),
   skipped: [$all[]
     | select(.mss == "BEHIND" and ((.ready | not) or ((.red | length > 0) and (.fixed | not))))
     | . as $p
     | "#\(.number): \(if .ready | not then "no auto-merge or draft"
         else "required check failing: \(.red | map("\(.k)=\(.v) (main: \($main[.k] // "not reported")\(
           if $p.main_fixed | not then ""
           elif $p.base == null then ", merge-base not read"
           else ", merge-base \($p.base.sha7): \($p.base.s[.k] // "not reported")" end))") | join(","))" end)"]}
