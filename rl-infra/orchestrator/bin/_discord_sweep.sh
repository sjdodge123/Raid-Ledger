#!/usr/bin/env bash
# ROK-1508 — sweep the shared Discord test guild's leaked ⏰ voice channels.
#
# ROK-1494 now-sessions create `⏰ <game> — Playing now` voice channels (Discord
# type 2) in the shared test guild via the env's per-slot app bot. Nothing
# deleted them when the env was destroyed: eight accumulated on 2026-09-06/07
# and broke every Discord smoke run. The companion test bot lacks Manage
# Channels (50013), so the slot app bot — which created them — is the actor.
#
# CONCURRENCY DECISION (recorded, not accidental): a sibling env on ANOTHER
# slot may have a LIVE playing channel in the same guild; this sweep deletes it
# too. Its reaper tolerates a missing channel (Unknown Channel 10003 is treated
# as already-gone on the api side), and this is a test guild, so that is
# accepted. No member-count checks — that is gateway-only data the REST channel
# list does not carry. Deliberately NOT holder-matched (unlike
# bot_identity::deregister_commands): the whole point is to reap channels
# leaked by envs that are already gone, whoever created them.
#
# SECRET HANDLING: the token is read via bot_identity::value inside a `set +x`
# window and handed only to bot_identity::_discord_call, which feeds it to
# `curl --config -` on stdin (Authorization: Bot header). Never argv, never
# echoed, never in audit lines.
#
# BEST-EFFORT BY CONSTRUCTION: callers run under `set -euo pipefail`, so every
# path here returns 0 — a Discord outage or a 500 must never fail the destroy.
# Skips silently when the slot has no token/client id, when
# RL_DISCORD_TEST_GUILD_ID is unset (see SETUP.md, slot-bot section), or when
# curl is missing. Note `deleted` counts DELETEs attempted, not confirmed —
# _discord_call ignores HTTP status.
#
# ROK-1611 — WHY THE SKIPS ARE NOW LOUD. Every guard below used to be a bare
# `return 0`. `RL_DISCORD_TEST_GUILD_ID` was never actually set in
# /srv/rl-infra/.env, so this helper AND the gc-sweeper's copy (ROK-1515) were
# a no-op from the day they shipped: 148 ⏰ channels accumulated in the dev
# guild and `audit.log` held zero `discord-ephemeral-swept` lines to say why.
# A guard that declines silently is indistinguishable from a guard that ran and
# found nothing — so each one now names itself on stderr AND audits
# `discord-ephemeral-skipped`. Keep it that way.
#
# Seams: RL_DISCORD_API_BASE (stub endpoint), RL_DISCORD_SWEEP_DISABLED=1
# (skip), RL_DISCORD_TEST_GUILD_ID (the guild to sweep).
#
# Sourced by: env-destroy and discord-sweep. Requires _bot_identity.sh first
# (env-destroy also sources _state.sh; discord-sweep does not need it).

