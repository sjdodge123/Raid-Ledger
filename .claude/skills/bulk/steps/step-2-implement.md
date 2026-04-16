# Step 2: Implement — Batch Branch, Worktrees, Devs, Reviewers, Merge

Lead creates the batch branch, worktrees, spawns devs and reviewers, merges results. Max 2-3 devs in parallel.

---

## 2a. Create Batch Branch

```bash
git fetch origin main
git checkout -b batch/YYYY-MM-DD origin/main
```

---

## 2b. Bring Up Environment (once) and Create Worktrees

**Lead owns Docker. Devs never touch it.**

### Once per batch — start the environment (Lead runs in main repo):

```bash
./scripts/deploy_dev.sh --ci --rebuild
```

Docker, API, web are now running and shared by all worktrees.

### Per story — lightweight worktree setup (Lead runs, not dev):

```bash
git branch batch/rok-<num> batch/YYYY-MM-DD
git worktree add ../Raid-Ledger--rok-<num> batch/rok-<num>
cd ../Raid-Ledger--rok-<num>
npm install
npm run build -w packages/contract
cd -
```

Then verify env files copied into the worktree:
```
mcp__mcp-env__env_check()
```
If any `.env` is missing, call `mcp__mcp-env__env_copy({ file: "<path>" })`.

No Docker restart. Devs inherit a working env.

Update state: `status: "queued"` → `"worktree_ready"`.

---

## 2c. Planner Pass (stories where needs_planner: true)

Skip entirely if all stories have `needs_planner: false`.

For each planner story, spawn a Plan subagent:

```
Agent(subagent_type: "Plan", description: "Plan ROK-<num>",
      prompt: """
Plan the implementation for ROK-<num>: <title>

## Story Description
<paste from Linear>

## Task
Produce a brief plan covering:
1. Files to change and what changes
2. Order of changes (dependencies)
3. Test strategy — which tests, what assertions matter
4. Gotchas or edge cases
5. How concerns connect (e.g., backend + frontend)

Keep it concise — tech-debt/chore/perf story, not a feature.
""")
```

Planners run in parallel (read-only). When each completes:

1. Record in state: `plan_summary: <concise plan>`.
2. If planner reveals full scope → remove from batch, `status: "deferred"`, recommend `/build`.

---

## 2d. Create Team and Spawn Devs

```
TeamCreate({ team_name: "batch-YYYY-MM-DD", description: "Batch for YYYY-MM-DD" })
```

For each story: read `templates/dev-bulk.md`, fill variables, spawn.

```
Task(subagent_type: "general-purpose", team_name: "batch-YYYY-MM-DD",
     name: "dev-rok-<num>", model: "opus", mode: "bypassPermissions",
     prompt: <filled dev-bulk.md>)
```

Up to 2-3 in parallel (single message, multiple Task calls).

Update state: `status: "dev_active"`, `gates.dev: PENDING`.
Pipeline: `next_action: "Devs active: X, Y. On dev completion → spawn per-story reviewer. On reviewer completion → merge. All merged → step-3."`.

---

## 2e. When Dev Completes → Spawn Per-Story Reviewer (parallel)

When a dev messages completion:

1. Verify commit: `cd ../Raid-Ledger--rok-<num> && git log --oneline -3`.
2. Record `dev_commit_sha: <sha>`, `status: "reviewing"`, `gates.dev: PASS`.
3. **Spawn reviewer immediately** (parallel with any still-active devs):

   ```
   Agent(subagent_type: "devedup-rl:reviewer",
         description: "Review ROK-<num>",
         prompt: """
   Review changes on branch batch/rok-<num> compared to origin/main.
   Worktree: ../Raid-Ledger--rok-<num> — stay in this worktree for all reads/edits.

   Story: ROK-<num> — <title>
   Label: <Tech Debt | Chore | Performance>
   Spec + ACs: <paste full Linear issue description>

   Checklist:
   1. Correctness — logic bugs, edge cases, error handling, AC trace end-to-end
   2. Security — injection, auth bypass, data exposure
   3. Performance — N+1, allocations, missing indexes
   4. Contract integrity — shared types changed? consumers updated?
   5. Standards — ESLint, file/function size limits, naming

   Classify findings: [critical], [high], [medium], [low].
   - If BLOCKING issues exist: DO NOT commit auto-fixes. Report all findings so the Lead can respawn the dev with the full list.
   - If only critical/high fixable issues: auto-fix directly in the worktree, run `npx tsc --noEmit` + `npm run lint -w <workspace>` + relevant tests, then commit as `review: auto-fix critical issues (ROK-<num>)`.
   - Report medium/low as tech debt.

   Standing rules: stay in worktree; never push, create PRs, enable auto-merge, force-push, or call `mcp__linear__*` — Lead handles all of that. Do NOT run `deploy_dev.sh`. Output final verdict: APPROVED | APPROVED WITH FIXES | BLOCKED.
   """)
   ```

Update state: `gates.reviewer: PENDING`.

---

## 2f. When Reviewer Completes → Merge into Batch Branch

For each story where reviewer finishes:

1. Check reviewer verdict:
   - **APPROVED / APPROVED WITH FIXES:** `gates.reviewer: PASS`. Continue to merge.
   - **BLOCKED:** respawn dev with blockers. Don't merge yet.
2. Merge into batch branch:
   ```bash
   git checkout batch/YYYY-MM-DD
   git merge --no-ff batch/rok-<num> -m "merge ROK-<num> into batch"
   ```
3. Conflicts:
   - Trivial (whitespace, imports) → Lead resolves.
   - Substantive (logic) → respawn dev with conflict context.
   - Unresolvable → remove from batch, `status: "queued"`, notify operator.
4. Cleanup:
   ```bash
   git worktree remove ../Raid-Ledger--rok-<num>
   git branch -d batch/rok-<num>
   ```
5. State: `status: "merged_to_batch"`, record any tech debt findings for the batch-level TD story.
6. Shutdown dev agent: `SendMessage({ type: "shutdown_request", recipient: "dev-rok-<num>", content: "Work reviewed and merged." })`.

---

## 2g. Post-Compaction Recovery

If state shows `dev_active` or `reviewing`:
1. Ping agents via `SendMessage` to check liveness.
2. Dead → check worktree: `cd <worktree> && git log --oneline -5`.
3. Committed + reviewer gate PENDING → spawn reviewer (2e).
4. Reviewer complete → merge (2f).
5. Not committed → respawn dev.

---

When ALL stories reach `merged_to_batch`, shut down the team and proceed to **Step 3**.

```bash
git log --oneline batch/YYYY-MM-DD ^origin/main  # verify merges
```

Update state:
```yaml
pipeline:
  current_step: "validate"
  next_action: "All merged + reviewed. Read step-3-validate.md."
```
