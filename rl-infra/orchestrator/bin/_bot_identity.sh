#!/usr/bin/env bash
# ROK-1469 — per-slot Discord bot identity helpers.
#
# Every runner slot owns ITS OWN Discord application (4 apps registered in the
# portal, bots authorized into the test guild). The operator writes the three
# values per slot into /srv/rl-infra/.env, which _state.sh sources:
#
#   RL_SLOT_<N>_DISCORD_BOT_TOKEN       secret — never printed/logged
#   RL_SLOT_<N>_DISCORD_CLIENT_SECRET   secret — never printed/logged
#   RL_SLOT_<N>_DISCORD_CLIENT_ID       PUBLIC (application id)
#   RL_SLOT_<N>_DISCORD_APP_NAME        PUBLIC, optional (portal app name)
#
# Rules for every caller:
#   - `bot_identity::public_json` is the ONLY shape allowed in tool output,
#     audit lines or agent transcripts. It carries the client id + app name.
#   - `bot_identity::payload` returns the SECRETS. It goes to exactly one
#     place: the overlay's stdin pipe into the env container. Never echo it,
#     never pass it as argv, never write it to the audit log.
#
# Sourced by: env-settings-overlay, env-spin, env-destroy, env-inspect, status.

# Read RL_SLOT_<slot>_DISCORD_<suffix> without eval (bash 3.2 indirect ref).
bot_identity::value() {
    local slot="$1" suffix="$2" name
    name="RL_SLOT_${slot}_DISCORD_${suffix}"
    printf '%s' "${!name:-}"
}

# True when the slot has BOTH a bot token and a client id — the minimum for a
# usable, distinguishable identity. A half-configured slot is treated as
# unconfigured so the env falls back to whatever sync_settings provided rather
# than booting a bot with a token but no OAuth pairing.
bot_identity::configured() {
    local slot="$1"
    [[ -n "$(bot_identity::value "$slot" BOT_TOKEN)" ]] || return 1
    [[ -n "$(bot_identity::value "$slot" CLIENT_ID)" ]] || return 1
    return 0
}

# PUBLIC identity JSON for a slot — safe for tool output and audit lines.
# Shape: {slot, client_id, app_name, configured}. Fields are null when unset.
bot_identity::public_json() {
    local slot="$1" client_id app_name configured="false"
    client_id=$(bot_identity::value "$slot" CLIENT_ID)
    app_name=$(bot_identity::value "$slot" APP_NAME)
    if bot_identity::configured "$slot"; then configured="true"; fi
    jq -nc --argjson slot "${slot:-null}" \
        --arg client_id "$client_id" --arg app_name "$app_name" \
        --argjson configured "$configured" \
        '{slot: $slot,
          client_id: (if $client_id == "" then null else $client_id end),
          app_name: (if $app_name == "" then null else $app_name end),
          configured: $configured}'
}

# SECRET payload for a slot, shaped as an app_settings overlay map consumed by
# api/scripts/apply-settings-overlay.ts. Emits `{}` when the slot has no
# identity. CALLERS: pipe this into the container's stdin and nothing else.
bot_identity::payload() {
    local slot="$1" token client_id client_secret
    if ! bot_identity::configured "$slot"; then printf '{}'; return 0; fi
    token=$(bot_identity::value "$slot" BOT_TOKEN)
    client_id=$(bot_identity::value "$slot" CLIENT_ID)
    client_secret=$(bot_identity::value "$slot" CLIENT_SECRET)
    jq -nc --arg token "$token" --arg client_id "$client_id" \
        --arg client_secret "$client_secret" \
        '{discord_bot_token: $token,
          discord_bot_enabled: "true",
          discord_client_id: $client_id}
         + (if $client_secret == "" then {} else {discord_client_secret: $client_secret} end)'
}

# Resolve the slot that owns an env slug: the env registry is authoritative
# (labels drift on older envs); falls back to the container's rl.slot label.
# Prints nothing when the slug is unknown.
bot_identity::slot_for_slug() {
    local slug="$1" slot
    slot=$(state::query "$RL_ENVS_FILE" --arg slug "$slug" \
        '[.[] | select(.slug == $slug) | .slot] | first // empty' 2>/dev/null || true)
    if [[ -z "$slot" || ! "$slot" =~ ^[0-9]+$ ]]; then
        slot=$(docker inspect "rl-env-${slug}-allinone" \
            --format '{{ index .Config.Labels "rl.slot" }}' 2>/dev/null || echo "")
    fi
    [[ "$slot" =~ ^[0-9]+$ ]] && printf '%s' "$slot"
}
