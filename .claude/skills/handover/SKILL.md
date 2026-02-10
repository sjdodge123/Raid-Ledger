---
name: handover
description: End-of-session handover — lint, build, chrome smoke test, docs, commit, Linear sync, and summary report
allowed-tools: "Bash(npm run *), Bash(git *), Bash(curl *), Bash(mkdir *), Bash(cat *), Read, Edit, Write, Glob, Grep, Task, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__find, mcp__claude-in-chrome__get_page_text, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__create_issue, mcp__linear__get_issue"
---

# Handover Skill

End-of-session handover: health checks, visual smoke tests, documentation sync, clean commit, bidirectional Linear sync, and summary report.

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

**Flags:**
- `--full` — Include Chrome smoke tests (Phase 2). Without this flag, Phase 2 is skipped.

Execute all phases sequentially (0 through 6). Track results for the final report.

---

## Compact Instructions

**CRITICAL:** If context compression occurs during handover execution, the handover context snapshot at `/tmp/handover-snapshot.md` contains all state needed to continue. Re-read that file immediately after any compression event before proceeding with remaining phases.

When compacting during a handover, **always preserve:**
- The current handover phase number and results from completed phases
- The path `/tmp/handover-snapshot.md` and instruction to re-read it
- Any commit SHAs produced during the handover
- The list of session-changed stories
- Phase pass/fail results

---

## Phase 0: Session Context Snapshot

**Purpose:** Capture all critical session context to a file before heavy processing begins. This makes the handover resilient to context compression — if compression fires mid-handover, re-read this file to recover state.

Write `/tmp/handover-snapshot.md` with the following content:

```bash
# Gather session context
git log --oneline -20                           # Recent commits
git diff --name-only HEAD~5                     # Files changed recently
git branch --show-current                       # Current branch
git rev-parse --short HEAD                      # Current SHA
cat planning-artifacts/sprint-status.yaml       # Current sprint state
```

The snapshot file should contain:
```markdown
# Handover Session Snapshot
Generated: <timestamp>
Branch: <branch>
SHA: <sha>

## Recent Commits
<git log output>

## Changed Files
<git diff --name-only output>

## Sprint Status
<full sprint-status.yaml contents>

## Phase Results
(Updated as phases complete — append results after each phase)
```

**After each subsequent phase completes**, append its results to this file so the snapshot stays current.

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
| Calendar | `http://localhost:5173/calendar` | Page loads, month grid or content renders |
| Login | `http://localhost:5173/login` | Sign In form visible |
| Events | `http://localhost:5173/events` | Page loads, event cards or empty state |
| Event Detail | `http://localhost:5173/events/1` | Page loads (title or 404 — both acceptable) |
| Profile | `http://localhost:5173/profile` | Page loads (may redirect to login — acceptable) |

For each page:
1. Navigate to URL
2. Wait briefly for render
3. Take screenshot
4. Record pass/fail

Save all screenshots to `implementation-artifacts/screenshots/handover/` (create dir if needed).

Record: `X/Y pages verified` or `skipped`.
**Append Phase 2 results to `/tmp/handover-snapshot.md`.**

---

## Phase 3: Documentation

1. **Read `task.md`** — update session progress section:
   - Mark completed items `[x]`
   - Mark in-progress items `[/]`
   - Note any test/build failures from Phase 1

2. **Read `planning-artifacts/sprint-status.yaml`** — hard-reconcile against task.md:
   - For every story in either file, ensure the statuses agree using this mapping:
     - `[x]` in task.md = `done` in sprint-status.yaml
     - `[/]` in task.md = `in-progress` in sprint-status.yaml
     - `[ ]` in task.md = whatever sprint-status.yaml says (backlog/ready-for-dev/etc.)
     - `deprecated` in sprint-status.yaml → remove from task.md or mark with `~~strikethrough~~`
   - If statuses conflict, **task.md is the authority for work done this session** — update sprint-status.yaml to match
   - Update the `generated:` timestamp comment at top of file
   - **List every conflict found and how it was resolved** so the user can verify

