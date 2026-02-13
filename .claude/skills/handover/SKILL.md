---
name: handover
description: "End-of-session — merge branches, sync Linear, rebuild for testing, capture notes"
allowed-tools: "Bash(git *), Bash(./scripts/deploy_dev.sh*), Read, Write, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__get_issue"
---

# Handover

End-of-session cleanup: merge completed branches, sync Linear, rebuild for manual testing, and capture session context for the next `/init`.

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)

---

## Step 1: Identify Session Work

Run in parallel:
```bash
git log --oneline -20
git branch --list
git status --porcelain
```

Read `task.md` for `[x]` (done) and `[/]` (in progress) markers.

Build a list of **stories touched this session** from git log commit messages (look for `ROK-XXX` patterns) and task.md state. For each, determine target status:
- Committed and merged → **In Review**
- Committed on branch, not merged → **In Progress**
- Discussed/planned only → **no change**

---

## Step 2: Merge & Clean Up Branches

For each feature branch with completed work:
1. `git checkout main`
2. `git merge <branch>`
3. `git branch -d <branch>`

Clean up stale merged branches:
```bash
git branch --merged main | grep -v 'main'
```
Delete any found with `git branch -d`.

Leave incomplete branches (In Progress) for the next session.

---

## Step 3: Sync Linear

For each story identified in Step 1:
1. `mcp__linear__get_issue` — check current status
2. If already matches target, skip
3. If different, `mcp__linear__update_issue` to set new status

Agents should have already posted summary comments during their work. If a story is missing a summary comment (committed code but no Linear comment), flag it in the report.

---

## Step 4: Rebuild for Testing

Run the dev server rebuild so the operator can manually test:
```bash
./scripts/deploy_dev.sh --rebuild
```

If the rebuild fails, report the error and suggest `--fresh` as a fallback.

After rebuild starts, present a **testing checklist** based on stories completed this session:

```
## Manual Testing Checklist
- [ ] ROK-XXX: <title> — <1-line summary of what to test>
- [ ] ROK-YYY: <title> — <1-line summary of what to test>

Dev server: http://localhost:5173
Admin login: check .env ADMIN_PASSWORD
```

---

## Step 5: Capture Session Notes

Write `planning-artifacts/session-notes.md` — this file is read by the next `/init` to preserve cross-session context.

```markdown
# Session Notes — <YYYY-MM-DD>
<!-- Written by /handover. Read by /init to preserve context across sessions. -->

## Completed This Session
- ROK-XXX: <title> — <commit SHA> — <1-line summary>
- ROK-YYY: <title> — <commit SHA> — <1-line summary>

## Moved to Review
- ROK-XXX, ROK-YYY

## Still In Progress
- ROK-ZZZ: <what's left to do>

## Key Decisions
<!-- Important choices made this session that affect future work -->
- <decision 1>
- <decision 2>

## Blockers / Open Issues
- <any unresolved problems>

## Next Session Priorities
<!-- What the operator should focus on next -->
- <priority 1>
- <priority 2>
```

Populate from conversation context and git log. The "Key Decisions" and "Next Session Priorities" sections are the most valuable — they carry forward context that would otherwise be lost on `/clear`.

---

## Step 6: Report

```
=== Handover ===
Branch: main @ <sha>
Merged: <branches merged> (or "none")
Cleanup: deleted N branches (or "none")
Linear: X synced, Y already correct, Z flagged
Rebuild: started (or "failed — <reason>")
Session notes: written to planning-artifacts/session-notes.md
Testing: N stories ready — see checklist above

Next: Test changes at localhost:5173, then /init to start next cycle.
```
