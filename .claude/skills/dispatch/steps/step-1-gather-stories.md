# Step 1: Check In-Flight Work & Gather Stories

**In-flight work takes priority over new stories.** Always check what's already in progress and finish it first.

---

## Phase 1: Check In-Flight Work

Fetch all in-flight stories in parallel:
```
mcp__linear__list_issues(project: "Raid Ledger", state: "In Progress")
mcp__linear__list_issues(project: "Raid Ledger", state: "In Review")
mcp__linear__list_issues(project: "Raid Ledger", state: "Code Review")
mcp__linear__list_issues(project: "Raid Ledger", state: "Changes Requested")
```

### Present In-Flight Dashboard

```
## In-Flight Status

### In Progress (dev agents implementing)
| Story | Title | Assignee | Updated |
|-------|-------|----------|---------|
| ROK-XXX | <title> | <agent/person> | <relative time> |

### In Review (waiting for operator testing)
| Story | Title | Updated |
|-------|-------|---------|
| ROK-XXX | <title> | <relative time> |

### Code Review (operator approved, awaiting code review)
| Story | Title | Updated |
|-------|-------|---------|
| ROK-XXX | <title> | <relative time> |

### Changes Requested (needs rework)
| Story | Title | Feedback Summary | Updated |
|-------|-------|-----------------|---------|
| ROK-XXX | <title> | <1-line summary> | <relative time> |
```

### Resume In-Flight Work

If ANY in-flight stories exist, **suggest finishing them first** and route to the appropriate step to pick up where they left off:

- **"In Progress"**: Dev agents should still be working. Check if worktrees and agents are still active. If stale (no commits in >2 hours), suggest re-spawning dev agents to continue. Resume from **Step 5** (re-create the team and re-spawn agents in existing worktrees).
- **"In Review"**: Waiting on operator testing. **Immediately build and run the feature branch locally** so the operator can test — do NOT wait to be asked. Use `deploy_dev.sh --branch <branch-name> --rebuild` to switch the local dev environment to that branch, and tell the operator which other branches are available. Resume from **Step 7a** (poll for operator results).
- **"Code Review"**: Operator approved, needs reviewer. Resume from **Step 7c** (spawn review agents).
- **"Changes Requested"**: Needs rework. Resume from **Step 7b** (handle changes requested — re-spawn dev agents with feedback).

Present the recommendation to the operator:
```
## Recommendation: Finish In-Flight Work First

N stories are still in progress. I recommend we finalize these before picking up new work:

- ROK-XXX (<status>) — <what needs to happen next>
- ROK-YYY (<status>) — <what needs to happen next>

<if any "In Review" stories exist>
Building ROK-XXX locally (rok-<num>-<short-name>) for testing now...
Other branches available: deploy_dev.sh --branch <other-branch>
</if>

Say "resume" to pick up in-flight work, or "new" to skip to new stories.
```

**IMPORTANT: If "In Review" stories exist, build and run the first one locally IMMEDIATELY — don't wait for the operator to respond.** The operator needs a running app at localhost:5173 to test against. Start the local build while presenting the dashboard.

If the operator says "resume" (or equivalent), jump to the appropriate step for each story. If they say "new", proceed to Phase 2.

---

## Phase 2: Gather New Stories

Route based on `$ARGUMENTS`:

- **`ROK-XXX`** (specific story ID) — fetch that single issue, regardless of status
- **`rework`** — fetch only "Changes Requested" stories (from Phase 1 results)
- **`todo`** — fetch only "Dispatch Ready" stories
- **`all`** or **no arguments** — fetch both "Dispatch Ready" AND "Changes Requested" stories

```
mcp__linear__list_issues(project: "Raid Ledger", state: "Dispatch Ready")
```

Note: "Changes Requested" stories were already fetched in Phase 1. Reuse those results — do not re-fetch.

Combine results into a single list grouped by type:
- **Rework** = Changes Requested items (need review feedback)
- **New Work** = Dispatch Ready items (need full implementation)

If no stories found in either category, report "No dispatchable stories" and stop.
