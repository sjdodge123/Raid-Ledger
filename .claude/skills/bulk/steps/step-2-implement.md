# Step 2: Implement — Agent Team, Shared Task List, Self-Claim, Direct Reviewer Messaging

Lead creates the batch branch, worktrees, and an Agent Team. Devs and reviewers run as **teammates** inside that team — they self-claim tasks from a shared list and coordinate directly via `SendMessage` (no Lead middleman for auto-fix loops). Max 2–3 dev teammates in parallel.

**Prerequisite:** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in `~/.claude/settings.json`. Only one team can exist per session — if `/build` or a previous `/bulk` run left a team in place, clean it up before starting.

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

Planners remain **one-shot `Agent()` subagents** (read-only, no coordination needed — they don't become teammates):

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

Planners run in parallel. When each completes:

1. Record in state: `plan_summary: <concise plan>`.
2. If planner reveals full scope → remove from batch, `status: "deferred"`, recommend `/build`.

---

## 2d. Create the Agent Team

```
TeamCreate({ team_name: "batch-YYYY-MM-DD", description: "Bulk batch YYYY-MM-DD — parallel devs + reviewers" })
```

The team's shared task list and mailbox live at `~/.claude/teams/batch-YYYY-MM-DD/` and `~/.claude/tasks/batch-YYYY-MM-DD/`.

---

## 2e. Post Dev Tasks to the Shared List

For each story, read `templates/dev-bulk.md`, splice in the story-specific details, and post a task. Teammates will self-claim.

```
TaskCreate({
  subject: "ROK-<num>: dev",
  description: """
<entire filled-in contents of templates/dev-bulk.md, with:>
  - ROK story title + label
  - Spec + ACs pasted from Linear
  - WORKTREE_PATH: ../Raid-Ledger--rok-<num>
  - Branch: batch/rok-<num>
  - plan_summary (if a planner ran)
""",
  metadata: {
    role: "dev",
    story: "ROK-<num>",
    worktree: "../Raid-Ledger--rok-<num>",
    branch: "batch/rok-<num>"
  }
})
```

Tasks start `pending`, unowned. Update state: `status: "queued_for_claim"` for each story.

---

## 2f. Spawn Dev Teammates

Spawn N generic dev teammates (N = batch size, 2–3). The spawn prompt is thin — real task details live in the shared task descriptions.

```
Agent(
  subagent_type: "general-purpose",
  team_name: "batch-YYYY-MM-DD",
  name: "dev-rok-<num>",
  model: "opus",
  mode: "bypassPermissions",
  prompt: """
You are a dev teammate for Raid Ledger (bulk pipeline).

1. TaskList to find a pending task with metadata.role == "dev" and no owner.
2. Follow the workflow in .claude/skills/bulk/templates/dev-bulk.md verbatim.
3. Claim exactly one task (TaskUpdate owner=<your name>, status=in_progress).
4. The task description contains your worktree path, branch, spec, and ACs. Read it fully before coding.
5. When done, TaskUpdate status=completed, then SendMessage to the Lead with summary.
6. A reviewer teammate will spawn after you complete — coordinate with them directly via SendMessage.

Standing rules: stay in your claimed worktree; never push/PR/auto-merge/force-push/mcp__linear__*/deploy_dev.sh.
"""
)
```

Spawn in parallel (single message, multiple `Agent` calls) — up to 2–3. The `name` is the address other teammates use to reach this dev via `SendMessage`.

Update state: `status: "dev_active"`, `gates.dev: PENDING` per story.
Pipeline: `next_action: "Team active. Devs self-claiming dev tasks. On dev idle → post review task + spawn reviewer. On reviewer idle → merge. All merged → step-3."`.

---

## 2g. Dev Idle → Post Review Task + Spawn Reviewer

When a dev teammate marks its task `completed` **and** sends a completion message, the Lead receives an idle notification automatically. Do NOT poll for agent state.

On idle:

1. **Verify commit** — `cd ../Raid-Ledger--rok-<num> && git log --oneline -3`.
2. **Record state** — `dev_commit_sha: <sha>`, `status: "reviewing"`, `gates.dev: PASS`.
3. **Post a review task** — read `templates/reviewer-bulk.md`, fill in, `TaskCreate`:

   ```
   TaskCreate({
     subject: "ROK-<num>: review",
     description: """
   <entire filled-in contents of templates/reviewer-bulk.md, with:>
     - ROK story + label
     - Spec + ACs (same paste as the dev task)
     - WORKTREE_PATH: ../Raid-Ledger--rok-<num>
     - Branch: batch/rok-<num>
     - Dev teammate name: dev-rok-<num>   ← the reviewer uses this for SendMessage fix loops
     - Dev commit SHA: <sha>
   """,
     metadata: {
       role: "reviewer",
       story: "ROK-<num>",
       worktree: "../Raid-Ledger--rok-<num>",
       branch: "batch/rok-<num>",
       dev_teammate: "dev-rok-<num>"
     }
   })
   ```

4. **Spawn reviewer teammate** — thin spawn prompt, same pattern as 2f:

   ```
   Agent(
     subagent_type: "general-purpose",
     team_name: "batch-YYYY-MM-DD",
     name: "reviewer-rok-<num>",
     model: "opus",
     mode: "bypassPermissions",
     prompt: """
   You are a reviewer teammate for Raid Ledger (bulk pipeline).

   1. TaskList to find a pending task with metadata.role == "reviewer" and metadata.story == "ROK-<num>".
   2. Follow the workflow in .claude/skills/bulk/templates/reviewer-bulk.md verbatim.
   3. Claim the task (TaskUpdate owner=<your name>, status=in_progress).
   4. Review the branch in the worktree. For critical/high FIXABLE issues, prefer SendMessage to the dev teammate (dev-rok-<num>) rather than self-fixing.
   5. When done, TaskUpdate status=completed, then SendMessage the Lead with verdict + findings.

   Standing rules: stay in worktree; never push/PR/auto-merge/force-push/mcp__linear__*/deploy_dev.sh.
   """
   )
   ```

Update state: `gates.reviewer: PENDING`.

Devs and reviewers now coordinate auto-fix loops directly via `SendMessage`. The Lead is not involved until the reviewer idles with a final verdict.

---

## 2h. Reviewer Idle → Merge into Batch Branch

When a reviewer teammate marks its task `completed` and sends a verdict message, the Lead receives an idle notification.

1. **Parse the verdict** from the reviewer's message:
   - **APPROVED / APPROVED WITH FIXES** → `gates.reviewer: PASS`. Continue to merge.
   - **BLOCKED** → do NOT merge. Post a fresh dev task with the blocking list:
     ```
     TaskCreate({
       subject: "ROK-<num>: dev (rework)",
       description: "<filled dev-bulk.md with blocking findings appended>",
       metadata: { role: "dev", story: "ROK-<num>", ... }
     })
     ```
     The dev teammate (still alive) self-claims it. Reviewer teammate can stay alive for the re-review, or be shut down and a fresh reviewer spawned when the new dev task completes.

2. **Merge into batch branch:**
   ```bash
   git checkout batch/YYYY-MM-DD
   git merge --no-ff batch/rok-<num> -m "merge ROK-<num> into batch"
   ```

3. **Conflicts:**
   - Trivial (whitespace, imports) → Lead resolves inline.
   - Substantive (logic) → post a fresh dev task with conflict context; dev teammate resolves.
   - Unresolvable → remove from batch, `status: "queued"`, notify operator.

4. **Cleanup:**
   ```bash
   git worktree remove ../Raid-Ledger--rok-<num>
   git branch -d batch/rok-<num>
   ```

5. **State:** `status: "merged_to_batch"`, record tech-debt findings for the batch-level TD story.

6. **Shut down the teammates** for this story:
   ```
   SendMessage({ to: "dev-rok-<num>", message: { type: "shutdown_request", reason: "merged" } })
   SendMessage({ to: "reviewer-rok-<num>", message: { type: "shutdown_request", reason: "merged" } })
   ```

---

## 2i. Post-Compaction / Session Recovery

**Important Agent Teams limitation:** in-process teammates do **not** survive `/resume` or `/rewind`. The shared task list and team config on disk survive, but the running teammate processes are gone. If the Lead attempts to message a teammate that no longer exists, it fails silently.

If state shows `dev_active`, `reviewing`, or `queued_for_claim` and you suspect the session was resumed:

1. **Check team state on disk** — `ls ~/.claude/teams/batch-YYYY-MM-DD/` — does the team still exist?
2. **List orphaned tasks** — any task with `status: "in_progress"` whose owner's teammate no longer exists is orphaned.
3. **Unclaim orphans** — `TaskUpdate({ owner: null, status: "pending" })` on each orphaned task.
4. **Re-spawn missing teammates** — if the team itself was deleted, `TeamCreate` again. Then re-run 2f (and 2g for any stories already in review) to spawn fresh teammates. They self-claim the unowned tasks and continue.
5. **Reconcile with worktrees** — for stories already committed in the worktree (`git log --oneline -5` shows the fix commit), the fresh dev teammate's task should reflect "already implemented — just mark completed and notify Lead" in its description, to avoid re-doing work.

`batch-state.yaml` remains the source of truth across compactions — the team is ephemeral, the state file persists.

---

## 2j. Transition to Step 3

When ALL stories reach `merged_to_batch`:

```bash
git log --oneline batch/YYYY-MM-DD ^origin/main  # verify merges
```

The team is still alive at this point — we keep it around through Step 3 in case a batch-level validation failure traces back to a specific story and we need to post a new dev task. Final team cleanup happens in Step 4 after the PR merges.

Update state:
```yaml
pipeline:
  current_step: "validate"
  next_action: "All merged + reviewed. Read step-3-validate.md."
```
