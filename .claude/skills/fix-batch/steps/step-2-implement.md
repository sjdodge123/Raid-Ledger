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

## 2c. Spike Investigation (Unknown Root Cause Bugs Only)

For any story where `root_cause: unknown`, run an investigation agent **before** spawning the dev agent. This ensures the dev has a clear fix target.

**Skip this step entirely** if all stories have `root_cause: known` or `root_cause: n/a`.

For each unknown-root-cause story, spawn an Explore agent:

```
Agent(subagent_type: "Explore", description: "Spike ROK-<num>",
      prompt: """
      Investigate bug ROK-<num>: <story title>

      ## Symptoms
      <paste story description / symptoms from Linear>

      ## Task
      1. Trace the code path that produces this behavior
      2. Identify the exact root cause (file, function, line if possible)
      3. Propose a fix approach (1-2 sentences)
      4. List any files that will need changes

      Be thorough — check service logic, listeners, processors, and database queries.
      """)
```

Spike agents can run in parallel (they're read-only). When each completes:

1. **Record findings** in state:
   ```yaml
   spike_summary: |
     Root cause: <1-2 sentence explanation>
     Fix location: <file(s) and function(s)>
     Approach: <proposed fix>
   root_cause: known  # upgrade from unknown
   ```

2. **Update the story description in Linear** with the spike findings:
   ```
   mcp__linear__save_issue({
     id: "<linear_id>",
     description: "<original description>\n\n## Spike Findings\n<spike_summary>"
   })
   ```

3. If the spike reveals the story is **full-scope** (contract changes, migrations, 3+ modules), remove it from the batch and recommend `/build`. Update state: `status: "deferred"`.

Once all spikes are complete, proceed to planner step (or dev agents if no stories need planning).

---

## 2c½. Planner Pass (Standard Stories That Need Planning)

For any story where `needs_planner: true`, run a **Plan agent** before spawning the dev agent. This ensures the dev has a clear implementation approach, correct file targets, and test strategy.

**Skip this step entirely** if all stories have `needs_planner: false`.

For each story needing a planner, spawn a Plan agent:

```
Agent(subagent_type: "Plan", description: "Plan ROK-<num>",
      prompt: """
      Plan the implementation for ROK-<num>: <story title>

      ## Story Description
      <paste full story description from Linear>

      ## Spike Findings (if applicable)
      <paste spike_summary if story had unknown root cause, otherwise omit>

      ## Task
      Produce a brief implementation plan covering:
      1. Which files need changes and what changes in each
      2. The order of changes (what depends on what)
      3. Test strategy — which tests to add/modify, what assertions matter
      4. Any gotchas or edge cases the dev should watch for
      5. If the story involves multiple concerns (e.g., backend + frontend), how they connect

      Keep it concise — this is a fix/tech-debt story, not a feature. Focus on the approach, not boilerplate.
      """)
```

Planner agents can run in parallel (they're read-only). When each completes:

1. **Record the plan** in state:
   ```yaml
   plan_summary: |
     <concise implementation plan from planner>
   ```

2. If the planner reveals the story is actually **full-scope**, remove it from the batch and recommend `/build`. Update state: `status: "deferred"`.

Once all planners are complete, proceed to spawn dev agents. The plan summary is included in each dev agent's prompt.

---

## 2d. Create Team and Spawn Dev Agents

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

## 2e. When Dev Completes → Merge into Batch Branch

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

## 2f. Post-Compaction Recovery

If you've just recovered from compaction and state shows stories in `dev_active`:

1. Check which agents are still alive by sending a ping via `SendMessage`
2. If an agent is dead, check the worktree for their commits:
   ```bash
   cd <worktree_path> && git log --oneline -5
   ```
3. If dev committed → merge into batch branch (step 2e)
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
