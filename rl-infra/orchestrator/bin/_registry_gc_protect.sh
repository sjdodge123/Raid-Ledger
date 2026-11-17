#!/usr/bin/env bash
# ROK-2018 — the registry GC's protection set, sourced by _registry_gc.sh
# (which defines RL_REGISTRY_REPO, registry_gc::head, registry_gc::_manifest
# and registry_gc::_is_index_type). No side effects.
#
# A manifest DELETE is by digest and drops EVERY tag sharing that digest, so
# "what must survive" is a set of DIGESTS, built fail-closed (Codex P1/P2):
#   - the digest of every tag the run keeps (protected, keep-N survivor, too
#     young, unknown age — everything in the registry that is not doomed),
#     and the child digests of each kept index / manifest list (ROK-2180);
#   - every `@sha256:` pin of this repo in a container ref, an env row's
#     `.image`, or a local image's RepoDigests, and the child digests of each
#     pin that is an index / manifest list (ROK-2180 r2: a doomed tag spared
#     only by its pin, or an untagged pinned index, has live children too).
# Any kept tag or pin whose manifest cannot be read makes the whole set
# unreadable. Children are always read BY DIGEST, never by a tag that can move.

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

# Child manifest digests of index/list <$1> (a DIGEST — a tag can move between
# the HEAD and this GET, e.g. under env-destroy, which holds no admission
# entry), one per line; empty for a plain manifest. Returns 1 when the
# manifest GET or its JSON fails.
registry_gc::_children() {
    local m
    m=$(registry_gc::_manifest "$1") || return 1
    jq -r '.manifests[]?.digest // empty' <<<"$m" 2>/dev/null
}

# One HEAD per kept tag (<$1>, newline list): `D <digest>` for the tag AND,
# when it is an index/list or of unreadable type, `D <child>` for each of its
# children plus `I <tag>`. A DELETE of a child digest (an old standalone tag
# that equals it) drops the child's revision link and GC then sweeps its
# layers even without --delete-untagged, breaking the kept index (ROK-2180
# Codex P1). Calls <$2> (renew callback, optional) before each tag.
# rc 1 = a digest or a child list is unreadable (fail closed); 3 = callback failed.
registry_gc::_kept_scan() {
    local tag h d kids
    for tag in $1; do
        if [[ -n "${2:-}" ]] && ! "$2"; then return 3; fi
        h=$(registry_gc::head "$tag"); d="${h%%|*}"
        if [[ -z "$d" ]]; then
            echo "registry_gc: digest of kept tag ${RL_REGISTRY_REPO}:$tag unreadable" >&2; return 1
        fi
        echo "D $d"
        registry_gc::_is_index_type "${h#*|}" || continue
        echo "I $tag"
        if ! kids=$(registry_gc::_children "$d"); then
            echo "registry_gc: children of kept index ${RL_REGISTRY_REPO}:$tag unreadable" >&2; return 1
        fi
        sed '/^$/d; s/^/D /' <<<"$kids"
    done
}

# Manifest body of pinned digest <$1>, via the HTTP status (no curl -f): the
# JSON on 200; nothing on 404 — that manifest is gone, so nothing of it is
# left to protect (a stale local RepoDigest must not wedge every sweep).
# rc 1 on a transport error or any other status (fail closed).
registry_gc::_pin_manifest() {
    local out
    out=$(curl -sS --max-time 10 -H "$_REGISTRY_ACCEPT" -w '\n%{http_code}' \
        "$(registry_gc::_api)/manifests/$1" 2>/dev/null) || return 1
    case "${out##*$'\n'}" in
        # An empty 200 must not read as the 404 "gone" case (fail closed).
        200) [[ -n "${out%$'\n'*}" ]] || return 1; printf '%s\n' "${out%$'\n'*}" ;;
        404) echo "registry_gc: pinned ${RL_REGISTRY_REPO}@$1 is not in the registry" >&2 ;;
        *) return 1 ;;
    esac
}

# `D <child>` for each child of every pin (<$1>, newline list of digests) that
# is an index/list, its manifest read BY DIGEST. Calls <$2> (renew callback,
# optional) before each pin. rc 1 = a pin's manifest is unreadable (fail
# closed); 3 = callback failed.
registry_gc::_pin_scan() {
    local pin m kids
    for pin in $1; do
        if [[ -n "${2:-}" ]] && ! "$2"; then return 3; fi
        if ! m=$(registry_gc::_pin_manifest "$pin"); then
            echo "registry_gc: manifest of pinned ${RL_REGISTRY_REPO}@$pin unreadable" >&2; return 1
        fi
        [[ -z "$m" ]] && continue
        if ! kids=$(jq -r '.manifests[]?.digest // empty' <<<"$m" 2>/dev/null); then
            echo "registry_gc: manifest of pinned ${RL_REGISTRY_REPO}@$pin is not JSON" >&2; return 1
        fi
        sed '/^$/d; s/^/D /' <<<"$kids"
    done
}

# _kept_scan of the kept tags <$1> + _pin_scan of the pins <$2> (digests),
# same output and rc contract; <$3> = renew callback (optional).
registry_gc::_protect_scan() {
    registry_gc::_kept_scan "$1" "${3:-}" || return $?
    registry_gc::_pin_scan "$2" "${3:-}"
}

# Digests no DELETE may touch, one per line: each kept tag's digest and, for
# a kept index/list, its children's (<$1>, newline list of registry tags —
# see _kept_scan), the pins in <$2> (protected_refs output) and, for a pinned
# index/list, its children's. Returns 1 when any of those is unreadable —
# fail closed.
registry_gc::avoid_digests() {
    local scan pins
    pins=$(registry_gc::_pins_of <<<"$2")
    scan=$(registry_gc::_protect_scan "$1" "$pins") || return 1
    sed -n 's/^D //p' <<<"$scan"
    printf '%s\n' "$pins" | sed '/^$/d'
}