# stdin: a guild channel-list JSON body. stdout: one channel id per line for
# every VOICE (type 2) channel whose name starts with ⏰. A non-array body
# (e.g. Discord's `{"message":…,"code":…}` error object) yields nothing.
#
# Arg 1 (optional, ROK-1611): an epoch-ms cutoff — emit only channels created
# STRICTLY BEFORE it, read from the snowflake (id >> 22 + Discord epoch). The
# teardown path passes nothing (the env is gone; everything it made is dead),
# but the backlog sweeper runs against a LIVE guild where a sibling slot may be
# mid-session, and REST cannot report voice occupancy — `GET /guilds/{id}/channels`
# carries no member list and there is no list-all voice-states endpoint. Age is
# the usable proxy: the idle reaper kills a real channel within minutes, so
# anything hours old is orphaned by definition. jq's doubles lose the low bits
# of a snowflake (>2^53), but the error is ~256/4194304 ms — far under 1ms.
discord_sweep::_ephemeral_voice_ids() {
    local cutoff="${1:-}"
    jq -r --arg cutoff "$cutoff" '
        def created_ms: (.id | tonumber) / 4194304 | floor | . + 1420070400000;
        if type == "array"
        then .[]
             | select(.type == 2 and ((.name // "") | startswith("⏰")))
             | select($cutoff == "" or (created_ms < ($cutoff | tonumber)))
             | .id
        else empty end' 2>/dev/null || true
}

# Why a sweep would do nothing, or "" when it can run. Pure: env + the slot's
# configured-ness only, no network. MUST be called inside a `set +x` window —
# bot_identity::configured expands the token into a traced command.
discord_sweep::_skip_reason() {
    local slot="$1"
    if [[ ! "$slot" =~ ^[0-9]+$ ]]; then echo "no slot recorded"; return 0; fi
    if [[ "${RL_DISCORD_SWEEP_DISABLED:-0}" == "1" ]]; then
        echo "RL_DISCORD_SWEEP_DISABLED=1"; return 0
    fi
    if [[ -z "${RL_DISCORD_TEST_GUILD_ID:-}" ]]; then
        echo "RL_DISCORD_TEST_GUILD_ID unset in /srv/rl-infra/.env"; return 0
    fi
    if ! command -v curl >/dev/null 2>&1; then echo "curl not on PATH"; return 0; fi
    if ! bot_identity::configured "$slot"; then
        echo "slot ${slot} has no bot identity (RL_SLOT_${slot}_DISCORD_BOT_TOKEN/_CLIENT_ID)"
        return 0
    fi
    echo ""
}

# stdin: channel ids, one per line. DELETEs each and prints how many it sent.
# `while read` rather than mapfile — the tests run on macOS bash 3.2.
#
# `|| [[ -n "$cid" ]]` is load-bearing (ROK-1611): callers now pipe from a
# command substitution, which strips the trailing newline, and a bare `read`
# reports failure on that last unterminated line and drops it. Sweeping all but
# the final channel is exactly the kind of quiet shortfall this story is about.
discord_sweep::_delete_channels() {
    local api="$1" token="$2" cid n=0
    while IFS= read -r cid || [[ -n "$cid" ]]; do
        if [[ -z "$cid" ]]; then continue; fi
        bot_identity::_discord_call DELETE "${api}/channels/${cid}" "$token" >/dev/null
        n=$((n + 1))
    done
    printf '%s' "$n"
}

# Body of the sweep — runs ONLY inside the caller's `set +x` window because
# bot_identity::configured / ::value both expand the token into a traced
# command. Args: <slot> <slug> <guild>. Always returns 0.
# Args: <slot> <slug> <guild> [cutoff_ms]. Always returns 0.
discord_sweep::_run() {
    local slot="$1" slug="$2" guild="$3" cutoff="${4:-}" api token channels ids matched deleted
    token=$(bot_identity::value "$slot" BOT_TOKEN)
    api="${RL_DISCORD_API_BASE:-https://discord.com/api/v10}"
    channels=$(bot_identity::_discord_call GET "${api}/guilds/${guild}/channels" "$token")
    ids=$(printf '%s' "$channels" | discord_sweep::_ephemeral_voice_ids "$cutoff")
    matched=$(printf '%s' "$ids" | grep -c . || true)
    deleted=$(printf '%s' "$ids" | discord_sweep::_delete_channels "$api" "$token")
    unset token
    if declare -F audit::log >/dev/null 2>&1; then
        audit::log env-destroy discord-ephemeral-swept "$(jq -nc \
            --argjson slot "$slot" --arg slug "$slug" --arg guild "$guild" \
            --argjson matched "${matched:-0}" --argjson deleted "${deleted:-0}" \
            '{slot:$slot, slug:$slug, guild:$guild, matched:$matched, deleted:$deleted}')" \
            2>/dev/null || true
    fi
    echo "discord sweep: deleted ${deleted:-0} ⏰ voice channel(s)" >&2
    return 0
}

# Records a declined sweep so `audit.log` can answer "why did nothing happen?".
discord_sweep::_audit_skip() {
    declare -F audit::log >/dev/null 2>&1 || return 0
    audit::log env-destroy discord-ephemeral-skipped "$(jq -nc \
        --arg slot "$1" --arg slug "$2" --arg reason "$3" \
        '{slot:$slot, slug:$slug, reason:$reason}')" 2>/dev/null || true
}

# discord_sweep_ephemeral_voice <slot> [slug] [cutoff_ms] — the entry point
# env-destroy calls. Always returns 0; a skip is announced, never silent.
discord_sweep_ephemeral_voice() {
    local slot="$1" slug="${2:-}" cutoff="${3:-}" reason had_x=0
    # No xtrace from here until the token is out of every shell variable.
    [[ $- == *x* ]] && had_x=1
    set +x
    reason=$(discord_sweep::_skip_reason "$slot")
    if [[ -n "$reason" ]]; then
        discord_sweep::_audit_skip "$slot" "$slug" "$reason"
        echo "discord sweep: SKIPPED — ${reason}" >&2
    else
        discord_sweep::_run "$slot" "$slug" "${RL_DISCORD_TEST_GUILD_ID}" "$cutoff" || true
    fi
    if (( had_x )); then set -x; fi
    return 0
}
