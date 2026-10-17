# Step 1: Check In-Flight Work & Gather Stories

**In-flight work takes priority over new stories.** Always check what's already in progress and finish it first.

**Data source:** `planning-artifacts/sprint-status.yaml` (populated by Sprint Planner in Step 0b). The lead reads this file directly — do NOT call `mcp__linear__*` tools.

---

## Phase 1: Check In-Flight Work

Read the Sprint Planner's local cache to find in-flight stories:

```bash
cat planning-artifacts/sprint-status.yaml
```

Filter for stories in these states:
- **In Progress** — dev agents implementing
- **In Review** — waiting for operator testing
- **Code Review** — operator approved, awaiting code review
- **Changes Requested** — needs rework

### Present In-Flight Dashboard

```
## In-Flight Status

### In Progress (dev agents implementing)
| Story | Title | Updated |
|-------|-------|---------|
| ROK-XXX | <title> | <relative time> |

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

If ANY in-flight stories exist, **suggest finishing them first** and route to the appropriate step:

- **"In Progress"**: Check if worktrees and agents are still active. If stale (no commits in >2 hours), suggest re-spawning dev agents. Resume from **Step 5** (re-create team, re-spawn agents in existing worktrees).
- **"In Review"**: Waiting on operator testing. **Immediately build and run the feature branch locally** so the operator can test — do NOT wait to be asked. Use `deploy_dev.sh --branch <branch-name> --rebuild`. Resume from **Step 7a** (poll for operator results).
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

**IMPORTANT: If "In Review" stories exist, build and run the first one locally IMMEDIATELY — don't wait for the operator to respond.** The operator needs a running app at localhost:5173 to test against.

If the operator says "resume" (or equivalent), jump to the appropriate step. If they say "new", proceed to Phase 2.

---

## Phase 2: Gather New Stories

Route based on `$ARGUMENTS`:

- **`ROK-XXX`** (specific story ID) — look up that story in the cache, regardless of status
- **`rework`** — filter cache for "Changes Requested" stories only
- **`todo`** — filter cache for "Dispatch Ready" stories only
- **`all`** or **no arguments** — include both "Dispatch Ready" AND "Changes Requested" stories

All data comes from the Sprint Planner cache. No Linear API calls.

Combine results into a single list grouped by type:
- **Rework** = Changes Requested items (need review feedback)
- **New Work** = Dispatch Ready items (need full implementation)

If no stories found in either category, report "No dispatchable stories" and stop.
