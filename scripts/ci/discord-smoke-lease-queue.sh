# shellcheck shell=bash
# Sourced by scripts/ci/discord-smoke-lease.sh (needs its api/now/field/
# holder_msg/post_commit/try_slot/stale_reason/rate_limited helpers and
# config). It makes lease acquisition oldest-first (FIFO) instead of "whoever
# polls first after a slot frees" (TDB 2026-11-25: an older run gave up after
# 100 min while newer runs kept winning freed slots).
#
# Ticket: on its first poll a waiter creates refs/locks/<name>/queue/<run_id>-
# <attempt>, pointing at a commit whose message carries run_id / run_attempt /
# run_url / queued_at. It is deleted on acquire, on give-up, and by the
# always() release step (which also runs when acquire failed or was cancelled).
#
# Order: by GitHub run_id (monotonic per repo; ascending = older run), then
# attempt. A re-run therefore keeps its ORIGINAL place — deliberate: it is the
# PR that has been waiting longest, and its earlier attempt's ticket is dropped.
#
# Admission: each poll reads every slot once. Only when one is free or stale
# does it list the queue and count LIVE tickets that sort before this run
# (`ahead`); the waiter tries for a slot only while ahead < free. A ticket
# whose run currently HOLDS a slot is not a waiter (its delete may have
# failed) and is not counted. Ordering is cooperative; the slot write itself
# stays the atomic POST/PATCH in try_slot, so FIFO can only cost fairness,
# never double ownership.
#
# A ticket is dead (skipped, and deleted best-effort) when its run is
# completed or gone, when its run has moved on to a later attempt (a re-run),
# when its queued_at is older than LEASE_TICKET_MAX_S (default MAX_WAIT_S + 2
# polls + 5 min: a live waiter gives up and dequeues by then) or in the
# future, or when it is malformed. A ticket whose commit cannot be read is
# still dead when its run is over, and when the commit is missing (404/422)
# and its run started more than LEASE_TICKET_MAX_S ago — so nothing, not even
# a hand-made ref, can wedge the queue.
#
# API budget (GITHUB_TOKEN: 1000 req/h/repo): a waiter costs POOL_SIZE slot
# reads per poll plus one run-status read per distinct holder every
# LEASE_RUN_CHECK_EVERY polls, as before the queue existed. A run's status is
# cached: completed/gone for good (that attempt never comes back), live until
# the next check poll, and fetched at most once per poll.
#
# Fail open: if the queue cannot be listed (HTTP error) the waiter logs a
# warning and competes as before (ahead=0) — fairness lost, never a wedge.
# A ticket that cannot be written yet is retried on the next poll.

QUEUE_PREFIX="${NS}/${NAME}/queue"
TICKET_REF="${QUEUE_PREFIX}/${RUN_ID}-${RUN_ATTEMPT}"
TICKET_MAX_S="${LEASE_TICKET_MAX_S:-$(( MAX_WAIT_S + 2 * POLL_S + 300 ))}"

# Digits only (TDB:3194: commit-message fields reach arithmetic) and short
# enough not to overflow it.
is_num() { case "$1" in ""|*[!0-9]*) return 1 ;; esac; [ "${#1}" -le 18 ]; }

# ensure_ticket — queue this run once; called on every poll until it lands.
ensure_ticket() {
  [ ! -f "$CACHE/ticket" ] || return 0
  local sha json code
  sha="$(post_commit "$(printf '%s queue\n\nrun_id=%s\nrun_attempt=%s\nrun_url=%s\nqueued_at=%s\n' \
    "$NAME" "$RUN_ID" "$RUN_ATTEMPT" "$RUN_URL" "$(now)")")" || { check_readonly; return 1; }
  json="$(jq -nc --arg r "refs/${TICKET_REF}" --arg s "$sha" '{ref: $r, sha: $s}')"
  code="$(api POST git/refs "$json")"
  case "$code" in
    201|422) : > "$CACHE/ticket"; echo "lease: queued as ${TICKET_REF}" ;;  # 422: already queued
    403) denied "$code"; return 1 ;;
    *) echo "::warning::lease: queue ticket create HTTP $code, will retry" >&2; return 1 ;;
  esac
}

