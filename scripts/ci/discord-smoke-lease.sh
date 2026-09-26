#!/usr/bin/env bash
# ROK-1522 Phase 1 — exclusive lease on the shared Discord test guild, held as a
# git ref (refs/locks/<name>/<index>) through the GitHub REST API.
#
# Why not `concurrency:`: GitHub's queue for a concurrency group holds ONE
# pending run and a newer arrival cancels it, so the required `discord-smoke`
# context vanished from 35 PR runs in two weeks (docs/spikes/rok-1522-discord-smoke-parallelism.md §1.1). A run
# waiting on this lease shows "in progress" instead, and is never evicted.
#
#   acquire  Take slot 0..LEASE_POOL_SIZE-1 (Phase 1: pool of 1 = exclusive).
#            Writes `ref`, `sha`, `index`, `acquired_at` to $GITHUB_OUTPUT.
#   release  Delete the ref named by $LEASE_REF, ONLY if it still points at
#            $LEASE_SHA (i.e. this run still owns it). Never fails the job.
#
# Ownership: each acquisition creates a fresh commit object whose message
# carries run_id / run_attempt / run_url / acquired_at, and points the ref at
# it. The commit sha is therefore unique per acquisition and IS the owner token.
#
# Atomicity:
#   - free slot   POST git/refs — 422 when the ref already exists (someone won).
#   - stale slot  PATCH git/refs force:false with a commit whose PARENT is the
#                 stale holder's commit. That is a fast-forward only while the
#                 ref still points at that holder, so two waiters taking over
#                 the same stale lease cannot both succeed (the loser gets 422).
# A lease is stale when its holder's workflow run is `completed` or gone, when
# it is an earlier attempt of THIS run (a re-run), or when it is older than
# LEASE_STALE_S (default 155 min) — so a crashed run cannot wedge the queue.
# The run-status check is what catches a crashed holder; the age limit is only
# a backstop, and it MUST exceed the job's `timeout-minutes` (150 in
# .github/workflows/discord-smoke.yml) so a slow-but-alive holder, whose bot is
# still connected, is never taken over.
#
# Needs job permissions `contents: write` (refs + commit objects) and
# `actions: read` (holder run status). A read-only token (Dependabot, forks)
# gets 403 on the commit create and this script FAILS the job rather than let
# it drive the guild unleased.
set -euo pipefail

API="${GITHUB_API_URL:-https://api.github.com}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
NS="${LEASE_REF_NAMESPACE:-locks}"
NAME="${LEASE_NAME:-discord-smoke}"
POOL_SIZE="${LEASE_POOL_SIZE:-1}"
POLL_S="${LEASE_POLL_S:-30}"
STALE_S="${LEASE_STALE_S:-9300}"  # > timeout-minutes 150 (9000s); see header
MAX_WAIT_S="${LEASE_MAX_WAIT_S:-6000}"
RUN_CHECK_EVERY="${LEASE_RUN_CHECK_EVERY:-4}"
RUN_ID="${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}"
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${REPO}/actions/runs/${RUN_ID}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
BODY="$(mktemp)"
CACHE="$(mktemp -d)"
trap 'rm -rf "$BODY" "$CACHE"' EXIT

[ -n "$TOKEN" ] || { echo "::error::lease: GH_TOKEN/GITHUB_TOKEN is not set"; exit 1; }

# api METHOD PATH [JSON] — prints the HTTP status (000 on a transport error);
# the response body lands in $BODY. The token never reaches stdout.
api() {
  local method="$1" path="$2" data="${3:-}" code
  local args=(-sS -o "$BODY" -w '%{http_code}' -X "$method"
    -H "Authorization: Bearer ${TOKEN}"
    -H 'Accept: application/vnd.github+json'
    -H 'X-GitHub-Api-Version: 2022-11-28')
  if [ -n "$data" ]; then args+=(-H 'Content-Type: application/json' --data "$data"); fi
  : > "$BODY"
  code="$(curl "${args[@]}" "${API}/repos/${REPO}/${path}" 2>/dev/null)" || true
  echo "${code:-000}"
}

