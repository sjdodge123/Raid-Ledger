# Step 9: Batch Completion + Next Batch

After all stories in a batch are merged (or deferred):

## Dashboard — Mark Batch Complete

```
TaskUpdate(taskId: "<batch-task-id>", status: "completed", subject: "Batch N: <count> stories merged")
```

## 9a. Advisory Agents Update Docs

Before shutting down advisory agents, ask each to update their owned documentation with insights from this batch:

**Architect → update `planning-artifacts/architecture.md`:**
```
SendMessage(type: "message", recipient: "architect",
  content: "DOC_UPDATE: Batch N complete. Update architecture.md with any new patterns, architectural decisions, or tech debt identified during this batch.",
  summary: "Architect doc update")
```

**PM → update `planning-artifacts/prd.md`:**
```
SendMessage(type: "message", recipient: "pm",
  content: "DOC_UPDATE: Batch N complete. Update prd.md if any features changed product behavior.",
  summary: "PM doc update")
```

**Test Engineer → update `TESTING.md` and proactively upgrade test infra:**
```
SendMessage(type: "message", recipient: "test-engineer",
  content: "DOC_UPDATE: Batch N complete. Update TESTING.md with new patterns. Commit any shared test utility upgrades identified during the batch.",
  summary: "Test engineer doc update")
```

Wait for all three to confirm their updates are complete.

## 9b. Shut Down Advisory Agents

```
SendMessage(type: "shutdown_request", recipient: "architect")
SendMessage(type: "shutdown_request", recipient: "pm")
SendMessage(type: "shutdown_request", recipient: "test-engineer")
```

## 9c. Shut Down Remaining Teammates

```
SendMessage(type: "shutdown_request", recipient: "build-agent")
SendMessage(type: "shutdown_request", recipient: "reviewer")
SendMessage(type: "shutdown_request", recipient: "playwright-tester")
```

(Dev + test agents were already shut down in Step 6.)

## 9d. Janitor Post-Batch Cleanup

Run the janitor for post-batch cleanup. See **`steps/step-9b-janitor-post-batch.md`** for full instructions.

**CRITICAL: Before spawning the janitor, verify PR merge status for each story:**
```bash
gh pr view <number> --json state
```
Only tell the janitor a story's PR is "merged" if the state is confirmed `MERGED`. If auto-merge is still pending (state is `OPEN`), either wait for it to merge or tell the janitor to preserve the remote branch.

The janitor will:
- Remove worktrees for all stories in this batch
- Delete local branches for all stories
- Delete remote branches ONLY for confirmed-merged PRs (janitor verifies independently)
- Prune stale remote-tracking references
- Clean up batch stashes
- Report cleanup summary

## 9e. Scrum Master Cost Report

Ask the scrum master for the batch cost summary:
```
SendMessage(type: "message", recipient: "scrum-master",
  content: "COST_REPORT: Batch N summary",
  summary: "Get batch N cost report")
```

## 9f. Next Batch Decision

**Do NOT call TeamDelete yet — sprint planner and scrum master are still needed for Step 10.**

**If more batches remain:**
- **Auto-deploy main** (merged PRs are now on main):
  ```bash
  ./scripts/deploy_dev.sh --rebuild
  ```
- **Pause and present next batch:**
  ```
  ## Batch N complete — N stories merged to main
  Deployed to localhost:5173 for verification.

  ### Scrum Master Cost Summary
  <cost report from scrum master>

  Next batch (N stories):
  - ROK-XXX: <title> — [domains]
  - ROK-YYY: <title> — [domains]

  Say "next" to dispatch the next batch, or "stop" to end dispatch.
  ```
- **WAIT for operator response** before starting the next batch
- On "next" → Go back to Step 5a for the next batch
- On "stop" → Proceed to Step 10

**If all batches done:** Proceed to Step 10