# delete_ticket [TRIES] — remove THIS run's ticket (its name is unique to this attempt).
delete_ticket() {
  local code=000 i tries="${1:-3}"
  for i in $(seq 1 "$tries"); do
    code="$(api DELETE "git/refs/${TICKET_REF}")"
    case "$code" in 204|404|422) rm -f "$CACHE/ticket"; return 0 ;; esac
    [ "$i" -ge "$tries" ] || sleep "${LEASE_RETRY_S:-5}"
  done
  echo "::warning::lease: could not delete ${TICKET_REF} (HTTP $code); the release step retries, and waiters skip it while this run holds a slot or once it completes" >&2
  return 0
}

# run_end_cached CACHE_PREFIX ATTEMPT — the cached end reason, if it covers ATTEMPT.
run_end_cached() {
  [ -s "$1.end" ] || return 0
  local upto; upto="$(head -n 1 "$1.end")"
  if [ "$upto" = all ] || [ "$2" -le "$upto" ]; then sed -n 2p "$1.end"; fi
}

# run_record CACHE_PREFIX RUN_ID — store a 200 actions/runs/<id> body.
run_record() {
  local cur; cur="$(jq -r '.run_attempt // empty' "$BODY")"
  is_num "$cur" || cur=""
  echo "$cur" > "$1.att"
  jq -r '(.run_started_at // empty) | fromdateiso8601? // empty' "$BODY" > "$1.started" 2>/dev/null || :
  if [ "$(jq -r '.status' "$BODY")" = completed ]; then
    printf '%s\nrun %s is completed\n' "${cur:-all}" "$2" > "$1.end"
  else rm -f "$1.end"; fi
}

# run_end_reason RUN_ID CHECK [ATTEMPT] — prints why that attempt of the run
# is over, or nothing. Fetched only when CHECK=1, at most once per poll; a
# completed/gone answer is never fetched again.
run_end_reason() {
  local id="$1" att="${3:-0}" c="$CACHE/run-$1" code end last cur
  is_num "$att" || att=0
  end="$(run_end_cached "$c" "$att")"
  last="$(cat "$c.poll" 2>/dev/null || echo none)"
  if [ -z "$end" ] && [ "$2" = 1 ] && [ "$last" != "${POLL_NO:-0}" ]; then
    echo "${POLL_NO:-0}" > "$c.poll"
    code="$(api GET "actions/runs/${id}")"
    case "$code" in
      404) printf 'all\nrun %s no longer exists\n' "$id" > "$c.end" ;;
      200) run_record "$c" "$id" ;;
      *) echo "::warning::lease: run ${id} status unavailable ($(http_why "$code"))" >&2 ;;
    esac
    end="$(run_end_cached "$c" "$att")"
  fi
  if [ -n "$end" ]; then echo "$end"; return 0; fi
  cur="$(cat "$c.att" 2>/dev/null || true)"
  if [ "$att" -gt 0 ] && is_num "$cur" && [ "$att" -lt "$cur" ]; then
    echo "run ${id} is now on attempt ${cur}"
  fi
}

# unreadable_ticket_reason ID ATTEMPT SHA CHECK — the ticket commit could not be read.
unreadable_ticket_reason() {
  local end started
  end="$(run_end_reason "$1" "$4" "$2")"
  if [ -n "$end" ]; then echo "${end}; ticket commit unreadable"; return 0; fi
  case "$(cat "$CACHE/msgerr-$3" 2>/dev/null)" in 404|422) ;; *) return 0 ;; esac  # transient: live
  started="$(cat "$CACHE/run-$1.started" 2>/dev/null || true)"
  if is_num "$started" && [ $(( $(now) - started )) -gt "$TICKET_MAX_S" ]; then
    echo "ticket commit missing and run $1 started $(mins $(( $(now) - started ))) ago"
  fi
}

