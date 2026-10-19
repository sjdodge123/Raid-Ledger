#!/usr/bin/env bash
# ROK-1793 S2 — borrow a FREE second runner slot for one parallel gate.
#
# A borrow is an ordinary claims.json row whose agent id is the synthetic
# `borrow-<parent_task_id>` (plus `borrowed_for` / `borrowed_by`). Every
# existing slot lookup (state::slot_for_agent, claim's free-slot pick) then
# treats the slot as claimed without any change, and the REAL agent keeps
# exactly one row (its own slot A) — no second agent id, no second Mutagen
# session (CLAUDE.md `worktree_path` STRICT).
#
# "Free at dispatch" (spec D2): claimed == false AND the slot's lease queue is
# empty AND the slot is not in the caller's exclude list (live laptop Mutagen
# sessions). A borrow NEVER enqueues. Lock order matches claim/lease-advance:
# the slot's queue lock first, then claims (via mutate_with_precondition).
#
# Source after _state.sh and _admission.sh.

RL_RUNNERS_DIR="${RL_RUNNERS_DIR:-/srv/rl-infra/runners}"
RL_MEDIUM_TASK_MIN_FREE_MB="${RL_MEDIUM_TASK_MIN_FREE_MB:-2560}"

# borrow::agent_id <parent_id> — the synthetic agent id of a borrow row.
borrow::agent_id() { printf 'borrow-%s' "$1"; }

# borrow::memory_ok — 0 when the host can hold one more heavy AND one medium
# task on top of the heavy reservations already running. Unreadable meminfo
# fails open (same contract as admission::acquire).
borrow::memory_ok() {
    local avail running need
    avail="$(admission::mem_available_mb)"
    [[ -n "$avail" ]] || return 0
    admission::ensure_file
    running="$(admission::running_count)"
    need=$(( RL_HEAVY_TASK_MIN_FREE_MB + RL_MEDIUM_TASK_MIN_FREE_MB ))
    (( avail - running * RL_HEAVY_TASK_MIN_FREE_MB >= need ))
}

# borrow::_claim_if_free <slot> <parent_id> <owner_agent> <branch>
# Under the slot's queue lock: refuse when the queue is non-empty, otherwise
# flip the claims row only if it is still unclaimed (single flock window).
borrow::_claim_if_free() {
    local slot="$1" parent="$2" owner="$3" branch="$4" qfile now
    lease::ensure_file "$slot"
    qfile=$(lease::file_for_slot "$slot")
    now=$(date -u +%FT%TZ)
    (
        flock -x 201
        [[ "$(jq 'length' "$qfile" 2>/dev/null || echo 1)" == "0" ]] || exit 1
        state::mutate_with_precondition "$RL_CLAIMS_FILE" \
            --argjson s "$slot" --arg a "$(borrow::agent_id "$parent")" \
            --arg p "$parent" --arg o "$owner" --arg b "$branch" --arg t "$now" \
            'map(if .slot == $s and .claimed == false
                 then .claimed = true | .agent_id = $a | .branch = $b
                      | .started_at = $t | .last_heartbeat = $t
                      | .expires_at = null | .keep_alive = false
                      | .extends_count = 0
                      | .borrowed_for = $p | .borrowed_by = $o
                 else . end)'
    ) 201>"$RL_LOCK_DIR/$(basename "$qfile").lock"
}

# borrow::try <owner_slot> <parent_id> <exclude_csv>
# Echoes the borrowed slot on success (exit 0). Exit 1 = no free slot,
# exit 3 = not enough host memory for a second gate (nothing is borrowed).
borrow::try() {
    local owner_slot="$1" parent="$2" exclude=",${3:-},"
    local owner branch slot
    borrow::memory_ok || return 3
    owner=$(jq -r --argjson s "$owner_slot" '.[] | select(.slot == $s) | .agent_id // ""' "$RL_CLAIMS_FILE")
    branch=$(jq -r --argjson s "$owner_slot" '.[] | select(.slot == $s) | .branch // ""' "$RL_CLAIMS_FILE")
    for slot in $(jq -r '.[] | select(.claimed == false) | .slot' "$RL_CLAIMS_FILE"); do
        [[ "$slot" == "$owner_slot" || "$exclude" == *",$slot,"* ]] && continue
        if borrow::_claim_if_free "$slot" "$parent" "$owner" "$branch"; then
            audit::log borrow granted "$(jq -nc --argjson s "$slot" --arg p "$parent" '{slot:$s, parent_task_id:$p}')"
            echo "$slot"
            return 0
        fi
    done
    return 1
}

