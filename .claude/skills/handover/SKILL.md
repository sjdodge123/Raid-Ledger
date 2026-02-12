---
name: handover
description: End-of-session handover — sync Linear, regenerate cache, summary
allowed-tools: "Bash(git *), Read, Write, Task, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__create_issue, mcp__linear__get_issue"
---

# Handover Skill

Fast end-of-session handover: identify what changed, sync Linear, regenerate cache, report.

**No builds, no lint, no commits** — those cause conflicts when parallel agents work in different branches. Handover only syncs status and captures context.

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

---

## Step 1: Identify Session Work

Run in parallel:
```bash
git branch --show-current
git rev-parse --short HEAD
git log --oneline -15
```

From the git log and conversation context, build a list of **stories touched this session** with target statuses:
- Code committed for a story → **Done** (or **In Progress** if incomplete)
- Story discussed/planned but no code → **In Progress**

Also read `task.md` and extract any `[x]` (Done) or `[/]` (In Progress) entries as additional signals. But prefer git log as the primary source since task.md may be stale.

---

## Step 2: Merge & Clean Up Branches

If on a feature branch with completed work:
1. `git checkout main`
2. `git merge <feature-branch>`
3. `git branch -d <feature-branch>`

Then clean up any other stale merged branches:
```bash
git branch --merged main | grep -v '^\* main$' | grep -v '^  main$'
```
Delete any listed branches with `git branch -d`. Also drop stale stashes (`git stash list` → `git stash drop` if irrelevant).

If the feature branch has **incomplete** work (story still In Progress), do **not** merge — leave the branch for the next session.

---

## Step 3: Push to Linear

For each story identified in Step 1:
1. `mcp__linear__get_issue` — check current status
2. If already matches target, skip
3. If different, `mcp__linear__update_issue` to push new status

Track: **pushed**, **already-correct**, **errors**.

---

## Step 4: Regenerate sprint-status.yaml

**Delegate to a subagent** (`subagent_type: "general-purpose"`) with these instructions:

1. Call `mcp__linear__list_issues` with `project: "Raid Ledger"`, `limit: 250`
2. Map statuses: Done→`done`, In Progress→`in-progress`, Todo→`ready-for-dev`, In Review→`review`, Backlog→`backlog`, Canceled→`deprecated`, Duplicate→skip
3. Write `planning-artifacts/sprint-status.yaml`:

```yaml
# generated: <ISO-8601 timestamp>
# source: Linear (Raid Ledger project) — do not hand-edit
# regenerate: /init pulls from Linear, /handover pushes then pulls
project: Raid Ledger
tracking_system: linear

development_status:
  # === Done ===
  ROK-XXX: done           # <issue title>
  # === In Progress ===
  # === Ready for Dev ===
  # === Backlog ===
  # === Deprecated ===
```

4. Sort by ROK number within each group, omit empty groups
5. Return total count and per-status counts

---

## Step 5: Report

Display a compact summary:

```
=== Handover ===
Branch: <branch> @ <sha>
Merged: <branch> → main (or "stayed on <branch> — incomplete")
Cleanup: deleted N branches, dropped N stashes (or "none")
Linear: X pushed, Y already correct, Z errors
Cache: sprint-status.yaml regenerated (<total> issues)
Stories: ROK-XXX (Done), ROK-YYY (In Progress), ...
```

No commit, no file cleanup — just the status sync and report.
