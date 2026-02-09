---
name: init
description: "Initialize dev session — sprint status, priorities, and path decision"
disable-model-invocation: true
argument-hint: "[ROK-XXX | planning | sprint]"
allowed-tools: "Read, Glob, Grep, Bash(git status*), Bash(git log*), Bash(git diff*)"
---

# Session Init

Initialize a development session by gathering project state and presenting a compact dashboard.

## Step 1 — Parallel Data Gathering

Read ALL of the following in a single parallel tool-call block:

1. **Sprint status:** `planning-artifacts/sprint-status.yaml`
2. **Task priorities:** `task.md`
3. **Council decisions:** `planning-artifacts/council-decisions.md`
4. **Story file count:** Glob `implementation-artifacts/stories/ROK-*.md`
5. **Git state:** Run `git status --porcelain` and `git log --oneline -5` (two Bash calls)
6. **Focus story (conditional):** If `$ARGUMENTS` matches the pattern `ROK-` followed by digits, also read `implementation-artifacts/stories/$ARGUMENTS.md`

Do NOT read AGENTS.md — it is redundant with CLAUDE.md which is auto-loaded.

## Step 2 — Compute Derived Values

From the gathered data, compute:

### Current Phase
Find the **last** `### Revised Phase Structure` block in `council-decisions.md`. Within its code fence, find the line containing `CURRENT`. Extract the phase name and description (e.g., "Phase 2 — Calendar + Event Details Desktop").

### Next Story Number
From the Glob results of `implementation-artifacts/stories/ROK-*.md`, extract all numeric suffixes, find the highest, and add 1.

### Ready-for-Dev List
From `sprint-status.yaml`, collect all entries with status `ready-for-dev`. For each, extract the ROK-NNN identifier and the inline comment (title).

### Top 3 Priorities
Rank the ready-for-dev stories using these criteria in order:
1. **Priority emoji** from task.md or council-decisions.md: P0 (red circle) > P1 (yellow circle) > P2 (green circle)
2. **Unblocked** (no dependencies listed as incomplete) > **Blocked**
3. **Sprint roadmap order** from the latest "Approved Sprint Roadmap" in council-decisions.md — earlier sprint letter = higher priority

### Staleness Check
Compare sprint-status.yaml against task.md. Flag any entry where:
- sprint-status.yaml says `ready-for-dev` but task.md shows `[x]` (completed)
- sprint-status.yaml says `done` but task.md shows `[ ]` (incomplete)
- sprint-status.yaml says `deprecated` but task.md has no such note (or vice versa)

## Step 3 — Present Dashboard & Checkpoint

Output a single compact dashboard:

```
Session Init | <YYYY-MM-DD>
<Phase name> | <Sprint info from roadmap>

Stories: <count> files | Next: ROK-<N>
Git: <branch> | <clean/dirty — e.g. "3 modified, 1 untracked">
Recent: <latest commit one-liner>

Top Priorities (ready-for-dev):
  1. ROK-XXX  <priority>  <title>
  2. ROK-XXX  <priority>  <title>
  3. ROK-XXX  <priority>  <title>

Backlog: <remaining ready-for-dev IDs not in top 3> (<N> total ready-for-dev)
```

If staleness was detected in Step 2, append:
```
WARNING: Stale data detected — <description of mismatches>
```

### Checkpoint Behavior

Route based on `$ARGUMENTS`:

- **No arguments:** After the dashboard, present: "Path? **active-sprint** or **planning**" — then wait for the user to choose.
- **`sprint`:** After the dashboard, output: "Routing to active sprint. Top priority: ROK-XXX — <title>." — then stop.
- **`planning`:** After the dashboard, output: "Routing to planning mode." — then stop.
- **`ROK-XXX`** (a specific story ID): After the dashboard, append a **Focus Story** section:
  ```
  --- Focus: ROK-XXX ---
  Status: <status from sprint-status.yaml>
  <First 3 lines of the story file's "## Story" section>
  ACs: <count of acceptance criteria checkboxes>
  Deps: <dependency list or "none">
  ```
  Then stop.
