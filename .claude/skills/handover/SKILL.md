---
name: handover
description: End-of-session handover — health checks, push to Linear, regenerate caches, commit, and summary report
allowed-tools: "Bash(npm run *), Bash(git *), Bash(curl *), Bash(mkdir *), Read, Edit, Write, Glob, Grep, Task, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__find, mcp__claude-in-chrome__get_page_text, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__create_issue, mcp__linear__get_issue"
---

# Handover Skill

End-of-session handover: health checks, push session work to Linear, regenerate local caches from Linear, clean commit, and summary report.

**Principle:** Linear is the single source of truth. Session work tracked in `task.md` checkboxes gets pushed TO Linear. Then `sprint-status.yaml` is regenerated FROM Linear. No circular reconciliation.

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

**Flags:**
- `--full` — Include Chrome smoke tests (Phase 2). Without this flag, Phase 2 is skipped.

Execute all phases sequentially (0 through 6). Track results for the final report.

---

## Compact Instructions

**CRITICAL:** If context compression occurs during handover execution, re-read `/tmp/handover-snapshot.md` immediately to recover state.

Always preserve during compaction:
- Current handover phase number and completed phase results
- The path `/tmp/handover-snapshot.md` and instruction to re-read it
- Any commit SHAs produced during the handover
- The list of session-changed stories (ROK-XXX identifiers and their target statuses)
- Phase pass/fail results

---

## Phase 0: Session Context Snapshot

**Purpose:** Capture all critical session context to a file before heavy processing begins. This makes the handover resilient to context compression.

Write `/tmp/handover-snapshot.md` with:

```markdown
# Handover Session Snapshot
Generated: <timestamp>
Branch: <branch>
SHA: <sha>

## Recent Commits
<git log --oneline -20>

## Changed Files
<git diff --name-only HEAD~5>

## task.md Contents
<full task.md>

## Phase Results
(Updated as phases complete)
```

Gather the data via:
```bash
git log --oneline -20
git diff --name-only HEAD~5
git branch --show-current
git rev-parse --short HEAD
```

**After each subsequent phase completes**, append its results to this file.

---

## Phase 1: Health Check

Run all three in parallel and record pass/fail for each:

1. **Lint:** `npm run lint` (all workspaces)
2. **Build:** `npm run build -w packages/contract && npm run build -w api && npm run build -w web` (contract first)
3. **Git status:** `git status --short` — note untracked/dirty files

Continue regardless of failures — record issues for the report.
**Append Phase 1 results to `/tmp/handover-snapshot.md`.**

---

## Phase 2: Chrome Smoke Test

**This phase only runs when `--full` is passed.** Without `--full`, skip this phase entirely and record "skipped — --full not specified" in the report.

**Prerequisite check (when --full is passed):**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```
If not `200`, warn the user and offer to skip this phase. If skipped, record "skipped — dev not running" in results.

**If dev is running**, use Chrome automation tools to verify these pages:

| Page | URL | Verify |
|------|-----|--------|
| Calendar | `http://localhost:5173/calendar` | Page loads, content renders |
| Login | `http://localhost:5173/login` | Sign In form visible |
| Events | `http://localhost:5173/events` | Page loads |
| Event Detail | `http://localhost:5173/events/1` | Page loads (title or 404 — both acceptable) |
| Profile | `http://localhost:5173/profile` | Page loads (may redirect to login — acceptable) |

For each page: navigate, wait, screenshot, record pass/fail.
Save screenshots to `implementation-artifacts/screenshots/handover/`.

Record: `X/Y pages verified` or `skipped`.
**Append Phase 2 results to `/tmp/handover-snapshot.md`.**

---

## Phase 3: Push Session Changes to Linear

Read `task.md` and extract all checkbox entries with their states:

| Checkbox | Linear Action |
|----------|---------------|
| `[x] ROK-XXX: ...` | Update Linear issue → **Done** |
| `[/] ROK-XXX: ...` | Update Linear issue → **In Progress** |
| `[ ] ROK-XXX: ...` | No change (still Todo in Linear) |

For each `[x]` or `[/]` story:
1. Use `mcp__linear__get_issue` to verify current Linear status
2. If Linear already matches the target status, skip (count as already-correct)
3. If different, use `mcp__linear__update_issue` to push the new status

**Commit-message scan:** Also check `git log --oneline` for this session's commits. If any commit message references a `ROK-XXX` story that isn't in task.md, identify those stories and push their status too (code committed = at least In Progress).

**Missing stories:** If a story in task.md doesn't exist in Linear, create it with `mcp__linear__create_issue` in the Raid Ledger project with the appropriate status.

Track counts: **pushed**, **already-correct**, **created**, **errors**.
**Append Phase 3 results to `/tmp/handover-snapshot.md`.**

---

## Phase 4: Regenerate sprint-status.yaml from Linear

**Delegate to a subagent** to keep the main context lean and avoid compression.

Use the `Task` tool with `subagent_type: "general-purpose"` and provide:
- The Linear project ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`
- The team ID: `0728c19f-5268-4e16-aa45-c944349ce386`
- The status mapping table
- The target file path: `planning-artifacts/sprint-status.yaml`
- Instructions to return: total issue count and a confirmation the file was written

### Subagent instructions (include in the Task prompt):

1. Call `mcp__linear__list_issues` with `project: "Raid Ledger"`, `limit: 250`
2. Map each issue's status using:

| Linear Status | Local Status |
|---|---|
| Done | `done` |
| In Progress | `in-progress` |
| Todo | `ready-for-dev` |
| In Review | `review` |
| Backlog | `backlog` |
| Canceled | `deprecated` |
| Duplicate | *(skip)* |

3. Write `planning-artifacts/sprint-status.yaml` in this format:

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
  ROK-XXX: in-progress    # <issue title>

  # === Ready for Dev ===
  ROK-XXX: ready-for-dev  # <issue title>

  # === Backlog ===
  ROK-XXX: backlog        # <issue title>

  # === Deprecated ===
  ROK-XXX: deprecated     # <issue title>
```

4. Sort entries by ROK number (ascending) within each status group
5. Omit empty status groups
6. Return: total issue count, count per status group

### After subagent returns

Record the regeneration results.
**Append Phase 4 results to `/tmp/handover-snapshot.md`.**

---

## Phase 5: Clean Commit

1. Run `git status --short` to see all changes
2. Stage specific changed files with `git add` (never use `-A` or `.`):
   - `planning-artifacts/sprint-status.yaml`
   - `task.md`
   - Any code files changed during the session
3. Show staged changes summary to user
4. **Ask user to confirm** before committing
5. Commit: `chore: session handover — <brief summary of session work>`
6. Record commit SHA for report

**Append Phase 5 commit SHA to `/tmp/handover-snapshot.md`.**

---

## Phase 6: Handover Report

Display the final summary:

```
=== Handover Complete ===

| Check           | Result |
|-----------------|--------|
| Lint            | pass/fail (+ error count if failed) |
| Build           | pass/fail (which workspace failed if any) |
| Chrome Tests    | X/Y pages verified (or skipped) |
| Linear Push     | X pushed, Y already correct, Z created, N errors |
| Cache Regen     | sprint-status.yaml regenerated (<total> issues) |
| Commit          | <sha> |

Key files for next session:
- planning-artifacts/sprint-status.yaml (Linear cache — regenerated)
- task.md (will be regenerated by /init)
```

Clean up: `rm -f /tmp/handover-snapshot.md`