# ticket_dead_reason ID ATTEMPT SHA CHECK — prints why the ticket is dead, or nothing.
ticket_dead_reason() {
  local id="$1" att="$2" msg qat chk="$4"
  # The queue is only listed while a slot is free, so a ticket's run may never
  # have been checked: check it on first sight rather than wait for a check poll.
  [ -f "$CACHE/run-$id.poll" ] || chk=1
  if [ "$id" = "$RUN_ID" ] && [ "$(( 10#$att ))" -lt "$RUN_ATTEMPT" ]; then
    echo "earlier attempt of this run"; return 0
  fi
  if ! msg="$(holder_msg "$3")"; then unreadable_ticket_reason "$id" "$att" "$3" "$chk"; return 0; fi
  qat="$(field queued_at <<< "$msg")"
  is_num "$qat" || { echo "queued_at is malformed"; return 0; }
  if [ $(( 10#$qat - $(now) )) -gt "$TICKET_MAX_S" ]; then echo "queued_at is in the future"; return 0; fi
  if [ $(( $(now) - 10#$qat )) -gt "$TICKET_MAX_S" ]; then echo "queued $(mins $(( $(now) - 10#$qat ))) ago"; return 0; fi
  run_end_reason "$id" "$chk" "$att"
}

# queue_ahead CHECK — prints how many live tickets sort before this run.
queue_ahead() {
  local code ref sha tname id att reason ahead=0
  code="$(api GET "git/matching-refs/${QUEUE_PREFIX}")"
  if [ "$code" != 200 ]; then
    echo "::warning::lease: cannot list the queue ($(http_why "$code")); competing unordered this poll" >&2
    echo 0; return 0
  fi
  jq -r '.[] | "\(.ref) \(.object.sha)"' "$BODY" > "$CACHE/queue" 2>/dev/null || :
  while read -r ref sha; do
    tname="${ref#refs/"${QUEUE_PREFIX}"/}"   # a queue-x/… ref keeps its refs/ prefix: skipped below
    [ "$tname" != "${RUN_ID}-${RUN_ATTEMPT}" ] || continue
    id="${tname%-*}"; att="${tname##*-}"
    { is_num "$id" && is_num "$att"; } || continue
    case "$sha" in ""|*[!0-9a-f]*) continue ;; esac
    # Only tickets that sort before this run matter (and cost API calls); a
    # later run's dead ticket is dropped by the waiters behind it. An earlier
    # attempt of this run is checked too, so a re-run clears its old ticket.
    [ "$(( 10#$id ))" -le "$(( 10#$RUN_ID ))" ] || continue
    grep -qxF "$tname" "$CACHE/holders" 2>/dev/null && continue   # holds a slot: not waiting
    reason="$(ticket_dead_reason "$id" "$att" "$sha" "$1")"
    if [ -n "$reason" ]; then
      echo "lease: dropping queue ticket ${tname} (${reason})" >&2
      api DELETE "git/refs/${QUEUE_PREFIX}/${tname}" > /dev/null
      continue
    fi
    [ "$id" = "$RUN_ID" ] || ahead=$(( ahead + 1 ))   # same run, later attempt: not ahead
  done < "$CACHE/queue"
  echo "$ahead"
}

# scan_slots CHECK — reads every slot once; prints how many are free or stale.
# Leaves "<http code> <sha>" in $CACHE/slot-<idx> for try_slot, and each
# holder's "<run_id>-<attempt>" in $CACHE/holders for queue_ahead.
scan_slots() {
  local idx code sha msg n=0
  : > "$CACHE/holders"
  for idx in $(seq 0 $(( POOL_SIZE - 1 ))); do
    code="$(api GET "git/ref/${NS}/${NAME}/${idx}")"; sha=""
    [ "$code" != 200 ] || sha="$(jq -r '.object.sha' "$BODY")"
    echo "$code $sha" > "$CACHE/slot-$idx"
    case "$code" in
      404) n=$(( n + 1 )) ;;
      200) echo "$sha" > "$CACHE/holder-$idx"
           if msg="$(holder_msg "$sha")"; then
             printf '%s-%s\n' "$(field run_id <<< "$msg")" "$(field run_attempt <<< "$msg")" >> "$CACHE/holders"
           fi
           [ -z "$(stale_reason "$sha" "$1")" ] || n=$(( n + 1 )) ;;
    esac
  done
  echo "$n"
}

# poll_once CHECK — one FIFO-ordered attempt; 0 when this run now holds a slot.
poll_once() {
  local free ahead idx code sha
  POLL_NO=$(( ${POLL_NO:-0} + 1 ))
  ensure_ticket || true
  free="$(scan_slots "$1")"
  if [ "$free" -eq 0 ]; then echo "no slot free" > "$CACHE/status"; return 1; fi
  ahead="$(queue_ahead "$1")"
  echo "${free} slot(s) free, ${ahead} live waiter(s) queued ahead" > "$CACHE/status"
  [ "$ahead" -lt "$free" ] || return 1
  for idx in $(seq 0 $(( POOL_SIZE - 1 ))); do
    read -r code sha < "$CACHE/slot-$idx" || continue
    case "$code" in 200|404) ;; *) continue ;; esac
    # One delete try here; the always() release step retries.
    if try_slot "$idx" "$1" "$code" "$sha"; then delete_ticket 1; return 0; fi
  done
  return 1
}
