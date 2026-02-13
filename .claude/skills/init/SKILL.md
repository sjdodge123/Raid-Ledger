---
name: init
description: "Initialize orchestrator session — pull Linear, load previous context, present dispatch queue"
disable-model-invocation: true
argument-hint: "[ROK-XXX]"
allowed-tools: "Read, Write, Glob, Grep, Bash(git status*), Bash(git log*), Bash(git diff*), mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__list_cycles"
---

# Session Init

Initialize the orchestrator session. Pull current state from Linear, load previous session context, regenerate local caches, and present the dispatch queue.

**You are the orchestrator.** Your job is to coordinate with the operator (user) to manage parallel subagents via `/dispatch`. You don't implement stories directly.

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

---

## Step 1 — Parallel Data Gathering

Fetch ALL in a single parallel block:

1. `mcp__linear__list_issues(project: "Raid Ledger", limit: 250)`
2. `mcp__linear__list_cycles(teamId: "0728c19f-5268-4e16-aa45-c944349ce386", type: "current")`
3. Read `planning-artifacts/session-notes.md` (may not exist — that's fine)
4. `git status --porcelain` and `git log --oneline -10`
5. **If `$ARGUMENTS` matches `ROK-NNN`:** also `mcp__linear__get_issue(id: "$ARGUMENTS")`

---

## Step 2 — Previous Session Context

If `session-notes.md` exists, display its contents under a "Previous Session" heading. This preserves key insights across context resets. If it doesn't exist, skip silently.

---

## Step 3 — Conflict Avoidance Analysis

Before populating the Dispatch Queue, analyze all Todo and Dispatch Ready stories to determine which can safely run in parallel. This prevents merge conflicts when multiple agents work concurrently.

### 3a. Build a Touch Map

For each candidate story (Todo + Dispatch Ready), estimate which **domains** it will modify. A domain is a bounded area of the codebase. Use the story's description, title, and acceptance criteria to infer touched domains.

**Domain list** (update as the codebase evolves):

| Domain | Backend paths | Frontend paths | Shared |
|--------|--------------|----------------|--------|
| auth | `api/src/auth/`, `api/src/plugins/` | `web/src/components/auth/`, `web/src/pages/login-*` | `packages/contract/` auth schemas |
| events | `api/src/events/` | `web/src/components/events/`, `web/src/pages/*event*` | `packages/contract/` event schemas |
| roster | `api/src/events/` (roster logic) | `web/src/components/roster/` | `packages/contract/` roster schemas |
| characters | `api/src/characters/` | `web/src/components/characters/`, `web/src/pages/character-*` | `packages/contract/` character schemas |
| profile | `api/src/users/` | `web/src/components/profile/`, `web/src/pages/profile-*`, `web/src/pages/user-profile-*` | `packages/contract/` user schemas |
| calendar | `api/src/availability/` | `web/src/components/calendar/`, `web/src/pages/calendar-*` | |
| admin | `api/src/admin/`, `api/src/settings/` | `web/src/components/admin/`, `web/src/pages/admin*` | |
| games | `api/src/igdb/`, `api/src/game-registry/` | `web/src/components/games/`, `web/src/pages/game*` | |
| theme | | `web/src/styles/`, `web/src/components/ui/`, `tailwind.*` | |
| notifications | `api/src/notifications/` | `web/src/components/notifications/` | |
| db-schema | `api/src/drizzle/` | | `packages/contract/` (new schemas) |
| broad | *(multiple domains — audits, refactors, infra changes)* | | |

**Rules:**
- If a story touches `packages/contract/` barrel exports (`index.ts`), mark it as touching `contract-barrel`. Multiple stories adding schemas is a trivial but frequent merge conflict source.
- If a story is an audit, refactor, or "codebase-wide" task, mark it as `broad`. Broad stories conflict with everything.
- A story can touch multiple domains (e.g., PUG slots touches `roster` + `db-schema` + `events`).

### 3b. Detect Conflicts

Compare every pair of candidate stories. Two stories **conflict** if:
1. They share any domain (other than `contract-barrel`)
2. Either story is marked `broad`
3. One story depends on the other (blocked-by relationship)

`contract-barrel` overlap is flagged as a **soft conflict** (trivial merge fix) rather than a hard conflict.

### 3c. Select the Safe Dispatch Set

Build the largest set of non-conflicting stories using a greedy approach:
1. Sort candidates by priority (P0 > P1 > P2 > P3 > P-), then by ROK number
2. Walk the sorted list. For each story:
   - If it has no hard conflicts with any story already in the set → **add to Dispatch Queue**
   - If it conflicts → **keep in Todo** with a conflict note
3. Stories that are blocked by unfinished dependencies stay in Todo regardless

### 3d. Output Conflict Report

Include in the dashboard (between Pipeline and Dispatch Queue):

```
=== Conflict Analysis ===
Safe batch: ROK-XXX, ROK-YYY, ROK-ZZZ (no domain overlap)
Held back:
  ROK-AAA — overlaps [domain] with ROK-XXX
  ROK-BBB — broad scope, conflicts with all
  ROK-CCC — blocked by ROK-DDD
Soft conflicts: ROK-XXX + ROK-YYY (contract-barrel only — trivial merge)
```

---

## Step 4 — Regenerate Local Caches

### 4a. sprint-status.yaml

Overwrite `planning-artifacts/sprint-status.yaml` from Linear data:

```yaml
# generated: <ISO-8601>
# source: Linear (Raid Ledger) — do not hand-edit
project: Raid Ledger

current_sprint:   # omit block if no active cycle
  name: "<cycle name>"
  number: <N>
  starts: "<YYYY-MM-DD>"
  ends: "<YYYY-MM-DD>"
  progress: "<done>/<total>"
  stories:
    - ROK-XXX    # <title> (<status>)

development_status:
  # === Done ===
  ROK-XXX: done           # <title>
  # === In Review ===
  ROK-XXX: review         # <title>
  # === Changes Requested ===
  ROK-XXX: changes-requested  # <title>
  # === In Progress ===
  ROK-XXX: in-progress    # <title>
  # === Dispatch Ready ===
  ROK-XXX: dispatch-ready # <title>
  # === Ready for Dev ===
  ROK-XXX: ready-for-dev  # <title>
  # === Backlog ===
  ROK-XXX: backlog        # <title>
  # === Deprecated ===
  ROK-XXX: deprecated     # <title>
```

**Status mapping:** Done→`done`, In Progress→`in-progress`, Todo→`ready-for-dev`, Dispatch Ready→`dispatch-ready`, In Review→`review`, Changes Requested→`changes-requested`, Backlog→`backlog`, Canceled→`deprecated`, Duplicate→skip.

Sort by ROK number within groups. Omit empty groups.

### 4b. task.md

Overwrite `task.md` — keep it minimal, the orchestrator tracks dispatch state not individual story work:

```markdown
# Session: <YYYY-MM-DD>
<!-- Generated by /init from Linear -->

## Active Work
<!-- Stories currently being worked on by agents or in review -->
- [/] ROK-XXX: <title> (In Progress|In Review|Changes Requested)

## Dispatch Queue
<!-- Safe to run in parallel — no domain overlap (from conflict analysis) -->
- [ ] ROK-XXX: <title>  (P1) — domains: [domain1, domain2]
- [ ] ROK-XXX: <title>  (P2) — domains: [domain3]

## Held Back (conflicts)
<!-- Would conflict with dispatch queue stories — run in next batch -->
- [ ] ROK-XXX: <title>  (P1) — overlaps [domain] with ROK-YYY
- [ ] ROK-XXX: <title>  (P2) — broad scope

## Todo → Needs Work
<!-- Stories that need planning, spec, or unblocking before dispatch -->
- [ ] ROK-XXX: <title>  (P1) — blocked by ROK-YYY
- [ ] ROK-XXX: <title>  (P2) — needs planning

## Session Notes
<!-- Key decisions, blockers, context for next session -->
```

Populate sections:
- **Active Work:** In Progress + In Review + Changes Requested stories, sorted by ROK number
- **Dispatch Queue:** Stories selected as safe by the conflict analysis (Step 3c). Include touched domains. Sorted by priority then ROK number.
- **Held Back:** Stories that passed spec/readiness checks but conflict with the dispatch queue. Include the conflict reason (which domain, which story). Sorted by priority then ROK number.
- **Todo → Needs Work:** Stories that are blocked, need planning, or lack spec. Sorted by priority then ROK number.
- Include priority: `(P0)` Urgent, `(P1)` High, `(P2)` Normal, `(P3)` Low.

---

## Step 5 — Present Dashboard

Output a compact dashboard:

```
Session Init | <YYYY-MM-DD>
Sprint: <name> | <start> → <end> | <done>/<total> done | Z days left
   (or: "No active sprint")

Git: <branch> | <clean/dirty>
Recent: <latest commit one-liner>
Linear: <total> issues synced

=== Pipeline ===
In Review:    N stories
Rework:       N stories (Changes Requested)
Dispatch Queue: N stories (safe to parallelize)
Held Back:    N stories (conflicting — next batch)
Needs Work:   N stories (blocked/unspecced)
Backlog:      N stories

=== Conflict Analysis ===
Safe batch: ROK-XXX, ROK-YYY, ROK-ZZZ (no domain overlap)
Held back:
  ROK-AAA — overlaps [domain] with ROK-XXX
  ROK-BBB — broad scope, conflicts with all
  ROK-CCC — blocked by ROK-DDD
Soft conflicts: ROK-XXX + ROK-YYY (contract-barrel only — trivial merge)

=== Dispatch Queue (safe to run in parallel) ===
| Story | Pri | Title | Domains |
|-------|-----|-------|---------|
| ROK-XXX | P1 | <title> | auth, db-schema |
| ROK-YYY | P2 | <title> | theme |

=== Held Back ===
| Story | Pri | Title | Conflict Reason |
|-------|-----|-------|-----------------|
| ROK-AAA | P1 | <title> | overlaps [profile] with ROK-XXX |

=== Needs Work ===
| Story | Pri | Title | Issue |
|-------|-----|-------|-------|
| ROK-BBB | P1 | <title> | blocked by ROK-CCC |
| ROK-DDD | P2 | <title> | needs planning — no technical approach |
```

### If `$ARGUMENTS` matches `ROK-NNN`

Append a focus section with the Linear issue details (title, status, description preview, priority).

### Closing Prompt

End with: **"Ready to `/dispatch` the safe batch, spec held-back stories, or adjust priorities?"**

This sets up the operator to either:
1. Run `/dispatch` on the conflict-free batch
2. Spec or plan held-back/needs-work stories for the next batch
3. Override the conflict analysis (operator can force stories into the queue)
4. Discuss priorities or story details first