now() { date +%s; }
mins() { echo "$(( $1 / 60 ))m$(( $1 % 60 ))s"; }
field() { sed -n "s/^$1=//p" | head -n 1; }  # read `key=value` from a commit message

fatal_readonly() {
  echo "::error::lease: GITHUB_TOKEN cannot write git objects (HTTP $1): this run has a read-only token (Dependabot/fork?). Refusing to drive the shared Discord guild without the lease."
  exit 1
}

check_readonly() { [ ! -f "$CACHE/readonly" ] || fatal_readonly "$(cat "$CACHE/readonly")"; }

# Tree for the lease commit: any tree in the repo will do; use this run's commit.
lease_tree() {
  if [ ! -s "$CACHE/tree" ]; then
    local code; code="$(api GET "git/commits/${GITHUB_SHA:?}")"
    [ "$code" = 200 ] || { echo "::warning::lease: cannot read commit ${GITHUB_SHA} (HTTP $code)" >&2; return 1; }
    jq -r '.tree.sha' "$BODY" > "$CACHE/tree"
  fi
  cat "$CACHE/tree"
}

# make_commit INDEX [PARENT_SHA] — prints the new owner-token commit sha.
# Runs inside $(...), so a read-only token is flagged via $CACHE/readonly
# and turned into a job failure by the caller (an exit here would only
# leave the subshell).
make_commit() {
  local idx="$1" parent="${2:-}" msg json code tree
  tree="$(lease_tree)" || return 1
  msg="$(printf '%s lease %s\n\nrun_id=%s\nrun_attempt=%s\nrun_url=%s\nacquired_at=%s\n' \
    "$NAME" "$idx" "$RUN_ID" "$RUN_ATTEMPT" "$RUN_URL" "$(now)")"
  json="$(jq -nc --arg m "$msg" --arg t "$tree" --arg p "$parent" \
    '{message: $m, tree: $t, parents: (if $p == "" then [] else [$p] end)}')"
  code="$(api POST git/commits "$json")"
  case "$code" in
    201) jq -r '.sha' "$BODY" ;;
    403) echo "$code" > "$CACHE/readonly"; return 1 ;;
    *) echo "::warning::lease: commit create failed (HTTP $code), will retry" >&2; return 1 ;;
  esac
}

# holder_msg SHA — the holder commit's message (cached per sha).
holder_msg() {
  if [ ! -f "$CACHE/msg-$1" ]; then
    [ "$(api GET "git/commits/$1")" = 200 ] || return 1
    jq -r '.message' "$BODY" > "$CACHE/msg-$1"
  fi
  cat "$CACHE/msg-$1"
}

# stale_reason SHA CHECK_RUN — prints why the lease is stale, or nothing.
stale_reason() {
  local sha="$1" check_run="$2" msg hid hatt hat code status
  msg="$(holder_msg "$sha")" || return 0   # unreadable right now: not stale
  hid="$(field run_id <<< "$msg")"; hatt="$(field run_attempt <<< "$msg")"
  hat="$(field acquired_at <<< "$msg")"
  if [ -n "$hat" ] && [ $(( $(now) - hat )) -gt "$STALE_S" ]; then
    echo "held for $(mins $(( $(now) - hat ))) (> $(mins "$STALE_S"))"; return 0
  fi
  if [ "$hid" = "$RUN_ID" ] && [ "$hatt" != "$RUN_ATTEMPT" ]; then
    echo "left by attempt ${hatt} of this same run"; return 0
  fi
  [ "$check_run" = 1 ] && [ -n "$hid" ] || return 0
  code="$(api GET "actions/runs/${hid}")"
  case "$code" in
    404) echo "holder run ${hid} no longer exists" ;;
    200) status="$(jq -r '.status' "$BODY")"
         [ "$status" = completed ] && echo "holder run ${hid} is completed" ;;
    *) echo "::warning::lease: holder run status unavailable (HTTP $code)" >&2 ;;
  esac
  return 0
}

own() {  # own REF SHA INDEX
  {
    echo "ref=$1"; echo "sha=$2"; echo "index=$3"; echo "acquired_at=$(now)"
  } >> "$OUT"
}

