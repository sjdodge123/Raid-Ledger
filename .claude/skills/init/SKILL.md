---
name: init
description: "Initialize orchestrator session — pull Linear, load previous context, present dispatch queue"
disable-model-invocation: true
argument-hint: "[ROK-XXX]"
allowed-tools: "Read, Write, Glob, Grep, Bash(git status*), Bash(git log*), Bash(git diff*), mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__list_cycles"
---

# Session Init

Initialize the orchestrator session. Pull current state from Linear, load previous session context, regenerate local caches, and present the dispatch queue.

**You are the orchestrator.** Your job is to coordinate with the operator (user) to manage agents via `/dispatch`. You don't implement stories directly.

**Agent execution model:** Dev agents run **in parallel** via Agent Teams, each in its own git worktree (sibling directory). Max 2-3 dev agents at a time. Stories that touch the same files or shared dependencies (contract, migrations) must be serialized. The `/dispatch` skill handles worktree setup, team creation, PR pipeline, and staging deployment.

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

## Step 3 — Domain Analysis & Parallel Batch Planning

Analyze all Todo and Dispatch Ready stories to determine which can run in parallel and which must be serialized.

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
- If a story is an audit, refactor, or "codebase-wide" task, mark it as `broad`.
- A story can touch multiple domains (e.g., PUG slots touches `roster` + `db-schema` + `events`).

### 3b. Build Conflict Matrix

For each pair of candidate stories, check for overlap:

| Conflict Type | Rule |
|---------------|------|
| **Same files** | Stories touching the same files → must serialize |
| **Same domain** | Stories in the same domain → likely serialize (check file overlap) |
| **Contract changes** | Stories modifying `packages/contract/` → must serialize |
| **DB migrations** | Stories generating migrations → must serialize |
| **No overlap** | Stories in completely different domains → can parallelize |

### 3c. Group into Parallel Batches

Group stories into batches that can run concurrently (max 2-3 per batch):

1. **Priority first** — P0/P1 before P2/P3
2. **Rework before new work** — rework is usually smaller/faster, clears the review queue
3. **Dependencies** — if story B depends on story A's output, A goes first (different batch)
4. **No conflicts within a batch** — stories in the same batch must have zero file overlap
5. **Contract/migration stories run alone** — they go in their own batch, first
6. **Broad stories last** — they touch many domains, safer as their own batch
7. Stories that are blocked by unfinished dependencies go to "Needs Work" regardless

### 3d. Output Parallel Batch Plan

Include in the dashboard:

```
=== Parallel Batch Plan ===
Batch 1 (parallel):
  ROK-XXX (P1) — [events, roster] — rework
  ROK-YYY (P1) — [theme] — new work
  (no conflicts — different domains)

Batch 2 (sequential after batch 1):
  ROK-ZZZ (P1) — [admin, db-schema] — new work (needs migration)

Conflict Matrix:
  ROK-XXX ↔ ROK-YYY: ✅ no overlap
  ROK-XXX ↔ ROK-ZZZ: ⚠️ both touch db-schema → separate batches
  ROK-YYY ↔ ROK-ZZZ: ✅ no overlap

Not ready:
  ROK-AAA — blocked by ROK-DDD
  ROK-BBB — needs planning (no technical approach)
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

## Dispatch Queue (parallel batches)
<!-- Stories within a batch run in parallel via Agent Teams -->
### Batch 1 (parallel)
- [ ] ROK-XXX: <title>  (P1) — domains: [domain1, domain2]
- [ ] ROK-XXX: <title>  (P2) — domains: [domain3]
### Batch 2 (after batch 1)
- [ ] ROK-XXX: <title>  (P1) — domains: [domain4]

## Todo → Needs Work
<!-- Stories that need planning, spec, or unblocking before dispatch -->
- [ ] ROK-XXX: <title>  (P1) — blocked by ROK-YYY
- [ ] ROK-XXX: <title>  (P2) — needs planning

## Session Notes
<!-- Key decisions, blockers, context for next session -->
```

Populate sections:
- **Active Work:** In Progress + In Review + Changes Requested stories, sorted by ROK number
- **Dispatch Queue:** Stories grouped by parallel batch (Step 3c). Include touched domains. Stories within a batch run concurrently.
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
In Review:      N stories
Rework:         N stories (Changes Requested)
Dispatch Queue: N stories (M parallel batches)
Needs Work:     N stories (blocked/unspecced)
Backlog:        N stories

=== Parallel Batch Plan ===

--- Batch 1 (parallel — N stories) ---
| Story | Pri | Title | Domains |
|-------|-----|-------|---------|
| ROK-XXX | P1 | <title> | events, roster |
| ROK-YYY | P2 | <title> | theme |

--- Batch 2 (after batch 1 — N stories) ---
| Story | Pri | Title | Domains |
|-------|-----|-------|---------|
| ROK-ZZZ | P1 | <title> | admin, db-schema |

=== Conflict Matrix ===
ROK-XXX ↔ ROK-YYY: ✅ no overlap
ROK-XXX ↔ ROK-ZZZ: ⚠️ both touch db-schema
ROK-YYY ↔ ROK-ZZZ: ✅ no overlap

=== Needs Work ===
| Story | Pri | Title | Issue |
|-------|-----|-------|-------|
| ROK-BBB | P1 | <title> | blocked by ROK-CCC |
| ROK-DDD | P2 | <title> | needs planning — no technical approach |
```

### If `$ARGUMENTS` matches `ROK-NNN`

Append a focus section with the Linear issue details (title, status, description preview, priority).

### Closing Prompt

End with: **"Ready to `/dispatch` (parallel batches via Agent Teams), plan needs-work stories, or adjust batches?"**

This sets up the operator to either:
1. Run `/dispatch` to process the queue in parallel batches (Agent Teams + worktrees)
2. Spec or plan needs-work stories to add them to the queue
3. Reorder stories or adjust parallel batch grouping
4. Discuss priorities or story details first
