# shellcheck shell=bash
# Sourced by scripts/ci/discord-smoke-lease.sh (needs its api/now/field/
# holder_msg/post_commit/try_slot/stale_reason helpers and config). It makes
# lease acquisition oldest-first (FIFO) instead of "whoever polls first after
# a slot frees" (TDB 2026-11-25: an older run gave up after 100 min while
# newer runs kept winning freed slots).
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
# Admission: each poll lists the queue and counts LIVE tickets that sort
# before this run (`ahead`). The waiter tries for a slot only while
# ahead < (free + stale slots), so a pool of 2 still admits the two oldest.
# Ordering is cooperative; the slot write itself stays the atomic POST/PATCH
# in try_slot, so FIFO can only ever cost fairness, never double ownership.
#
# A ticket is dead (skipped, and deleted best-effort) when its run is
# completed or gone (checked every LEASE_RUN_CHECK_EVERY polls, cached in
# between), when it is an earlier attempt of THIS run, when its queued_at is
# older than LEASE_STALE_S or in the future, or when it is malformed. So a
# crashed waiter cannot wedge the queue: its run completes and it drops out.
#
# Fail open: if the queue cannot be listed (HTTP error) the waiter logs a
# warning and competes as before (ahead=0) — fairness lost, never a wedge.
# A ticket that cannot be written yet is retried on the next poll.

QUEUE_PREFIX="${NS}/${NAME}/queue"
TICKET_REF="${QUEUE_PREFIX}/${RUN_ID}-${RUN_ATTEMPT}"

is_num() { case "$1" in ""|*[!0-9]*) return 1 ;; esac; }

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
    403) fatal_readonly "$code" ;;
    *) echo "::warning::lease: queue ticket create HTTP $code, will retry" >&2; return 1 ;;
  esac
}

# delete_ticket — remove THIS run's ticket (its name is unique to this attempt).
delete_ticket() {
  local code=000
  for _ in 1 2 3; do
    code="$(api DELETE "git/refs/${TICKET_REF}")"
    case "$code" in 204|404|422) rm -f "$CACHE/ticket"; return 0 ;; esac
    sleep "${LEASE_RETRY_S:-5}"
  done
  echo "::warning::lease: could not delete ${TICKET_REF} (HTTP $code); waiters drop it once this run completes" >&2
  return 0
}

# run_end_reason RUN_ID CHECK — prints why the run is over, or nothing.
# Cached per run; refreshed only when CHECK=1.
run_end_reason() {
  local id="$1" cfile="$CACHE/run-$1" code
  if [ "$2" = 1 ]; then
    code="$(api GET "actions/runs/${id}")"
    case "$code" in
      404) echo "run ${id} no longer exists" > "$cfile" ;;
      200) if [ "$(jq -r '.status' "$BODY")" = completed ]; then
             echo "run ${id} is completed" > "$cfile"; else : > "$cfile"; fi ;;
      *) echo "::warning::lease: run ${id} status unavailable (HTTP $code)" >&2 ;;
    esac
  fi
  cat "$cfile" 2>/dev/null || true
}

# ticket_dead_reason ID ATTEMPT SHA CHECK — prints why the ticket is dead, or nothing.
ticket_dead_reason() {
  local id="$1" att="$2" msg qat
  if [ "$id" = "$RUN_ID" ] && [ "$(( 10#$att ))" -lt "$RUN_ATTEMPT" ]; then
    echo "earlier attempt of this run"; return 0
  fi
  msg="$(holder_msg "$3")" || return 0   # unreadable right now: live
  qat="$(field queued_at <<< "$msg")"
  is_num "$qat" || { echo "queued_at is malformed"; return 0; }
  if [ $(( 10#$qat - $(now) )) -gt "$STALE_S" ]; then echo "queued_at is in the future"; return 0; fi
  if [ $(( $(now) - 10#$qat )) -gt "$STALE_S" ]; then echo "queued $(mins $(( $(now) - 10#$qat ))) ago"; return 0; fi
  run_end_reason "$id" "$4"
}

# queue_ahead CHECK — prints how many live tickets sort before this run.
queue_ahead() {
  local code ref sha tname id att reason ahead=0
  code="$(api GET "git/matching-refs/${QUEUE_PREFIX}")"
  if [ "$code" != 200 ]; then
    echo "::warning::lease: cannot list the queue (HTTP $code); competing unordered this poll" >&2
    echo 0; return 0
  fi
  jq -r '.[] | "\(.ref) \(.object.sha)"' "$BODY" > "$CACHE/queue"
  while read -r ref sha; do
    tname="${ref#refs/"${QUEUE_PREFIX}"/}"
    [ "$tname" != "${RUN_ID}-${RUN_ATTEMPT}" ] || continue
    id="${tname%-*}"; att="${tname##*-}"
    { is_num "$id" && is_num "$att"; } || continue   # TDB:3194: digits only into arithmetic
    case "$sha" in ""|*[!0-9a-f]*) continue ;; esac
    # Only tickets that sort before this run matter (and cost API calls); a
    # later run's dead ticket is dropped by the waiters behind it. An earlier
    # attempt of this run is checked too, so a re-run clears its old ticket.
    [ "$(( 10#$id ))" -le "$(( 10#$RUN_ID ))" ] || continue
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

# free_slots CHECK — prints how many slots are free or stale right now.
free_slots() {
  local idx code n=0
  for idx in $(seq 0 $(( POOL_SIZE - 1 ))); do
    code="$(api GET "git/ref/${NS}/${NAME}/${idx}")"
    case "$code" in
      404) n=$(( n + 1 )) ;;
      200) jq -r '.object.sha' "$BODY" > "$CACHE/holder-$idx"
           [ -z "$(stale_reason "$(cat "$CACHE/holder-$idx")" "$1")" ] || n=$(( n + 1 )) ;;
    esac
  done
  echo "$n"
}

# poll_once CHECK — one FIFO-ordered attempt; 0 when this run now holds a slot.
poll_once() {
  local ahead idx
  ensure_ticket || true
  ahead="$(queue_ahead "$1")"; echo "$ahead" > "$CACHE/ahead"
  [ "$ahead" -lt "$POOL_SIZE" ] || return 1
  if [ "$ahead" -gt 0 ] && [ "$(free_slots "$1")" -le "$ahead" ]; then return 1; fi
  for idx in $(seq 0 $(( POOL_SIZE - 1 ))); do
    if try_slot "$idx" "$1"; then delete_ticket; return 0; fi
  done
  return 1
}