3. **Ask user** to confirm documentation changes look correct before proceeding.

**Append Phase 3 results to `/tmp/handover-snapshot.md`.**

---

## Phase 4: Clean Commit

1. Run `git status --short` to see all changes
2. Stage specific changed files with `git add` (never use `-A` or `.`)
3. Show staged changes summary to user
4. **Ask user to confirm** before committing
5. Commit: `chore: session handover — <brief summary of session work>`
6. Record commit SHA for report

**Append Phase 4 commit SHA to `/tmp/handover-snapshot.md`.**

---

## Phase 5: Linear Sync (Bidirectional)

**Delegate this phase to a subagent** to keep the main context lean and avoid compression.

Use the `Task` tool with `subagent_type: "general-purpose"` and provide:
- The full contents of `planning-artifacts/sprint-status.yaml`
- The session-changed stories (diff from Phase 4 commit vs HEAD~1)
- The Linear project ID and team ID
- The status mapping table
- Instructions to return: pushed count, pulled count, created count, errors, and the updated sprint-status.yaml content (if changes were made)

### Subagent instructions (include in the Task prompt):

Linear is the source of truth, **except** for stories touched this session.

**Step 5a: Detect session-changed stories**

Compare current `planning-artifacts/sprint-status.yaml` against the previous commit:
```bash
git show HEAD~1:planning-artifacts/sprint-status.yaml
```
Any story whose status differs was **touched this session**.

**Step 5b: Sync**

For **session-changed stories** → push local status TO Linear (local is fresher).
For **all other stories** → pull status FROM Linear and update local yaml (Linear is source of truth).
If a story exists locally but not in Linear → create it in Linear with local status.
If a story exists in Linear (Raid Ledger project) but not locally → add to local yaml with Linear's status.

**Status mapping (bidirectional):**

| Local | Linear |
|-------|--------|
| `done` | Done |
| `in-progress` | In Progress |
| `ready-for-dev` | Todo |
| `review` | In Review |
| `backlog` | Backlog |
| `deprecated` | Canceled |
| `deferred` | Backlog |

For issues in Linear with status `Duplicate`, skip them (do not sync).

After sync, if local yaml changed, update the file and commit:
```
chore: linear sync — X pushed, Y pulled, Z created
```

Track counts: pushed, pulled, created, already-correct, errors.

**Step 5c: Post-sync reconciliation**

After Linear sync completes, re-verify that `task.md` and `sprint-status.yaml` still agree. The Linear pull in step 5b may have introduced new conflicts (e.g., Linear says "Backlog" but task.md has `[x]`).

For each story, compare both files:
- If they disagree and the story was **touched this session** → task.md wins, fix sprint-status.yaml
- If they disagree and the story was **not touched this session** → sprint-status.yaml wins (it was just synced from Linear), fix task.md

If any corrections were made, amend the linear sync commit:
```bash
git add task.md planning-artifacts/sprint-status.yaml && git commit --amend --no-edit
```

**Report any corrections made** — these indicate the sync introduced drift that was auto-fixed.

### After subagent returns

Record the sync counts from the subagent response.
**Append Phase 5 results to `/tmp/handover-snapshot.md`.**

---

## Phase 6: Handover Report

Display the final summary:

```
=== Handover Complete ===

| Check         | Result |
|---------------|--------|
| Lint          | pass/fail (+ error count if failed) |
| Build         | pass/fail (which workspace failed if any) |
| Chrome Tests  | X/Y pages verified (or skipped) |
| Documentation | task.md + sprint-status.yaml updated |
| Commit        | <sha> |
| Linear Sync   | X pushed, Y pulled, Z created, W correct, N reconciled |

Key files for next session:
- task.md
- planning-artifacts/sprint-status.yaml
```

Clean up: `rm -f /tmp/handover-snapshot.md`
