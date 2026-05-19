#!/usr/bin/env bash
# Pull tester comments from a fleet test plan for operator review.
# Comments are stored server-side but NEVER sent to the agent's MCP tools
# (the dashboard server strips comment bodies from every LLM-facing
# response). The operator pulls them out here, reviews, and decides what
# to post to the Linear story.
#
# Output: one comment per block, ordered by timestamp ascending, with
# slug + step id + tester + timestamp + body. Markdown-formatted so it
# can be pasted directly into a Linear comment.
#
# Usage:
#   ./scripts/test-plan-comments.sh <slug>            # markdown to stdout
#   ./scripts/test-plan-comments.sh <slug> --json     # raw JSON
set -euo pipefail

SLUG="${1:-}"
FORMAT="${2:---markdown}"
[[ -z "$SLUG" ]] && { echo "usage: $0 <slug> [--markdown|--json]" >&2; exit 2; }
[[ "$SLUG" =~ ^[a-z0-9-]+$ ]] || { echo "invalid slug" >&2; exit 2; }

RL_PROXMOX_HOST="${RL_PROXMOX_HOST:-rl-infra}"
RL_PROXMOX_USER="${RL_PROXMOX_USER:-rl}"

# Read directly from the plan file on the VM. Operator-only path —
# bypasses the dashboard server (which strips bodies for safety).
PLAN_JSON=$(ssh -o BatchMode=yes "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
    "cat /srv/rl-infra/state/test-plans/${SLUG}.json" 2>/dev/null) \
    || { echo "no plan found for slug $SLUG" >&2; exit 1; }

case "$FORMAT" in
    --json)
        echo "$PLAN_JSON" | jq '[.steps[] | {step_id: .id, description, comments: (.comments // [])} | select(.comments | length > 0)]'
        ;;
    --markdown)
        TITLE=$(jq -r '.title // .slug' <<<"$PLAN_JSON")
        TOTAL=$(jq '[.steps[].comments // [] | length] | add // 0' <<<"$PLAN_JSON")
        if (( TOTAL == 0 )); then
            echo "No tester comments on $SLUG."
            exit 0
        fi
        echo "## Tester comments — $TITLE"
        echo
        echo "Pulled $(date -u +%FT%TZ) by operator for review/posting to Linear."
        echo
        jq -r '
            .steps[]
            | select((.comments // []) | length > 0)
            | "### Step \(.id): \(.description)\n" + (
                [.comments[] | "- **\(.tester)** (\(.ts)): \(.body)"]
                | join("\n")
            ) + "\n"
        ' <<<"$PLAN_JSON"
        ;;
    *) echo "unknown format: $FORMAT" >&2; exit 2 ;;
esac
