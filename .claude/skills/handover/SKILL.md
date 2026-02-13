---
name: handover
description: "End-of-session — shut down teams, manage PRs, clean up worktrees, sync Linear, rebuild for testing, capture notes"
allowed-tools: "Bash(git *), Bash(gh *), Bash(./scripts/deploy_dev.sh*), Read, Write, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__get_issue"
---

# Handover

End-of-session cleanup: shut down agent teams, manage open PRs, clean up worktrees, sync Linear, rebuild for manual testing, and capture session context for the next `/init`.

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)

---

## Step 1: Shut Down Active Teams

If any Agent Teams are still running:

1. Send shutdown requests to all active teammates:
   ```
   SendMessage(type: "shutdown_request", recipient: "<teammate-name>")
   ```
2. Wait for shutdown confirmations
3. Delete the team:
   ```
   TeamDelete()
   ```

If no teams are active, skip this step.

---

## Step 2: Identify Session Work

Run in parallel:
```bash
git log --oneline -20
git branch --list
git status --porcelain
git worktree list
gh pr list --state open
```

Read `task.md` for `[x]` (done) and `[/]` (in progress) markers.

Build a list of **stories touched this session** from git log commit messages (look for `ROK-XXX` patterns) and task.md state. For each, determine target status and PR state:

| Condition | Linear Status | Action |
|-----------|--------------|--------|
| PR merged to main | Done | Clean up worktree + branch |
| PR open, approved | In Review | Prompt operator to merge or leave |
| PR open, changes requested | Changes Requested | Leave worktree, note in session notes |
| PR open, no review yet | In Review | Leave for next session |
| On branch, no PR yet | In Progress | Warn operator about incomplete work |
| Discussed/planned only | No change | — |

---

## Step 3: Manage PRs + Clean Up Worktrees

### For each open PR:

1. Check PR status: `gh pr view <number> --json state,reviewDecision`
2. Based on status:

**PR approved → prompt operator to merge:**
```
ROK-XXX PR #N is approved. Merge now?
```
If yes:
```bash
gh pr merge <number> --merge --delete-branch
git worktree remove ../Raid-Ledger--rok-<num>
```

**PR with changes requested → leave for next session:**
Note the PR URL and feedback in session notes.

**PR with no review → leave for next session:**
Note the PR URL in session notes.

### For worktrees with no PR:

Warn the operator:
```
⚠️ Worktree ../Raid-Ledger--rok-<num> has uncommitted/unpushed work with no PR.
Options: (1) I create a PR now, (2) Leave for next session, (3) Remove worktree (lose work)
```

### Clean up merged branches:

```bash
git branch --merged main | grep -v 'main\|staging'
```
Delete any found with `git branch -d`.

---

## Step 4: Reset Staging Branch

Reset staging to match current main:
```bash
git checkout staging
git reset --hard main
git push --force origin staging
git checkout main
```

---

## Step 5: Sync Linear

For each story identified in Step 2:
1. `mcp__linear__get_issue` — check current status
2. If already matches target, skip
3. If different, `mcp__linear__update_issue` to set new status

Agents should have already posted summary comments during their work. If a story is missing a summary comment (committed code but no Linear comment), flag it in the report.

---

## Step 6: Rebuild for Testing

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

## Step 7: Capture Session Notes

Write `planning-artifacts/session-notes.md` — this file is read by the next `/init` to preserve cross-session context.

```markdown
# Session Notes — <YYYY-MM-DD>
<!-- Written by /handover. Read by /init to preserve context across sessions. -->

## Completed This Session
- ROK-XXX: <title> — PR #N merged — <commit SHA> — <1-line summary>
- ROK-YYY: <title> — PR #N merged — <commit SHA> — <1-line summary>

## Open PRs (carry forward)
- ROK-ZZZ: PR #N — <status: approved/changes-requested/pending review>
  - Worktree: ../Raid-Ledger--rok-<num>
  - <PR URL>

## Moved to Review
- ROK-XXX, ROK-YYY

## Still In Progress
- ROK-ZZZ: <what's left to do>

## Parallel Execution Stats
- Batches run: N
- Stories dispatched: N (M parallel, K sequential)
- Total PRs created: N
- Review outcomes: X approved, Y changes requested

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

Populate from conversation context, git log, and PR list. The "Key Decisions", "Open PRs", and "Next Session Priorities" sections are the most valuable — they carry forward context that would otherwise be lost on `/clear`.

---

## Step 8: Report

```
=== Handover ===
Branch: main @ <sha>
PRs merged: N (list PR numbers)
PRs open: N (list PR numbers + status)
Worktrees: N active, M cleaned up
Staging: reset to main
Linear: X synced, Y already correct, Z flagged
Rebuild: started (or "failed — <reason>")
Session notes: written to planning-artifacts/session-notes.md
Testing: N stories ready — see checklist above

Next: Test changes at localhost:5173, then /init to start next cycle.
```
