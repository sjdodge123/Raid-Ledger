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

# Clean up old fix-batch team/task artifacts
ls ~/.claude/teams/fix-batch-* 2>/dev/null && rm -rf ~/.claude/teams/fix-batch-*
ls ~/.claude/tasks/fix-batch-* 2>/dev/null && rm -rf ~/.claude/tasks/fix-batch-*

# Clean up old fix/batch-* branches (local only)
git branch | grep 'fix/batch-' | xargs -r git branch -d 2>/dev/null
git branch | grep 'fix/rok-' | xargs -r git branch -d 2>/dev/null
```

If stale worktrees exist from a previous fix-batch, remove them:
```bash
git worktree remove <path> --force  # only if confirmed no in-flight work
```

---

## 1b. Check for In-Flight State

Check if `planning-artifacts/fix-batch-state.yaml` exists:

- **If it exists:** Read it. Check `pipeline.next_action`. You may be resuming in-flight work.
  - If stories are in `dev_active` → skip to Step 2 (check agent status)
  - If stories are in `merged_to_batch` → skip to Step 3
  - If all stories are `done` → archive and start fresh
- **If it doesn't exist:** Fresh batch. Continue to 1c.

---

## 1c. Fetch Stories from Linear

Use `mcp__linear__list_issues` to fetch eligible stories. Run three queries by label, filtered to dispatchable statuses.

### Primary pool — "Dispatch Ready" status:

```
mcp__linear__list_issues({
  teamId: "0728c19f-5268-4e16-aa45-c944349ce386",
  statusName: "Dispatch Ready",
  first: 20
})
```

Filter results to stories with labels: **Bug**, **Tech Debt**, **Chore**, or **Performance**.

### Secondary pool — "Backlog" status (opt-in):

```
mcp__linear__list_issues({
  teamId: "0728c19f-5268-4e16-aa45-c944349ce386",
  statusName: "Backlog",
  first: 20
})
```

Filter results to stories with labels: **Bug**, **Tech Debt**, **Chore**, or **Performance**.

### If operator specified specific stories (e.g. `ROK-XXX ROK-YYY`):

Fetch just those stories:
```
mcp__linear__get_issue({ issueId: "ROK-XXX" })
mcp__linear__get_issue({ issueId: "ROK-YYY" })
```

### Verify "Chore" and "Performance" labels exist

On first run, check that the "Chore" and "Performance" labels exist in Linear. If not, create them:
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
If "Performance" is missing:
```
mcp__linear__create_issue_label({
  teamId: "0728c19f-5268-4e16-aa45-c944349ce386",
  name: "Performance",
  color: "#F2994A"
})
```

---

## 1d. Profile Stories

For each candidate story, determine:

- **Scope:** light / standard / full (using the decision rules in SKILL.md)
- **Serialization conflicts:** Does it overlap files with other stories in the batch?

**Full-scope stories are NOT eligible.** If a story looks full-scope (contract changes, migrations, 3+ modules), flag it and recommend `/build` instead.

---

## 1e. Present Batch Table

Present a summary table to the operator:

```
## Fix Batch — <YYYY-MM-DD>

| # | Story | Label | Scope | Notes |
|---|-------|-------|-------|-------|
| 1 | ROK-XXX: Title | Bug | standard | Single module |
| 2 | ROK-YYY: Title | Tech Debt | light | Style cleanup |

**Flagged (not eligible — recommend /build):**
- ROK-ZZZ: Title — full scope (contract changes)

Serialization: None (all can run in parallel)
Agents: <count> dev (opus)
```

**Wait for operator approval.** If the operator approves (e.g., "go", "let's do it", "sounds good"), that IS the confirmation — do not re-ask.

---

## 1f. Initialize State File

Create `planning-artifacts/fix-batch-state.yaml`:

```yaml
pipeline:
  current_step: "implement"
  batch_date: "YYYY-MM-DD"
  batch_branch: "fix/batch-YYYY-MM-DD"
  team_name: "fix-batch-YYYY-MM-DD"
  next_action: |
    Read steps/step-2-implement.md. Create batch branch, worktrees, and spawn dev agents.
  gates:
    integration: PENDING
    ci: PENDING
    smoke: PENDING
    pr: PENDING
  stories:
    ROK-XXX:
      title: "Story title"
      linear_id: "<uuid from Linear>"
      label: "Bug"
      scope: standard
      status: "queued"
      branch: "fix/rok-xxx"
      worktree: "../Raid-Ledger--rok-xxx"
      dev_commit_sha: null
      next_action: "Queued. Waiting for worktree creation in Step 2."
```

Proceed to **Step 2**.
