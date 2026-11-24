#!/usr/bin/env bash
# pr-watch.sh — wait on one or more PRs and exit ONCE with a report (ROK-2309).
#
# The Lead runs this with run_in_background instead of spending a watcher lane
# (or its own turns) on polling. It only REPORTS: it never reruns CI, updates a
# branch, enables auto-merge or merges anything.
#
# Usage: scripts/pr-watch.sh [--minutes N=60] [--interval S=60] [--stuck-minutes M=20] <pr>...
#
# First output line is the exit reason:
#   ALL MERGED                          exit 0
#   FAILED #n: <check names>            exit 1
#   CLOSED #n                           exit 1  (closed without merging)
#   STUCK #n: BEHIND|DIRTY for >M min   exit 1
#   ERROR #n: <gh error>                exit 1  (3 consecutive failed reads)
#   TIMEOUT                             exit 2
# then one line per PR: `#n STATE MERGE_STATE auto=true|false failing=<names|->`
# and a UTC timestamp. Usage errors exit 64.
#
# Env: GH_BIN (default gh), PR_WATCH_INTERVAL (seconds, overrides --interval),
# PR_WATCH_STUCK_SECONDS (overrides --stuck-minutes; used by the spec).
set -uo pipefail

usage() {
  echo "usage: $0 [--minutes N=60] [--interval S=60] [--stuck-minutes M=20] <pr>..." >&2
  exit 64
}
is_uint() { case "${1:-}" in '' | *[!0-9]*) return 1 ;; *) return 0 ;; esac; }

minutes=60
interval=60
stuck_minutes=20
prs=()
while [ $# -gt 0 ]; do
  case "$1" in
    --minutes | --interval | --stuck-minutes)
      [ $# -ge 2 ] && is_uint "$2" || usage
      case "$1" in
        --minutes) minutes=$2 ;;
        --interval) interval=$2 ;;
        --stuck-minutes) stuck_minutes=$2 ;;
      esac
      shift 2
      ;;
    -h | --help) usage ;;
    -*) usage ;;
    *)
      is_uint "$1" || usage
      prs+=("$1")
      shift
      ;;
  esac
done
[ ${#prs[@]} -gt 0 ] || usage

if [ -n "${PR_WATCH_INTERVAL:-}" ]; then is_uint "$PR_WATCH_INTERVAL" || usage; interval=$PR_WATCH_INTERVAL; fi
stuck_secs=$((stuck_minutes * 60))
if [ -n "${PR_WATCH_STUCK_SECONDS:-}" ]; then is_uint "$PR_WATCH_STUCK_SECONDS" || usage; stuck_secs=$PR_WATCH_STUCK_SECONDS; fi
GH="${GH_BIN:-gh}"
end=$(($(date +%s) + minutes * 60))

# Per-PR state, index-aligned with prs[] (bash 3.2 has no associative arrays).
lines=()      # last status line
errs=()       # consecutive failed reads
stuck_since=() # epoch when BEHIND/DIRTY (with no checks running) was first seen, or ''
for i in "${!prs[@]}"; do
  lines[$i]="#${prs[$i]} UNKNOWN UNKNOWN auto=false failing=-"
  errs[$i]=0
  stuck_since[$i]=''
done

# One jq pass per PR → unit-separator (\x1f) joined, since tab IFS collapses empty fields: state, mergeState, auto, failing, running.
# Failing = a check run concluded FAILURE / TIMED_OUT / ACTION_REQUIRED /
# STARTUP_FAILURE, or a commit status is FAILURE / ERROR. Any OTHER non-empty
# conclusion outside the known non-failures counts as failed too, named with its
# conclusion ("name (X)"), so a new GitHub state cannot leave us waiting out the
# timeout. CANCELLED is deliberately NOT a failure (nor SKIPPED / NEUTRAL /
# SUCCESS): GitHub cancels a superseded run every time a branch is pushed or
# rebased, so treating it as red would fire on routine churn; the replacement run reports.
JQ_FILTER='
  (.statusCheckRollup // []) as $c |
  [ .state, (.mergeStateStatus // "UNKNOWN"), (.autoMergeRequest != null | tostring),
    ([ $c[] | (.conclusion // "") as $k | (.name // .context // "?") as $n |
         if ($k | test("^(FAILURE|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE)$"))
            or ((.state // "") | test("^(FAILURE|ERROR)$")) then $n
         elif $k != "" and ($k | test("^(CANCELLED|SKIPPED|NEUTRAL|SUCCESS)$") | not) then "\($n) (\($k))"
         else empty end ] | unique | join(", ")),
    ([ $c[] | select((.__typename == "CheckRun" and (.status // "COMPLETED") != "COMPLETED")
                     or ((.state // "") | test("^(PENDING|EXPECTED)$"))) ] | length | tostring)
  ] | join("\u001f")'

report() {
  echo "$1"
  for l in "${lines[@]}"; do echo "$l"; done
  date -u '+%Y-%m-%dT%H:%M:%SZ'
  exit "$2"
}

while :; do
  all_merged=1
  now=$(date +%s)
  for i in "${!prs[@]}"; do
    n=${prs[$i]}
    if ! json=$("$GH" pr view "$n" --json number,state,mergeStateStatus,autoMergeRequest,statusCheckRollup 2>&1) ||
      ! row=$(printf '%s' "$json" | jq -r "$JQ_FILTER" 2>&1); then
      # Transient gh/network error: retry next cycle; three in a row is fatal.
      errs[$i]=$((errs[$i] + 1))
      all_merged=0
      if [ "${errs[$i]}" -ge 3 ]; then
        report "ERROR #$n: $(printf '%s' "$json" | head -n 1)" 1
      fi
      continue
    fi
    errs[$i]=0
    IFS=$'\x1f' read -r state mstate auto failing running <<<"$row"
    lines[$i]="#$n $state $mstate auto=$auto failing=${failing:--}"

    case "$state" in
      MERGED) continue ;;
      CLOSED) all_merged=0; report "CLOSED #$n" 1 ;;
    esac
    all_merged=0
    [ -n "$failing" ] && report "FAILED #$n: $failing" 1

    # BEHIND or DIRTY with nothing running: start (or keep) the stuck clock.
    # DIRTY never resolves by itself, so it gets the same threshold.
    if { [ "$mstate" = BEHIND ] || [ "$mstate" = DIRTY ]; } && [ "${running:-0}" = 0 ]; then
      [ -z "${stuck_since[$i]}" ] && stuck_since[$i]=$now
      if [ $((now - stuck_since[$i])) -ge "$stuck_secs" ]; then
        report "STUCK #$n: $mstate for >$stuck_minutes min" 1
      fi
    else
      stuck_since[$i]=''
    fi
  done
  [ "$all_merged" = 1 ] && report "ALL MERGED" 0
  [ "$(date +%s)" -ge "$end" ] && report "TIMEOUT" 2
  sleep "$interval"
done
