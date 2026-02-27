# Step 2: Implement — Batch Branch, Worktrees, Dev Agents, Merge

**Lead creates the batch branch, worktrees, spawns dev agents, and merges results. Max 2-3 dev agents in parallel.**

---

## 2a. Create Batch Branch

```bash
git fetch origin main
git checkout -b fix/batch-YYYY-MM-DD origin/main
```

Replace `YYYY-MM-DD` with the actual date from the state file.

---

## 2b. Create Worktrees

For each story in the batch:

```bash
# Create story branch from batch branch
git branch fix/rok-<num> fix/batch-YYYY-MM-DD

# Create worktree
git worktree add ../Raid-Ledger--rok-<num> fix/rok-<num>

# Copy env files (gitignored, needed for builds)
cp .env ../Raid-Ledger--rok-<num>/
cp api/.env ../Raid-Ledger--rok-<num>/api/

# Install dependencies
cd ../Raid-Ledger--rok-<num> && npm install && cd -

# Viability check — ensure the worktree builds clean
npx tsc --noEmit -p ../Raid-Ledger--rok-<num>/api/tsconfig.json
npx tsc --noEmit -p ../Raid-Ledger--rok-<num>/web/tsconfig.json
```

Update state for each story: `status: "queued"` → `"worktree_ready"`

---

## 2c. Create Team and Spawn Dev Agents

```
TeamCreate({ team_name: "fix-batch-YYYY-MM-DD", description: "Fix batch for YYYY-MM-DD" })
```

For each story, read `templates/dev-fix.md`, fill in the template variables, and spawn:

```
Task(subagent_type: "general-purpose", team_name: "fix-batch-YYYY-MM-DD",
     name: "dev-rok-<num>", model: "opus", mode: "bypassPermissions",
     prompt: <filled dev-fix.md>)
```

Spawn up to 2-3 devs in parallel (use a single message with multiple Task tool calls).

Update state for each story:
```yaml
status: "dev_active"
next_action: "dev-rok-<num> active. Wait for completion message."
```

Update pipeline:
```yaml
pipeline.next_action: |
  Dev agents active: dev-rok-XXX, dev-rok-YYY.
  When each dev completes: merge into batch branch.
  When all stories merged: read steps/step-3-validate.md.
```

---

## 2d. When Dev Completes → Merge into Batch Branch

When a dev agent messages completion:

1. **Verify the work** — check commit exists in the worktree:
   ```bash
   cd ../Raid-Ledger--rok-<num> && git log --oneline -3
   ```

2. **Record the commit SHA** in state: `dev_commit_sha: "<sha>"`

3. **Merge into batch branch:**
   ```bash
   # Switch to batch branch in main worktree
   git checkout fix/batch-YYYY-MM-DD

   # Merge the story branch
   git merge --no-ff fix/rok-<num> -m "fix: merge ROK-<num> into batch"
   ```

4. **Handle merge conflicts:**
   - **Trivial** (whitespace, imports): Lead resolves directly
   - **Substantive** (logic conflicts): Re-spawn dev with conflict context
   - **Unresolvable**: Remove story from batch, update state to `queued`, notify operator

5. **Cleanup story worktree + branch:**
   ```bash
   git worktree remove ../Raid-Ledger--rok-<num>
   git branch -d fix/rok-<num>
   ```

6. **Update state:**
   ```yaml
   status: "merged_to_batch"
   next_action: "Merged into batch branch. Waiting for validation."
   ```

7. **Shut down the dev agent:**
   ```
   SendMessage({ type: "shutdown_request", recipient: "dev-rok-<num>",
                  content: "Work merged. Shutting down." })
   ```

---

## 2e. Post-Compaction Recovery

If you've just recovered from compaction and state shows stories in `dev_active`:

1. Check which agents are still alive by sending a ping via `SendMessage`
2. If an agent is dead, check the worktree for their commits:
   ```bash
   cd <worktree_path> && git log --oneline -5
   ```
3. If dev committed → merge into batch branch (step 2d)
4. If dev didn't commit → re-spawn dev (the worktree has their partial work)

---

## Proceed

When ALL stories in the batch reach `merged_to_batch`, shut down the team and proceed to **Step 3**.

```bash
# Verify batch branch has all merges
git log --oneline fix/batch-YYYY-MM-DD ^origin/main
```

Update state:
```yaml
pipeline:
  current_step: "validate"
  next_action: |
    All stories merged into batch branch. Read steps/step-3-validate.md.
    Run full validation suite on the batch branch.
```
