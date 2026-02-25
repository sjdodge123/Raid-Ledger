# Step 9b: Janitor Post-Batch Cleanup

**After advisory agents update their docs in Step 9, re-spawn the janitor to clean up batch artifacts.**

---

## Re-Spawn Janitor

```
Task(subagent_type: "general-purpose",
     name: "janitor-post-batch", model: "sonnet", mode: "bypassPermissions",
     prompt: <read templates/janitor.md — specify POST-BATCH mode and provide the list of stories from this batch>)
```

Include in the prompt:
- List of stories from this batch (ROK-XXX, ROK-YYY, etc.)
- Their branch names (rok-xxx-short-name, rok-yyy-short-name)
- PR numbers for each story (or "no PR" for cancelled stories)

**CRITICAL: Do NOT tell the janitor a PR is merged unless you have confirmed it via `gh pr view <num> --json state`.** If auto-merge is still pending, the PR is NOT merged yet.

## Janitor Post-Batch Tasks

The janitor will:

1. **Remove worktrees** for all stories in this batch:
   ```bash
   git worktree remove ../Raid-Ledger--rok-<num> --force
   ```

2. **Delete local branches:**
   ```bash
   git branch -D rok-<num>-<short-name>
   ```

3. **Verify PR merge status BEFORE deleting remote branches (MANDATORY):**
   ```bash
   gh pr list --head rok-<num>-<short-name> --state merged --json number
   ```
   - If PR is confirmed MERGED → delete remote branch
   - If PR is still OPEN or pending auto-merge → **DO NOT delete**, report to lead
   - For cancelled stories (no PR) → safe to delete remote branch

4. **Prune remote-tracking references:**
   ```bash
   git fetch --prune
   ```

5. **Clean batch stashes** — drop any stashes created during this batch

6. **Report cleanup summary** to the lead

## Wait for Completion

Wait for the janitor to message back with the cleanup report.

## Scrum Master Checkpoint

After janitor completes:
```
SendMessage(type: "message", recipient: "scrum-master",
  content: "CHECKPOINT: { step: 'step-9b', event: 'janitor_post_batch_complete' }",
  summary: "Janitor post-batch done")
```

The scrum master confirms batch is complete and advises: "Proceed to next batch (Step 5) or final summary (Step 10)."

## Proceed

- If more batches remain → go back to **Step 5** for the next batch
- If all batches done → proceed to **Step 10** (with Step 10b sprint sync-up first)
