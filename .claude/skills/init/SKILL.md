---
name: init
description: "Initialize orchestrator session — pull Linear, load previous context, present dispatch queue"
disable-model-invocation: true
argument-hint: "[ROK-XXX]"
allowed-tools: "Read, Write, Glob, Grep, Bash(git status*), Bash(git log*), Bash(git diff*), mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__list_cycles"
---

# Session Init

Initialize the orchestrator session. Pull current state from Linear, load previous session context, regenerate local caches, and present the dispatch queue.

**You are the orchestrator.** Your job is to coordinate with the operator (user) to manage subagents via `/dispatch`. You don't implement stories directly.

**Agent execution model:** Dev agents run **sequentially** (one at a time) because all agents share a single git working directory. Parallel dev agents cause branch switching, file reversion, stash contamination, and wrong-branch commits. Planning and research agents CAN run in parallel since they don't touch git.

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

## Step 3 — Domain Analysis & Execution Order

Analyze all Todo and Dispatch Ready stories to determine the best sequential execution order for `/dispatch`.

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

### 3b. Determine Execution Order

Since dev agents run sequentially (one at a time), order stories for optimal execution:

1. **Priority first** — P0/P1 before P2/P3
2. **Rework before new work** — rework is usually smaller/faster, clears the review queue
3. **Dependencies** — if story B depends on story A's output, A goes first
4. **Broad stories last** — they touch many domains, better to run after focused stories
5. Stories that are blocked by unfinished dependencies go to "Needs Work" regardless

### 3c. Output Execution Plan

Include in the dashboard:

```
=== Execution Order (sequential — one agent at a time) ===
1. ROK-XXX (P1) — [events, roster] — rework
2. ROK-YYY (P1) — [admin, db-schema] — new work
3. ROK-ZZZ (P2) — [theme] — new work

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

## Dispatch Queue (sequential execution order)
<!-- Agents run one at a time — order matters -->
1. [ ] ROK-XXX: <title>  (P1) — domains: [domain1, domain2]
2. [ ] ROK-XXX: <title>  (P2) — domains: [domain3]

## Todo → Needs Work
<!-- Stories that need planning, spec, or unblocking before dispatch -->
- [ ] ROK-XXX: <title>  (P1) — blocked by ROK-YYY
- [ ] ROK-XXX: <title>  (P2) — needs planning

## Session Notes
<!-- Key decisions, blockers, context for next session -->
```

Populate sections:
- **Active Work:** In Progress + In Review + Changes Requested stories, sorted by ROK number
- **Dispatch Queue:** Stories ordered by the execution plan (Step 3b). Include touched domains. Numbered to show execution order.
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
Dispatch Queue: N stories (sequential — one agent at a time)
Needs Work:     N stories (blocked/unspecced)
Backlog:        N stories

=== Dispatch Queue (sequential execution order) ===
| # | Story | Pri | Title | Domains |
|---|-------|-----|-------|---------|
| 1 | ROK-XXX | P1 | <title> | events, roster |
| 2 | ROK-YYY | P1 | <title> | admin, db-schema |
| 3 | ROK-ZZZ | P2 | <title> | theme |

=== Needs Work ===
| Story | Pri | Title | Issue |
|-------|-----|-------|-------|
| ROK-BBB | P1 | <title> | blocked by ROK-CCC |
| ROK-DDD | P2 | <title> | needs planning — no technical approach |
```

### If `$ARGUMENTS` matches `ROK-NNN`

Append a focus section with the Linear issue details (title, status, description preview, priority).

### Closing Prompt

End with: **"Ready to `/dispatch` the queue (sequential), plan needs-work stories, or adjust the order?"**

This sets up the operator to either:
1. Run `/dispatch` to process the queue sequentially (one agent at a time)
2. Spec or plan needs-work stories to add them to the queue
3. Reorder or adjust the dispatch queue
4. Discuss priorities or story details first
