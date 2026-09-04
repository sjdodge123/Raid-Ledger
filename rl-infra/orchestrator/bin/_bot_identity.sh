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

# Atomic compare-and-claim (Codex #4). `set -o noclobber` makes the redirect
# an O_EXCL create, so two concurrent env-spins on one slot cannot both
# observe "free" and both claim: the loser's redirect fails.
#
#   exit 0            → <slug> now holds the slot identity (or already did)
#   exit 1 + stdout   → another LIVE env holds it; stdout is that env's slug
#
# A claim whose allinone container is gone is stale (env-spin can abort after
# claiming) and is stolen exactly once — never a wedged slot.
bot_identity::acquire() {
    local slot="$1" slug="$2" dir file holder tmp attempt
    dir=$(bot_identity::state_dir)
    mkdir -p "$dir" 2>/dev/null || return 0
    chmod 2775 "$dir" 2>/dev/null || true
    file=$(bot_identity::state_file "$slot")
    for attempt in 1 2; do
        # Atomic create-with-content: write the claim to a temp file, then
        # hard-link it into place. `ln` fails with EEXIST atomically AND the
        # winner's file is never observable empty — an O_EXCL `>` redirect
        # creates a ZERO-BYTE file first, and a rival reading that microsecond
        # window sees "no holder", declares the claim corrupt and steals it.
        # (Observed: two concurrent env-spins both winning the slot.)
        tmp=$(mktemp "${dir}/.slot-${slot}.XXXXXX" 2>/dev/null) || return 0
        bot_identity::_write_claim "$slug" > "$tmp" 2>/dev/null
        if ln "$tmp" "$file" 2>/dev/null; then
            rm -f "$tmp" 2>/dev/null || true
            return 0
        fi
        rm -f "$tmp" 2>/dev/null || true
        holder=$(bot_identity::holder "$slot")
        [[ "$holder" == "$slug" ]] && return 0
        if [[ -z "$holder" ]]; then
            # Truly unreadable claim (corrupt or a torn write from an older
            # build). Only reclaim once it has aged out — never on sight.
            if bot_identity::_file_aged_out "$file"; then
                rm -f "$file" 2>/dev/null || true
                continue
            fi
            printf 'unknown'
            return 1
        fi
        if ! bot_identity::_holder_is_stale "$slot" "$holder"; then
            printf '%s' "$holder"
            return 1
        fi
        # Stale holder: container gone AND the claim aged out. Drop it and
        # retry the atomic create — a rival that wins the retry is reported
        # normally.
        rm -f "$file" 2>/dev/null || true
    done
    holder=$(bot_identity::holder "$slot")
    if [[ -n "$holder" && "$holder" != "$slug" ]]; then
        printf '%s' "$holder"
        return 1
    fi
    return 0
}

# Age of a claim in seconds, from its own timestamp (NOT the file mtime — a
# claim file can be rewritten by tooling without the lease changing hands).
# An unparseable timestamp counts as ancient so a corrupt claim can never
# wedge a slot forever.
bot_identity::_claim_age_seconds() {
    local ts="$1" epoch now
    epoch=$(date -u -d "$ts" +%s 2>/dev/null \
        || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null \
        || echo "")
    if [[ -z "$epoch" ]]; then printf '999999'; return 0; fi
    now=$(date -u +%s)
    printf '%s' "$(( now - epoch ))"
}

# Is the holder's claim stale — i.e. safe to steal? Only when its container is
# gone AND the claim is older than the grace window. The window matters: a
# CONCURRENT env-spin holds the claim for the whole build/boot, during which
# its container legitimately does not exist yet. Without it, the loser of the
# race would "reclaim" the winner's identity and both envs would boot on one
# bot token — exactly the collision the lease prevents.
bot_identity::_holder_is_stale() {
    local slot="$1" holder="$2" file age grace
    docker inspect "rl-env-${holder}-allinone" >/dev/null 2>&1 && return 1
    file=$(bot_identity::state_file "$slot")
    age=$(bot_identity::_claim_age_seconds "$(jq -r '.claimed_at // ""' "$file" 2>/dev/null)")
    grace="${RL_BOT_IDENTITY_CLAIM_GRACE_SECONDS:-300}"
    (( age >= grace ))
}

# True when a claim FILE's mtime is older than the grace window. Used only for
# the unreadable-content case, where there is no timestamp to read.
bot_identity::_file_aged_out() {
    local file="$1" grace_min
    grace_min=$(( ${RL_BOT_IDENTITY_CLAIM_GRACE_SECONDS:-300} / 60 ))
    (( grace_min < 1 )) && grace_min=1
    [[ -n "$(find "$file" -mmin "+${grace_min}" 2>/dev/null)" ]]
}

bot_identity::_write_claim() {
    jq -nc --arg slug "$1" --arg ts "$(date -u +%FT%TZ)" \
        '{slug: $slug, claimed_at: $ts}'
}