# borrow::heartbeat <slot> <parent_id> — keep the borrow row's heartbeat fresh.
borrow::heartbeat() {
    local slot="$1" a now
    a=$(borrow::agent_id "$2")
    now=$(date -u +%FT%TZ)
    state::mutate "$RL_CLAIMS_FILE" --argjson s "$slot" --arg a "$a" --arg t "$now" \
        'map(if .slot == $s and .agent_id == $a then .last_heartbeat = $t else . end)'
}

# borrow::release <slot> <parent_id> — reset the row (only if it is still this
# parent's borrow) and advance the slot's lease queue exactly like `release`.
# Never destroys envs and never cleans the runner: a preserved env on the
# borrowed slot belongs to someone else. Idempotent.
borrow::release() {
    local slot="$1" a
    a=$(borrow::agent_id "$2")
    if state::mutate_with_precondition "$RL_CLAIMS_FILE" --argjson s "$slot" --arg a "$a" \
        'map(if .slot == $s and .agent_id == $a
             then .claimed = false | .agent_id = null | .branch = null
                  | .started_at = null | .last_heartbeat = null | .expires_at = null
                  | .extends_count = 0 | del(.borrowed_for, .borrowed_by)
             else . end)'; then
        audit::log borrow released "$(jq -nc --argjson s "$slot" --arg a "$a" '{slot:$s, agent_id:$a}')"
    fi
    "${BIN_DIR_SELF:-$(dirname "${BASH_SOURCE[0]}")}/lease-advance" --slot "$slot" >/dev/null 2>&1 || true
}

# borrow::copy_tree <A> <B> — copy slot A's /workspace tree onto slot B's.
# node_modules and build output stay B's own; B's node_modules is a separate
# named volume.
#
# Staged so a failed copy never leaves B half-copied: (1) rsync A into a
# staging dir under slot B (kept between runs, so the next copy is
# incremental); (2) stream A's `.git` container-to-container (tar over docker exec) into a staging
# dir inside B's /workspace; (3) only then move the host staging onto B's tree
# with --delay-updates and rename the staged `.git` into place. A failure in
# (1) or (2) cleans both stagings and leaves B untouched. The worktree dir
# itself is never renamed: the runner container bind-mounts it.
#
# Why `.git` goes container-to-container: it is runner-scaffolded and
# root-owned on a previously used slot, so the host rsync (rl-agent) cannot
# update it, and nothing else re-creates `.git` on a borrowed slot. Inside the
# containers the copy runs as root.
# Why a `tar` pipe through two `docker exec`s and NOT `docker cp` (Codex r3
# P1): the orchestrator reaches Docker through the wollomatic socket proxy
# (rl-infra/docker-compose.yml), whose allow-list has no
# `/containers/{id}/archive` route, so `docker cp` is a 403 on every default
# scaffold. `POST /containers/rl-runner-N/exec` + `POST /exec/{id}/start`
# (attached, stdin included) ARE allowed — the same path `_exec_bits.sh`
# already uses with `docker exec -i`. Do not widen the proxy for this.
# What the host copy skips: `.git` (above), the git staging dir, B-local build
# output, plus exactly what the laptop's Mutagen session ignores
# (rl-infra/cli/rl ensure_mutagen — keep in sync), so B never holds a secret
# A's replica would not. Includes first: rsync's first match wins. Excluded
# paths are also protected from --delete.
BORROW_GIT_STAGE=/workspace/.rl-git-staging
BORROW_COPY_FILTER=(--include=.env.example --include='.env.*.example' --exclude=.env --exclude='.env.*'
    --exclude=/.git --exclude=/.rl-git-staging
    --exclude=node_modules --exclude=dist --exclude=coverage --exclude=test-results
    --exclude=playwright-report --exclude=/scripts/.auth --exclude='*.tsbuildinfo'
    --exclude=/.rl-perf.log --exclude=/.rl-perf.log.errors)

