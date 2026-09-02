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

# --- One-live-bot-per-slot (D3) ---------------------------------------------
#
# Two envs on the same slot would log in with the SAME bot token; Discord
# closes the older gateway session and the two containers flap the connection
# between them, so embeds land in whichever env happens to hold the socket.
# The slot's identity is therefore a lease: exactly one env slug holds it, the
# claim is a tiny JSON file, and env-destroy releases it. A claim whose env
# container no longer exists is stale and freely reclaimable — env-spin can
# abort after claiming, and a stranded file must never wedge the slot.

bot_identity::state_dir() {
    printf '%s/bot-identity' "${RL_STATE_DIR:-/srv/rl-infra/state}"
}

bot_identity::state_file() {
    printf '%s/slot-%s.json' "$(bot_identity::state_dir)" "$1"
}

# Print the slug currently holding the slot identity (empty when unheld).
bot_identity::holder() {
    local f
    f=$(bot_identity::state_file "$1")
    [[ -f "$f" ]] || return 0
    jq -r '.slug // empty' "$f" 2>/dev/null || true
}

# Record <slug> as the holder of <slot>. Atomic (mktemp + mv) so a concurrent
# reader never sees a half-written file.
bot_identity::claim() {
    local slot="$1" slug="$2" dir tmp
    dir=$(bot_identity::state_dir)
    mkdir -p "$dir" 2>/dev/null || return 0
    chmod 2775 "$dir" 2>/dev/null || true
    tmp=$(mktemp "${dir}/.slot-${slot}.XXXXXX" 2>/dev/null) || return 0
    jq -nc --arg slug "$slug" --arg ts "$(date -u +%FT%TZ)" \
        '{slug: $slug, claimed_at: $ts}' > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
    mv -f "$tmp" "$(bot_identity::state_file "$slot")" 2>/dev/null || rm -f "$tmp"
    return 0
}

# Release <slot> ONLY when <slug> is the recorded holder. Destroying a sibling
# env on the same slot must never free someone else's identity.
bot_identity::release() {
    local slot="$1" slug="$2" holder
    [[ "$slot" =~ ^[0-9]+$ ]] || return 0
    holder=$(bot_identity::holder "$slot")
    [[ "$holder" == "$slug" ]] || return 0
    rm -f "$(bot_identity::state_file "$slot")" 2>/dev/null || true
    return 0
}

# True when <slot>'s identity is held by a DIFFERENT slug whose allinone
# container still exists. A claim pointing at a vanished container is stale.
bot_identity::in_use_by_other() {
    local slot="$1" slug="$2" holder
    holder=$(bot_identity::holder "$slot")
    [[ -n "$holder" && "$holder" != "$slug" ]] || return 1
    docker inspect "rl-env-${holder}-allinone" >/dev/null 2>&1 || return 1
    printf '%s' "$holder"
    return 0
}