# --- Visibility (D2) ---------------------------------------------------------

# Stamp each entry of a `status`-shaped envs[] array with its slot's PUBLIC
# bot identity. Entries whose slot can't be resolved get bot_identity:null
# rather than a fabricated identity — "unknown" must not look like "slot 1".
bot_identity::augment_envs() {
    local envs_json="$1" out="[]" entry slot identity
    while IFS= read -r entry; do
        [[ -z "$entry" ]] && continue
        slot=$(jq -r '.slot // empty' <<<"$entry" 2>/dev/null || true)
        if [[ "$slot" =~ ^[0-9]+$ ]]; then
            identity=$(bot_identity::public_json "$slot")
        else
            identity="null"
        fi
        out=$(jq -c --argjson e "$entry" --argjson id "$identity" \
            '. + [$e + {bot_identity: $id}]' <<<"$out")
    done < <(jq -c '.[]' <<<"$envs_json" 2>/dev/null)
    printf '%s' "$out"
}

# --- Command deregistration on teardown (A3-B P5) -----------------------------
#
# Slash commands OUTLIVE the env that registered them: Discord stores them
# against the APPLICATION, not the container. A destroyed env therefore leaves
# a live-looking /bind in the test guild's picker that routes to an application
# nobody is running — "The application did not respond", with nothing in any
# env's logs to explain it. That cost the operator two test attempts on
# 2026-09-03, so env-destroy now deletes the slot app's commands.
#
# Both scopes are cleared: GLOBAL (what every slot app used to register, and
# what accumulates across every slot that has ever run) and per-guild for every
# guild the bot is actually in. The guild list is DISCOVERED from the token via
# GET /users/@me/guilds rather than configured, so this needs no new
# /srv/rl-infra/.env entry and cannot drift out of date.
#
# NOT wired into `release`: the agent default is --preserve-envs, so the env on
# a released slot is usually still running and still needs its commands. The
# operator's destroy-envs path reaches env-destroy anyway, which is where this
# belongs.
#
# SECRET HANDLING: the bot token never reaches argv. curl reads its whole
# request — headers included — from stdin via `--config -`, which keeps this
# inside the module rule at the top of the file (the token goes to a pipe and
# nowhere else). `ps` on the VM sees only `curl --config -`.
#
# BEST-EFFORT BY CONSTRUCTION: callers run under `set -euo pipefail`, so every
# path here returns 0. A Discord outage must never wedge a teardown.
#
# Test seams: RL_DISCORD_API_BASE points at a stub endpoint;
# RL_BOT_DEREGISTER_DISABLED=1 skips the whole thing.

# One curl call whose config (method, headers, url, body) arrives on stdin.
bot_identity::_discord_call() {
    local method="$1" url="$2" token="$3" body="${4:-}"
    {
        printf -- '--silent\n--show-error\n'
        printf -- '--max-time %s\n' "${RL_DISCORD_API_TIMEOUT:-10}"
        printf -- '--request %s\n' "$method"
        printf -- '--header "Authorization: Bot %s"\n' "$token"
        printf -- '--header "Content-Type: application/json"\n'
        if [[ -n "$body" ]]; then printf -- '--data "%s"\n' "$body"; fi
        printf -- 'url = "%s"\n' "$url"
    } | curl --config - 2>/dev/null || true
}

# Delete every slash command the slot's app has registered, global and guild.
# Args: <slot> <slug>. The slug is checked against the identity holder so that
# destroying one env never strips the commands of a LIVE sibling env that
# currently owns the slot's bot.
bot_identity::deregister_commands() {
    local slot="$1" slug="$2" holder token client_id api guilds gid
    if [[ ! "$slot" =~ ^[0-9]+$ ]]; then return 0; fi
    if [[ "${RL_BOT_DEREGISTER_DISABLED:-0}" == "1" ]]; then return 0; fi
    bot_identity::configured "$slot" || return 0
    command -v curl >/dev/null 2>&1 || return 0
    holder=$(bot_identity::holder "$slot")
    if [[ -n "$holder" && "$holder" != "$slug" ]]; then return 0; fi

    token=$(bot_identity::value "$slot" BOT_TOKEN)
    client_id=$(bot_identity::value "$slot" CLIENT_ID)
    api="${RL_DISCORD_API_BASE:-https://discord.com/api/v10}"

    bot_identity::_discord_call PUT \
        "${api}/applications/${client_id}/commands" "$token" '[]' >/dev/null

    guilds=$(bot_identity::_discord_call GET "${api}/users/@me/guilds" "$token")
    while IFS= read -r gid; do
        if [[ -z "$gid" ]]; then continue; fi
        bot_identity::_discord_call PUT \
            "${api}/applications/${client_id}/guilds/${gid}/commands" \
            "$token" '[]' >/dev/null
    done < <(jq -r 'if type == "array" then .[].id else empty end' \
        <<<"$guilds" 2>/dev/null || true)
    return 0
}
