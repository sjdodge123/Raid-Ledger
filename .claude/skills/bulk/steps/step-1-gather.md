# Step 1: Gather — Cleanup, Fetch, Profile, Present, Init State

**Lead does everything directly. No agents spawned in this step.**

---

## 1a. Quick Workspace Cleanup

```bash
# Prune stale worktrees
git worktree prune
git fetch --prune

# Delete local branches already merged to main
git branch --merged main | grep -v '^\*\|main' | xargs -r git branch -d

# Clean up old batch team/task artifacts
ls ~/.claude/teams/batch-* 2>/dev/null && rm -rf ~/.claude/teams/batch-*
ls ~/.claude/tasks/batch-* 2>/dev/null && rm -rf ~/.claude/tasks/batch-*

# Clean up old batch/* branches (local only)
git branch | grep 'batch/' | xargs -r git branch -d 2>/dev/null
```

If stale worktrees exist from a previous batch, remove them:
```bash
git worktree remove <path> --force  # only if confirmed no in-flight work
```

---

## 1b. Check for In-Flight State

Check if `planning-artifacts/batch-state.yaml` exists:

- **If it doesn't exist:** Fresh batch. Continue to 1c.
- **If it exists:** Read it, then **reconcile against origin before trusting any status.**

### Origin Reconciliation (MANDATORY before resuming)

The state file may be stale from a previous session that shipped stories. Always verify:

```bash
git fetch origin

# For each story in the state file, check if its branch was merged to main:
git branch -r --merged origin/main | grep rok-<num>

# Also check the batch branch itself:
git branch -r --merged origin/main | grep batch/
```

**For each story**, apply this logic in order:

1. **Branch merged to main?** (`git branch -r --merged origin/main | grep rok-<num>`)
   - Yes → story is **done**. Update state: `status: "done"`. Skip it entirely.
2. **Branch exists on origin but not merged?** (`git ls-remote --heads origin rok-<num>`)
   - Yes → check for an existing PR: `gh pr list --head rok-<num>-<short-name> --json state,url`
     - PR merged → story is **done**
     - PR open → resume from ship step
     - No PR → resume from validate step
3. **Branch does NOT exist on origin?**
   - Check worktree for commits → resume from where the state file says

**If the batch branch itself is merged to main:** the entire batch is done. Archive the state file and start fresh.

After reconciliation, update the state file with corrected statuses, then:
  - If all stories are `done` → archive and start fresh
  - If remaining stories are in `dev_active` → skip to Step 2
  - If remaining stories are in `merged_to_batch` → skip to Step 3
  - Present a reconciled summary showing which stories were already shipped vs still in-flight

---

## 1c. Fetch Stories from Linear

Use `mcp__linear__list_issues` to fetch eligible stories. Run queries filtered to dispatchable statuses.

### Primary pool — "Dispatch Ready" status:

```
mcp__linear__list_issues({
  teamId: "0728c19f-5268-4e16-aa45-c944349ce386",
  statusName: "Dispatch Ready",
  first: 20
})
```

Filter results to stories with labels: **Tech Debt**, **Chore**, or **Performance**.

### Secondary pool — "Backlog" status (opt-in):

```
mcp__linear__list_issues({
  teamId: "0728c19f-5268-4e16-aa45-c944349ce386",
  statusName: "Backlog",
  first: 20
})
```

Filter results to stories with labels: **Tech Debt**, **Chore**, or **Performance**.

### If operator specified specific stories (e.g. `ROK-XXX ROK-YYY`):

Fetch just those stories:
```
mcp__linear__get_issue({ issueId: "ROK-XXX" })
mcp__linear__get_issue({ issueId: "ROK-YYY" })
```

Verify fetched stories have an eligible label (Tech Debt, Chore, or Performance). If a story has a Bug or Feature label, flag it and recommend `/build` instead.

### Verify "Chore" label exists

On first run, check that the "Chore" label exists in Linear. If not, create it:
```
mcp__linear__list_issue_labels({ teamId: "0728c19f-5268-4e16-aa45-c944349ce386" })
```
If "Chore" is missing:
```
mcp__linear__create_issue_label({
  teamId: "0728c19f-5268-4e16-aa45-c944349ce386",
  name: "Chore",
  color: "#95A5A6"
})
```

---

## 1d. Profile Stories

For each candidate story, determine:

- **Scope:** light / standard / full (using the decision rules in SKILL.md)
- **Needs planner:** yes / no (see below)
- **Serialization conflicts:** Does it overlap files with other stories in the batch?

**Full-scope stories are NOT eligible.** If a story looks full-scope (contract changes, migrations, 3+ modules), flag it and recommend `/build` instead.

### Planner Assessment

Determine whether each story needs a **planner agent** before the dev agent. The planner produces a brief implementation plan identifying the right approach, file targets, module dependencies, and test strategy.

| Needs planner? | Criteria |
|----------------|----------|
| **yes** | Touches 2+ files across different concerns (e.g., backend + frontend, service + controller + test). Non-obvious architectural decisions (where to persist state, which pattern to use). |
| **no** | Light scope. Single-file change. Change is obvious and self-contained from the story description (e.g., "add a comment", "fix weak assertion", "rename variable"). |

**Rule of thumb:** If a dev agent could reasonably misunderstand the approach or make a wrong architectural call, it needs a planner. When in doubt, plan.

---

## 1e. Present Batch Table

Present a summary table to the operator:

```
## Bulk — <YYYY-MM-DD>

| # | Story | Label | Scope | Planner? | Notes |
|---|-------|-------|-------|----------|-------|
| 1 | ROK-XXX: Title | Tech Debt | standard | yes | Multi-file refactor |
| 2 | ROK-YYY: Title | Chore | light | no | Config cleanup |
| 3 | ROK-ZZZ: Title | Performance | standard | no | Query optimization |

**Flagged (not eligible — recommend /build):**
- ROK-AAA: Title — full scope (contract changes)

Serialization: None (all can run in parallel)
Agents: <count> planner (opus) + <count> dev (opus)
```

**Wait for operator approval.** If the operator approves (e.g., "go", "let's do it", "sounds good"), that IS the confirmation — do not re-ask.

---

## 1f. Initialize State File

Create `planning-artifacts/batch-state.yaml`:

```yaml
pipeline:
  current_step: "implement"
  batch_date: "YYYY-MM-DD"
  batch_branch: "batch/YYYY-MM-DD"
  team_name: "batch-YYYY-MM-DD"
  next_action: |
    Read steps/step-2-implement.md. Create batch branch, worktrees, and spawn dev agents.
  gates:
    review: PENDING
    test_gaps: PENDING
    integration: PENDING
    ci: PENDING
    smoke: PENDING
    pr: PENDING
  stories:
    ROK-XXX:
      title: "Story title"
      linear_id: "<uuid from Linear>"
      label: "Tech Debt"
      scope: standard
      needs_planner: true
      status: "queued"
      branch: "batch/rok-xxx"
      worktree: "../Raid-Ledger--rok-xxx"
      dev_commit_sha: null
      plan_summary: null   # filled by planner agent if needs_planner is true
      next_action: "Queued. Waiting for worktree creation in Step 2."
```

---

## 1g. Update Linear to "In Progress"

**MANDATORY — do this NOW before proceeding to Step 2.**

Move every story in the batch to "In Progress":

```
mcp__linear__save_issue({
  issueId: "<linear_id>",
  statusName: "In Progress"
})
```

This ensures Linear reflects that work has started as soon as the batch is confirmed, not after validation in Step 3.

Proceed to **Step 2**.