# try_slot INDEX CHECK_RUN — 0 when this run now holds the slot.
try_slot() {
  local idx="$1" check_run="$2" ref="${NS}/${NAME}/$1" code holder reason sha json
  code="$(api GET "git/ref/${ref}")"
  if [ "$code" = 404 ]; then
    sha="$(make_commit "$idx")" || { check_readonly; return 1; }
    json="$(jq -nc --arg r "refs/${ref}" --arg s "$sha" '{ref: $r, sha: $s}')"
    code="$(api POST git/refs "$json")"
    case "$code" in
      201) own "$ref" "$sha" "$idx"; return 0 ;;
      422) return 1 ;;                       # another run created it first
      403) fatal_readonly "$code" ;;
      *) echo "::warning::lease: ref create HTTP $code" >&2; return 1 ;;
    esac
  fi
  if [ "$code" != 200 ]; then echo "::warning::lease: ref read HTTP $code" >&2; return 1; fi
  holder="$(jq -r '.object.sha' "$BODY")"
  echo "$holder" > "$CACHE/holder-$idx"
  reason="$(stale_reason "$holder" "$check_run")"
  [ -n "$reason" ] || return 1
  echo "::warning::lease: taking over stale ${ref} ($reason; holder $(holder_msg "$holder" | field run_url))"
  sha="$(make_commit "$idx" "$holder")" || { check_readonly; return 1; }
  json="$(jq -nc --arg s "$sha" '{sha: $s, force: false}')"
  code="$(api PATCH "git/refs/${ref}" "$json")"
  case "$code" in
    200) own "$ref" "$sha" "$idx"; return 0 ;;
    403) fatal_readonly "$code" ;;
    *) return 1 ;;                           # 422: someone else moved/deleted it
  esac
}

acquire() {
  local start polls=0 check idx waited holder
  start="$(now)"
  echo "lease: acquiring ${NS}/${NAME}/[0..$(( POOL_SIZE - 1 ))] for ${RUN_URL} (attempt ${RUN_ATTEMPT})"
  while :; do
    check=0; [ $(( polls % RUN_CHECK_EVERY )) -eq 0 ] && check=1
    for idx in $(seq 0 $(( POOL_SIZE - 1 ))); do
      if try_slot "$idx" "$check"; then
        echo "lease: acquired ${NS}/${NAME}/${idx} after waiting $(mins $(( $(now) - start )))"
        return 0
      fi
    done
    polls=$(( polls + 1 )); waited=$(( $(now) - start ))
    if [ "$waited" -ge "$MAX_WAIT_S" ]; then
      echo "::error::lease: gave up after waiting $(mins "$waited") for ${NS}/${NAME}"; exit 1
    fi
    holder="$(cat "$CACHE/holder-0" 2>/dev/null || true)"
    echo "lease: waited $(mins "$waited"); slot 0 held by $( [ -n "$holder" ] && holder_msg "$holder" | field run_url)"
    sleep "$POLL_S"
  done
}

release() {
  local ref="${LEASE_REF:-}" sha="${LEASE_SHA:-}" code holder
  if [ -z "$ref" ] || [ -z "$sha" ]; then echo "lease: nothing to release"; return 0; fi
  for _ in 1 2 3; do
    code="$(api GET "git/ref/${ref}")"
    case "$code" in
      404) echo "::warning::lease: ${ref} already gone before release"; return 0 ;;
      200) ;;
      *) sleep 5; continue ;;
    esac
    holder="$(jq -r '.object.sha' "$BODY")"
    if [ "$holder" != "$sha" ]; then
      echo "::warning::lease: ${ref} is now held by ${holder}, not this run (${sha}) — taken over as stale? Not releasing."
      return 0
    fi
    code="$(api DELETE "git/refs/${ref}")"
    if [ "$code" = 204 ]; then
      echo "lease: released ${ref}${LEASE_ACQUIRED_AT:+ after holding it $(mins $(( $(now) - LEASE_ACQUIRED_AT )))}"
      return 0
    fi
    sleep 5
  done
  echo "::warning::lease: could not release ${ref} (last HTTP $code); waiters take it over once this run completes"
  return 0
}

case "${1:-}" in
  acquire) acquire ;;
  release) release ;;
  *) echo "usage: $0 acquire|release" >&2; exit 2 ;;
esac
