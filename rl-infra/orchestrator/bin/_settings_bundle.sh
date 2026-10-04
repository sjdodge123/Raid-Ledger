#!/usr/bin/env bash
# ROK-1469 D6 — VM-side encrypted settings bundle.
#
# `rl_env_deploy` used to depend on the operator's laptop: sync_settings
# pg_dumps app_settings out of the local raid-ledger-db container, so with
# Docker Desktop off every deployed env came up with NO API keys (ITAD,
# Co-Optimus, Blizzard, LLM). The bundle removes that dependency:
#
#   laptop:  `rl settings push`  → openssl-encrypts the shared keys →
#            /srv/rl-infra/settings/bundle.enc
#   VM:      env-settings-overlay decrypts it and UPSERTs the keys into the
#            env's app_settings through the app's own encryption path.
#
# The bundle holds COMMUNITY-WIDE API keys only. Per-slot Discord identity is
# never in it — that comes from /srv/rl-infra/.env (see _bot_identity.sh) and
# always wins on a key collision.
#
# Failure policy: NEVER fail a spin over the bundle. Every failure yields `{}`
# plus SETTINGS_BUNDLE_WARNING so the caller can surface it. Silence would be
# worse — a deploy with missing keys looks healthy until a feature 404s.

SETTINGS_BUNDLE_WARNING=""

settings_bundle::path() {
    printf '%s' "${RL_SETTINGS_BUNDLE:-/srv/rl-infra/settings/bundle.enc}"
}

# Decrypt the bundle and echo its settings map. Echoes `{}` when there is no
# bundle (a fleet that predates the first `rl settings push`), when the key is
# missing, or when the decrypt/parse fails.
settings_bundle::payload() {
    SETTINGS_BUNDLE_WARNING=""
    local path plaintext
    path=$(settings_bundle::path)
    # "Absent" is a legitimate silent no-op (a fleet that predates the first
    # push). "Present but unreadable" is a misconfiguration and MUST be loud:
    # on 2026-09-02 `rl settings push` wrote the bundle rl:rl 640 while the
    # orchestrator runs as rl-agent, every read took the absent branch, and the
    # env came up with its identity keys but NONE of the 12 shared keys —
    # overlay_warnings:[] and nothing to go on.
    if [[ ! -e "$path" ]]; then printf '{}'; return 0; fi
    if [[ ! -r "$path" ]]; then
        SETTINGS_BUNDLE_WARNING="settings bundle unreadable by $(id -un 2>/dev/null || echo "$USER"): ${path} — shared API keys NOT applied. Fix: chgrp rl-fleet + chmod 640 the file and chmod 2750 its directory."
        printf '{}'
        return 0
    fi
    if [[ -z "${RL_SETTINGS_BUNDLE_KEY:-}" ]]; then
        SETTINGS_BUNDLE_WARNING="settings bundle present at ${path} but RL_SETTINGS_BUNDLE_KEY is unset — shared API keys NOT applied"
        printf '{}'
        return 0
    fi
    plaintext=$(openssl enc -d -aes-256-cbc -pbkdf2 -salt \
        -pass env:RL_SETTINGS_BUNDLE_KEY -in "$path" 2>/dev/null) || plaintext=""
    if [[ -z "$plaintext" ]]; then
        SETTINGS_BUNDLE_WARNING="settings bundle at ${path} could not be decrypted (wrong RL_SETTINGS_BUNDLE_KEY or corrupt file) — shared API keys NOT applied"
        printf '{}'
        return 0
    fi
    if ! jq -e 'type == "object"' >/dev/null 2>&1 <<<"$plaintext"; then
        SETTINGS_BUNDLE_WARNING="settings bundle at ${path} did not decrypt to a JSON object — shared API keys NOT applied"
        printf '{}'
        return 0
    fi
    jq -c '.' <<<"$plaintext"
}

# TDB:1904 — bundle.enc freshness for `rl status`, so a stale or undecryptable
# bundle is visible without SSH. Echoes ONE compact JSON object:
#   {present, mtime, age_hours, key_count, decrypts, warning}
# It decrypts in memory to count the keys and NEVER emits a key name or value:
# the plaintext only ever reaches `jq 'keys|length'`.
#
# ALWAYS exits 0 — bin/status runs under `set -euo pipefail`, and a non-zero
# exit here would take the whole of `rl status` down fleet-wide.
settings_bundle::freshness_json() {
    local path epoch="" probe="" warn="" count="" decrypts=false
    path=$(settings_bundle::path)
    if [[ ! -e "$path" ]]; then
        printf '%s\n' '{"present":false,"mtime":null,"age_hours":null,"key_count":null,"decrypts":null,"warning":null}'
        return 0
    fi
    epoch=$(stat -c %Y "$path" 2>/dev/null || stat -f %m "$path" 2>/dev/null || true)
    [[ "$epoch" =~ ^[0-9]+$ ]] || epoch=""
    # payload() and the warning read run in the SAME subshell, so the warning
    # survives. A sentinel splits them — NOT a newline: `$( )` strips trailing
    # newlines, so an empty warning would leave no separator and the plaintext
    # would be read back AS the warning (caught by the no-leak test). The
    # warning is taken after the LAST sentinel, which is always our own printf.
    probe=$(settings_bundle::payload 2>/dev/null; printf '\n__RL_SB_WARN__%s' "${SETTINGS_BUNDLE_WARNING:-}")
    warn="${probe##*__RL_SB_WARN__}"
    if [[ -z "$warn" ]]; then
        decrypts=true
        count=$(printf '%s' "${probe%%__RL_SB_WARN__*}" | jq 'keys | length' 2>/dev/null || true)
    fi
    probe=""
    [[ "$count" =~ ^[0-9]+$ ]] || count=""
    settings_bundle::_freshness_object "$epoch" "$count" "$decrypts" "$warn"
    return 0
}

# Builds the present:true object; falls back to a fixed object if jq fails.
settings_bundle::_freshness_object() {
    jq -nc --arg epoch "$1" --arg count "$2" --argjson decrypts "$3" --arg warn "$4" '
        ($epoch | if . == "" then null else tonumber end) as $e
        | {present: true,
           mtime: (if $e == null then null else ($e | todate) end),
           age_hours: (if $e == null then null else ((((now - $e) / 360) | round) / 10) end),
           key_count: (if $count == "" then null else ($count | tonumber) end),
           decrypts: $decrypts,
           warning: (if $warn == "" then null else $warn end)}' 2>/dev/null \
        || printf '%s\n' '{"present":true,"mtime":null,"age_hours":null,"key_count":null,"decrypts":null,"warning":"settings bundle freshness probe failed"}'
    return 0
}
