#!/usr/bin/env bash
# ROK-2018 — the registry GC's protection set, sourced by _registry_gc.sh
# (which defines RL_REGISTRY_REPO and registry_gc::digest). No side effects.
#
# A manifest DELETE is by digest and drops EVERY tag sharing that digest, so
# "what must survive" is a set of DIGESTS, built fail-closed (Codex P1/P2):
#   - the digest of every tag the run keeps (protected, keep-N survivor, too
#     young, unknown age — everything in the registry that is not doomed);
#   - every `@sha256:` pin of this repo in a container ref, an env row's
#     `.image`, or a local image's RepoDigests.
# Any kept tag whose digest cannot be read makes the whole set unreadable.

# rl-allinone image refs (stdin, one per line, any registry prefix or none:
# `rl-allinone:x`, `127.0.0.1:5000/rl-allinone:x`, `registry.rl.lan:5000/
# rl-allinone:x`) → bare tags. Other repos and digest refs drop out, so two
# spellings of the same tag compare equal.
registry_gc::_tags_of() {
    sed -n "s#^\(.*/\)\{0,1\}${RL_REGISTRY_REPO}:\([^@/]*\)\$#\2#p"
}

# rl-allinone refs pinned by digest (stdin: `…/rl-allinone@sha256:d` or
# `…/rl-allinone:tag@sha256:d`) → `sha256:d`. Other repos drop out.
registry_gc::_pins_of() {
    sed -n "s#^\(.*/\)\{0,1\}${RL_REGISTRY_REPO}\(:[^@/]*\)\{0,1\}@\(sha256:[^[:space:]]*\)\$#\3#p"
}

# Every image ref that must keep its manifest, one per line: `latest`, any
# container's image (running or stopped), every local image as repo:tag
# (built + pushed but not yet attached to a container or env row) and as
# repo@digest (RepoDigests), and every env-registry row's `.image` — except
# the row of slug <$1> (env-destroy excludes the env being destroyed).
# Returns 1 (no output) when `docker ps`, `docker images` or the env registry
# cannot be read: a partial set would let the sweep delete a live env's image.
registry_gc::protected_refs() {
    local exclude="${1:-}" ps local_imgs local_pins envs
    ps=$(docker ps -a --format '{{.Image}}' 2>/dev/null) || return 1
    local_imgs=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null) || return 1
    local_pins=$(docker images --digests --format '{{.Repository}}@{{.Digest}}' 2>/dev/null) || return 1
    envs=$(jq -er --arg s "$exclude" \
        'if type == "array" then [.[] | select(.slug != $s) | .image // empty] | join("\n") else error("not an array") end' \
        "${RL_ENVS_FILE:-/nonexistent}" 2>/dev/null) || return 1
    printf '%s\n' "${RL_REGISTRY_REPO}:latest" "$ps" "$local_imgs" "$local_pins" "$envs" | sed '/^$/d' | sort -u
}

# Protected tags as a JSON array (see protected_refs); 1 when unreadable.
registry_gc::protected_tags() {
    local refs
    refs=$(registry_gc::protected_refs "${1:-}") || return 1
    registry_gc::_tags_of <<<"$refs" | sort -u | jq -Rnc '[inputs]'
}

# Digests no DELETE may touch, one per line: the digest of each kept tag
# (<$1>, newline list of registry tags) plus the pins in <$2> (protected_refs
# output). Returns 1 when a kept tag's digest is unreadable — fail closed.
registry_gc::avoid_digests() {
    local tag d
    for tag in $1; do
        d=$(registry_gc::digest "$tag")
        if [[ -z "$d" ]]; then
            echo "registry_gc: digest of kept tag ${RL_REGISTRY_REPO}:$tag unreadable" >&2; return 1
        fi
        echo "$d"
    done
    registry_gc::_pins_of <<<"$2"
}
