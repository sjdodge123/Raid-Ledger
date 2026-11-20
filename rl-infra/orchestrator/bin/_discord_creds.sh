#!/usr/bin/env bash
# ROK-2280 — companion-bot credentials for Discord-tier fleet gates.
#
# Sourced by run-on-runner-with-heartbeat. The VM keys RL_TEST_BOT_TOKEN and
# RL_DISCORD_TEST_GUILD_ID reach the wrapper's env through _state.sh (which
# sources /srv/rl-infra/.env). They are forwarded to the runner as
# TEST_BOT_TOKEN / TEST_GUILD_ID with `docker exec -e NAME` — name only, so the
# value never lands in the exec's Cmd, the audit log or the task log
# (ROK-1846 c6). Only an rl_validate_ci run whose validate-ci.sh args select
# the Discord tier gets them; everything else fails closed.
#
# Sets DISCORD_CREDS_FLAGS (array) for the caller to splice into docker exec.
#
# When the tier is wanted but a VM key is missing, the missing key NAMES (never
# a value) go to the runner as RL_DISCORD_CREDS_MISSING, so validate-ci.sh can
# tell "set this VM key" from "this kind of run never gets creds" (no marker).

# shellcheck disable=SC2034 # read by the sourcing wrapper.
DISCORD_CREDS_FLAGS=()
# An inherited marker must never reach the runner on a run that did not set it.
unset RL_DISCORD_CREDS_MISSING

# discord_creds::tier_wanted "$@" — 0 when the wrapped argv runs validate-ci.sh
# with args that can reach the Discord smoke tier. Exclusions win over
# inclusions; no validate-ci.sh in argv → not wanted.
discord_creds::tier_wanted() {
    local joined="$*" word
    [[ "$joined" == *validate-ci.sh* ]] || return 1
    joined="${joined//\'/ }"
    joined="${joined//\"/ }"
    # shellcheck disable=SC2086 # word-split on purpose: one flag per word.
    for word in $joined; do
        case "$word" in
            RL_GATE_DISCORD=defer|--scoped|--static|--no-e2e|--only-unit|--only-integration)
                return 1 ;;
        esac
    done
    # --only-e2e / --with-e2e / --fleet / --fleet-e2e / RL_GATE_DISCORD=only,
    # and a bare or --full run (diff-gated e2e_mode=auto) all may reach it.
    return 0
}

# _discord_creds::trim <value> — strip CR and surrounding whitespace.
_discord_creds::trim() {
    local v="${1//$'\r'/}"
    v="${v#"${v%%[![:space:]]*}"}"
    v="${v%"${v##*[![:space:]]}"}"
    printf '%s' "$v"
}

# discord_creds::flags — exports TEST_BOT_TOKEN / TEST_GUILD_ID in THIS process
# and fills DISCORD_CREDS_FLAGS with `-e NAME` pairs. A missing key is named on
# stdout (never a value or its length), NEITHER var is forwarded, and the names
# go to the runner as RL_DISCORD_CREDS_MISSING instead.
discord_creds::flags() {
    DISCORD_CREDS_FLAGS=()
    unset RL_DISCORD_CREDS_MISSING
    local token guild missing=""
    token=$(_discord_creds::trim "${RL_TEST_BOT_TOKEN:-}")
    guild=$(_discord_creds::trim "${RL_DISCORD_TEST_GUILD_ID:-}")
    [[ -n "$token" ]] || missing="RL_TEST_BOT_TOKEN"
    [[ -n "$guild" ]] || missing="${missing:+$missing, }RL_DISCORD_TEST_GUILD_ID"
    if [[ -n "$missing" ]]; then
        echo "[discord-creds] $missing unset in /srv/rl-infra/.env — Discord smoke will SKIP (rl-infra/SETUP.md §3.2)"
        export RL_DISCORD_CREDS_MISSING="$missing"
        # shellcheck disable=SC2034 # read by the sourcing wrapper.
        DISCORD_CREDS_FLAGS=(-e RL_DISCORD_CREDS_MISSING)
        return 0
    fi
    export TEST_BOT_TOKEN="$token" TEST_GUILD_ID="$guild"
    # shellcheck disable=SC2034 # read by the sourcing wrapper.
    DISCORD_CREDS_FLAGS=(-e TEST_BOT_TOKEN -e TEST_GUILD_ID)
}
