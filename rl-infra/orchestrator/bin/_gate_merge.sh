#!/usr/bin/env bash
# ROK-1793 S2 — merge a parallel fleet gate's child summaries (spec D5).
#
# Usage: _gate_merge.sh <P>
#
# Reads P's children[] ({task_id, role, slot}) and the LAST Summary block of
# each child's log, applies fixed row ownership and prints ONE canonical
# Summary table in validate-ci.sh's print_summary format (`%-30s  STATUS — note`),
# so the MCP sentinel parsers read it unchanged:
#   child a owns every row except Playwright + Discord (it stamps those SKIPPED);
#   child b owns the Playwright row, and the Discord row unless it deferred it;
#   child c (phase 2) owns the Discord row.
# The child id + slot go in the NOTE, never the name. An owned row its child did
# not print is `FAIL — missing from child <id>` (ROK-1565 completeness). Exit 0
# only when no row FAILs and every child succeeded.
set -euo pipefail

P="${1:-}"
[[ "$P" =~ ^[a-z0-9]{8,32}$ ]] || { echo "[parallel] merge: invalid parent id" >&2; exit 2; }
RL_STATE_DIR="${RL_STATE_DIR:-/srv/rl-infra/state}"
RL_TASKS_DIR="${RL_TASKS_DIR:-$RL_STATE_DIR/tasks}"
PJSON="$RL_TASKS_DIR/$P.json"
PLAYWRIGHT_RE='^Playwright \(desktop \+ mobile'
DISCORD_RE='^Discord smoke'
REQUIRED_A=("Build (all workspaces)" "TypeScript (all)" "Lint (all)")
OUT_NAMES=() OUT_STATUS=() OUT_NOTES=()
FAILED=0

# child_rows <log> — "name<TAB>status<TAB>note" per row of the last Summary block.
child_rows() {
    [[ -f "$1" ]] || return 0
    sed 's/\x1b\[[0-9;]*m//g' "$1" | awk '/^=+ *Summary *=+ *$/ { n = NR } { line[NR] = $0 }
        END { for (i = n + 1; i <= NR; i++) print line[i] }' |
    while IFS= read -r line; do
        if [[ "$line" =~ ^([A-Za-z].*[^ ])\ {2,}(PASS|FAIL|SKIPPED)(\ —\ (.*))?$ ]]; then
            printf '%s\t%s\t%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[4]}"
        fi
    done
}

# emit <name> <status> <note> <child_id> <slot>
emit() {
    local note="child $4 slot $5"
    [[ -n "$3" ]] && note="$3 — $note"
    OUT_NAMES+=("$1"); OUT_STATUS+=("$2"); OUT_NOTES+=("$note")
    [[ "$2" == "FAIL" ]] && FAILED=1
    return 0
}

# take <id> <slot> <filter: a|playwright|discord> <required name>... — copy the
# owned rows of one child; each required name it did not print becomes FAIL.
take() {
    local id="$1" slot="$2" filter="$3" name status note found=""; shift 3
    while IFS=$'\t' read -r name status note; do
        case "$filter" in
            a) [[ "$name" =~ $PLAYWRIGHT_RE || "$name" =~ $DISCORD_RE ]] && continue ;;
            playwright) [[ "$name" =~ $PLAYWRIGHT_RE ]] || continue ;;
            discord) [[ "$name" =~ $DISCORD_RE ]] || continue ;;
        esac
        emit "$name" "$status" "$note" "$id" "$slot"
        found+="|$name|"
    done < <(child_rows "$RL_TASKS_DIR/$id.log")
    for name in "$@"; do
        # A scoped label (`Playwright (desktop + mobile, scoped: 2 specs)`)
        # satisfies the Playwright/Discord requirement; child a's names are exact.
        [[ "$filter" != a && -n "$found" ]] && continue
        [[ "$found" == *"|$name|"* ]] && continue
        emit "$name" "FAIL" "missing from child $id" "$id" "$slot"
    done
}

if [[ ! -f "$PJSON" ]] || [[ "$(jq '(.children // []) | length' "$PJSON")" == "0" ]]; then
    if [[ -f "$RL_TASKS_DIR/$P.log" ]] && grep -q '^\[parallel\] fallback: serial' "$RL_TASKS_DIR/$P.log"; then
        exit 0   # serial fallback: the serial run's own summary stands.
    fi
    echo "[parallel] merge: no children recorded for $P"
    exit 1
fi

child() { jq -r --arg r "$1" '.children[] | select(.role == $r) | "\(.task_id) \(.slot)"' "$PJSON" | head -1; }
read -r A_ID A_SLOT <<<"$(child a)" || true
read -r B_ID B_SLOT <<<"$(child b)" || true
read -r C_ID C_SLOT <<<"$(child c)" || true
[[ -n "${A_ID:-}" ]] && take "$A_ID" "$A_SLOT" a "${REQUIRED_A[@]}"
if [[ -n "${B_ID:-}" ]]; then
    take "$B_ID" "$B_SLOT" playwright "Playwright (desktop + mobile)"
    if [[ -n "${C_ID:-}" ]]; then
        take "$C_ID" "$C_SLOT" discord "Discord smoke (companion bot)"
    elif grep -q '^\[parallel\] discord-deferred' "$RL_TASKS_DIR/$B_ID.log" 2>/dev/null; then
        emit "Discord smoke (companion bot)" FAIL "missing from child ${P:0:31}c" "${P:0:31}c" "$B_SLOT"
    else
        take "$B_ID" "$B_SLOT" discord
    fi
fi

COUNT=0
for id in ${A_ID:-} ${B_ID:-} ${C_ID:-}; do
    COUNT=$((COUNT + 1))
    st=$(jq -r '.status // "missing"' "$RL_TASKS_DIR/$id.json" 2>/dev/null || echo missing)
    [[ "$st" == "succeeded" ]] || FAILED=1
done

echo ""
echo "========== Summary =========="
printf "%-30s  %s\n" "Check" "Result"
printf "%-30s  %s\n" "-----" "------"
for i in "${!OUT_NAMES[@]}"; do
    printf "%-30s  %s — %s\n" "${OUT_NAMES[$i]}" "${OUT_STATUS[$i]}" "${OUT_NOTES[$i]}"
done
echo ""
echo "[parallel] merged: ${#OUT_NAMES[@]} rows from $COUNT children"
exit "$FAILED"