# borrow::_runner <slot> — the runner container name (bin/claim, bin/release).
borrow::_runner() { printf 'rl-runner-%s' "$1"; }

# borrow::_stage_git <A> <B> — stream A's /workspace/.git into B's git staging
# dir. Exit 1 (staging removed) on any failure; B's live .git is not touched.
borrow::_stage_git() {
    local ra rb rc_out rc_in
    ra=$(borrow::_runner "$1"); rb=$(borrow::_runner "$2")
    borrow::_drop_git_stage "$2"
    if docker exec "$rb" mkdir -p "$BORROW_GIT_STAGE"; then
        docker exec "$ra" tar -C /workspace -cf - .git \
            | docker exec -i "$rb" tar -C "$BORROW_GIT_STAGE" -xf -
        rc_out=${PIPESTATUS[0]} rc_in=${PIPESTATUS[1]}
        (( rc_out == 0 && rc_in == 0 )) && return 0
    fi
    borrow::_drop_git_stage "$2"
    return 1
}

# borrow::_drop_git_stage <B> — remove B's git staging dir (best effort).
borrow::_drop_git_stage() { docker exec "$(borrow::_runner "$1")" rm -rf "$BORROW_GIT_STAGE" >/dev/null 2>&1 || true; }

# borrow::_commit_git <B> — replace B's .git with the staged one.
borrow::_commit_git() {
    docker exec "$(borrow::_runner "$1")" sh -c \
        "rm -rf /workspace/.git && mv $BORROW_GIT_STAGE/.git /workspace/.git && rmdir $BORROW_GIT_STAGE"
}

# borrow::_fail_stage <B> <stage> <msg> — remove the host staging, report,
# exit 1 (_stage_git already removed its own staging on failure).
borrow::_fail_stage() {
    # rsync -a copies a source dir's mode, so an unreadable dir lands as 000.
    chmod -R u+rwX "$2" 2>/dev/null || true
    rm -rf "$2"
    echo "[parallel] copy failed: $3 (slot $1 tree untouched)" >&2
    return 1
}

borrow::copy_tree() {
    local a="$1" b="$2" src dst stage t0 files git=0
    src="$RL_RUNNERS_DIR/slot-$a/worktree"
    dst="$RL_RUNNERS_DIR/slot-$b/worktree"
    stage="$RL_RUNNERS_DIR/slot-$b/.worktree-staging"
    [[ -d "$src" && -d "$dst" ]] || { echo "[parallel] copy failed: missing worktree dir" >&2; return 1; }
    t0=$(date +%s)
    mkdir -p "$stage" || return 1
    rsync -a --delete "${BORROW_COPY_FILTER[@]}" "$src/" "$stage/" \
        || { borrow::_fail_stage "$b" "$stage" "staging rsync"; return 1; }
    if [[ -e "$src/.git" ]]; then
        git=1
        borrow::_stage_git "$a" "$b" || { borrow::_fail_stage "$b" "$stage" ".git exec-tar stream"; return 1; }
    fi
    if ! rsync -a --delete --delay-updates "${BORROW_COPY_FILTER[@]}" "$stage/" "$dst/"; then
        find "$dst" -name '.~tmp~' -type d -prune -exec rm -rf {} + 2>/dev/null || true
        (( git )) && borrow::_drop_git_stage "$b"
        echo "[parallel] copy failed: swap onto slot $b" >&2
        return 1
    fi
    if (( git )) && ! borrow::_commit_git "$b"; then
        echo "[parallel] copy failed: .git swap on slot $b" >&2
        return 1
    fi
    files=$(find "$dst" -type f -not -path '*/node_modules/*' 2>/dev/null | wc -l | tr -d ' ')
    echo "[parallel] copy slot ${a}→${b}: ${files} files, $(( $(date +%s) - t0 ))s"
}
