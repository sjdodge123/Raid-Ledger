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
    if [[ ! -f "$path" ]]; then printf '{}'; return 0; fi
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
