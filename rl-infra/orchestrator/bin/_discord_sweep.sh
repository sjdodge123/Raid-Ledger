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
# Seams: RL_DISCORD_API_BASE (stub endpoint), RL_DISCORD_SWEEP_DISABLED=1
# (skip), RL_DISCORD_TEST_GUILD_ID (the guild to sweep).
#
# Sourced by: env-destroy. Requires _state.sh and _bot_identity.sh first.

# stdin: a guild channel-list JSON body. stdout: one channel id per line for
# every VOICE (type 2) channel whose name starts with ⏰. A non-array body
# (e.g. Discord's `{"message":…,"code":…}` error object) yields nothing.
discord_sweep::_ephemeral_voice_ids() {
    jq -r 'if type == "array"
           then .[] | select(.type == 2 and ((.name // "") | startswith("⏰"))) | .id
           else empty end' 2>/dev/null || true
}

# stdin: channel ids, one per line. DELETEs each and prints how many it sent.
# `while read` rather than mapfile — the tests run on macOS bash 3.2.
discord_sweep::_delete_channels() {
    local api="$1" token="$2" cid n=0
    while IFS= read -r cid; do
        if [[ -z "$cid" ]]; then continue; fi
        bot_identity::_discord_call DELETE "${api}/channels/${cid}" "$token" >/dev/null
        n=$((n + 1))
    done
    printf '%s' "$n"
}

# discord_sweep_ephemeral_voice <slot> [slug]
discord_sweep_ephemeral_voice() {
    local slot="$1" slug="${2:-}" guild api token channels matched deleted had_x=0
    if [[ ! "$slot" =~ ^[0-9]+$ ]]; then return 0; fi
    if [[ "${RL_DISCORD_SWEEP_DISABLED:-0}" == "1" ]]; then return 0; fi
    guild="${RL_DISCORD_TEST_GUILD_ID:-}"
    if [[ -z "$guild" ]]; then return 0; fi
    bot_identity::configured "$slot" || return 0
    command -v curl >/dev/null 2>&1 || return 0

    # No xtrace while the token is in a shell variable.
    [[ $- == *x* ]] && had_x=1
    set +x
    token=$(bot_identity::value "$slot" BOT_TOKEN)
    api="${RL_DISCORD_API_BASE:-https://discord.com/api/v10}"
    channels=$(bot_identity::_discord_call GET "${api}/guilds/${guild}/channels" "$token")
    matched=$(printf '%s' "$channels" | discord_sweep::_ephemeral_voice_ids | grep -c . || true)
    deleted=$(printf '%s' "$channels" | discord_sweep::_ephemeral_voice_ids \
        | discord_sweep::_delete_channels "$api" "$token")
    unset token
    if (( had_x )); then set -x; fi

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
