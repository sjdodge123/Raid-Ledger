# Step 1: Gather — Cleanup, Fetch, Profile, Present, Init State

Lead does everything. No agents spawned.

---

## 1a. Quick Workspace Cleanup

```bash
git worktree prune
git fetch --prune
git branch --merged main | grep -v '^\*\|main' | xargs -r git branch -d

# Old batch artifacts
ls ~/.claude/teams/batch-* 2>/dev/null && rm -rf ~/.claude/teams/batch-*
ls ~/.claude/tasks/batch-* 2>/dev/null && rm -rf ~/.claude/tasks/batch-*

# Old local batch/* branches
git branch | grep 'batch/' | xargs -r git branch -d 2>/dev/null
```

Remove stale worktrees (only if no in-flight work): `git worktree remove <path> --force`.

---

## 1b. Check for In-Flight State

If `planning-artifacts/batch-state.yaml` exists, reconcile against origin before trusting status.

```
mcp__mcp-env__story_status({ stories: ["ROK-XXX", "ROK-YYY"] })
```

Also: `git branch -r --merged origin/main | grep batch/`. If the batch branch itself merged to main, the batch is done — archive and start fresh.

Verdicts:
- `done` → `status: "done"`, skip.
- `in_flight` → check PR state (`gh pr list --head rok-<num>-<short-name> --json state,url`):
  - PR merged → done; PR open → resume from ship; no PR → resume from validate.
- Branch not on origin → check worktree for commits → resume from state file.

After reconciliation:
- All done → archive, start fresh.
- Remaining in `dev_active` → Step 2.
- Remaining in `merged_to_batch` → Step 3.
- Present reconciled summary (shipped vs in-flight).

---

## 1c. Fetch Stories from Linear

**Cycle-first ordering.** Linear auto-rolls incomplete cycle issues forward, so anything sitting in the current cycle is already on the operator's "this week" radar. Drain the cycle before reaching into the wider backlog.

### Pool A — current cycle (PRIMARY)

```
mcp__linear__list_issues({ teamId: "0728c19f-5268-4e16-aa45-c944349ce386", cycle: "current", limit: 30 })
```

Filter results to labels: **Tech Debt**, **Chore**, or **Performance**, AND state != Done/Cancelled. This is the preferred pool — start here every run.

### Pool B — Dispatch Ready outside the cycle (FALLBACK)

Only if Pool A is empty or has fewer than the operator's requested batch size:

```
mcp__linear__list_issues({ teamId: "0728c19f-5268-4e16-aa45-c944349ce386", state: "Dispatch Ready", limit: 20 })
```

Same label filter (Tech Debt / Chore / Performance). Skip stories already returned by Pool A.

### Pool C — Backlog (LAST RESORT, opt-in)

```
mcp__linear__list_issues({ teamId: "0728c19f-5268-4e16-aa45-c944349ce386", state: "Backlog", limit: 20 })
```

Only when operator explicitly says "go wider" or both A + B are empty. Same label filter.

### Specific story IDs

For specific stories named by the operator: `mcp__linear__get_issue({ id: "ROK-XXX" })` per ID. Verify label is eligible — if Bug/Feature, flag and recommend `/build`. Cycle membership is informational only when the operator named the IDs.

### Presentation

When presenting the batch (1e), tag each story's source pool: `[cycle]`, `[ready]`, or `[backlog]`. Operator should see at a glance whether they're draining the cycle or reaching past it.

### Verify "Chore" label exists (first run only)

```
mcp__linear__list_issue_labels({ teamId: "0728c19f-5268-4e16-aa45-c944349ce386" })
```

If missing:
```
mcp__linear__create_issue_label({ teamId: "0728c19f-5268-4e16-aa45-c944349ce386", name: "Chore", color: "#95A5A6" })
```

---

## 1d. Profile Stories

Per story: scope (light/standard/full per SKILL.md), `needs_planner`, serialization conflicts.

**Full scope not eligible.** Contract changes, migrations, 3+ modules → flag, recommend `/build`.

### Planner Assessment

| Needs planner? | Criteria |
|----------------|----------|
| yes | 2+ files across concerns (backend + frontend, service + controller + test); non-obvious architectural decisions |
| no | Light scope; single-file; obvious and self-contained from description |

When in doubt, plan.

---

## 1e. Present Batch to Operator

```
## Bulk — YYYY-MM-DD

| # | Story | Pool | Label | Scope | Planner? | Notes |
|---|-------|------|-------|-------|----------|-------|

`Pool` is `cycle` / `ready` / `backlog` per 1c.

**Flagged (not eligible — recommend /build):**
- ROK-AAA: Title — <reason>

Serialization: <describe>
Agents: N planner + N dev (all opus)
```

Wait for operator approval. "go" / "let's do it" IS the confirmation — don't re-ask.

---

## 1f. Initialize State File

Write `planning-artifacts/batch-state.yaml`:

```yaml
pipeline:
  current_step: "implement"
  batch_date: "YYYY-MM-DD"
  batch_branch: "batch/YYYY-MM-DD"
  team_name: "batch-YYYY-MM-DD"
  next_action: "Read step-2-implement.md. Create batch branch, worktrees, spawn devs."
  gates:
    test_gaps: PENDING
    integration: PENDING
    ci: PENDING
    smoke: PENDING
  stories:
    ROK-XXX:
      title: "..."
      linear_id: "<uuid>"
      label: "Tech Debt"  # Tech Debt | Chore | Performance
      scope: standard
      needs_planner: true
      status: "queued"
      branch: "batch/rok-xxx"
      worktree: "../Raid-Ledger--rok-xxx"
      dev_commit_sha: null
      plan_summary: null  # filled by planner if needs_planner
      gates:
        dev: PENDING
        reviewer: PENDING
      next_action: "Queued."
```

---

## 1g. Update Linear to "In Progress"

Mandatory before Step 2. For each story:
```
mcp__linear__save_issue({ issueId: "<linear_id>", statusName: "In Progress" })
```

Proceed to **Step 2**.
