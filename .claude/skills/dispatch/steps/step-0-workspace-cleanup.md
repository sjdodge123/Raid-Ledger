# Step 0: Workspace Cleanup

**Run this FIRST before anything else.**

---

## Phase 1: Spawn the Janitor

Read `templates/janitor.md` and spawn the Janitor agent with task type **Pre-Dispatch Cleanup**.

The Janitor handles everything autonomously:
- Worktree inventory, classification, and removal
- Orphaned directory cleanup
- Branch cleanup (merged local, stale remote-tracking)
- Remote branch deletion (only for confirmed-merged stories)
- Stale stash cleanup
- `.playwright-mcp/` screenshot cleanup
- Docker container cleanup
- Team/task artifact cleanup (`~/.claude/teams/dispatch-batch-*`, `~/.claude/tasks/dispatch-batch-*`)
- Zombie process cleanup (orphaned API/web processes)

**The Janitor does NOT call Linear.** It reports any Linear updates needed (stories stuck in wrong status) back to the lead. The lead routes those through the Sprint Planner in Step 0b.

Wait for the Janitor's cleanup report before proceeding.

---

## Phase 2: Spawn the Scrum Master

Read `templates/scrum-master.md` and spawn the Scrum Master.

The Scrum Master is a **long-lived advisory agent** that persists for the entire dispatch. It:
- Guards the pipeline gate order (SKILL.md is the law)
- Validates Orchestrator decisions before the lead executes
- Tracks token costs
- Catches process drift (especially after context compaction)

**The Scrum Master is MANDATORY.** It was missed in the trial run, which caused process drift and skipped gates.

Send the Scrum Master the Janitor's cleanup report as its first status update.

---

## Phase 3: Review & Proceed

Review the Janitor's report:
- **Linear updates needed** → these will be routed through the Sprint Planner in Step 0b
- **Preserved in-flight work** → Step 1 will evaluate these against Linear status
- **Workspace state** → must be CLEAN before proceeding

If the workspace is clean, proceed to **Step 0b** (Sprint Planner sync-down).
