---
name: unblock-prs
description: "Loop through open PRs, rebase onto main, resolve conflicts, fix builds, and merge the queue"
argument-hint: "[--dry-run]"
---

# Unblock PRs — Rebase, Fix, Merge Queue

**Goal:** Get all open PRs rebased onto latest main, CI-green, and merged. Processes PRs one at a time in dependency order — each merge into main changes the base for the next PR.

**References:** Read `CLAUDE.md` for project conventions and `TESTING.md` for test failure rules.

---

## Step 1: Survey the Queue

```bash
gh pr list --state open --json number,headRefName,baseRefName,title,mergeable,autoMergeRequest --limit 30
```

Also check for batch branches that aggregate story branches:
```bash
git branch -r --list 'origin/batch/*'
```

Present the queue:

```
## PR Queue
| # | Branch | Title | Mergeable | Auto-merge |
|---|--------|-------|-----------|------------|
| 517 | batch/2026-03-24 | chore: batch | CONFLICTING | enabled |
| 515 | rok-946-... | ROK-946: ... | MERGEABLE | enabled |
```

If `--dry-run` was passed, stop here and report what WOULD be done.

---

## Step 2: Determine Processing Order

**Rules:**
1. Non-batch PRs first (they're independent story branches targeting main)
2. Batch PRs last (they aggregate story branches and are most likely to conflict)
3. Within each group, oldest first (lowest PR number)
4. If a PR's branch is merged INTO a batch branch, skip it — it ships via the batch

**Ask the operator** to confirm the order before proceeding.

---

## Step 3: Process Each PR (Loop)

For each PR in order, run the full cycle. **One PR at a time** — each merge changes main for the next.

### 3a: Checkout and Rebase

```bash
git fetch origin main
git checkout <branch>
git pull origin <branch>
git rebase origin/main
```

### 3b: Resolve Conflicts (if any)

If rebase conflicts:
1. Read each conflicting file
2. Resolve conflicts intelligently — understand both sides, don't blindly accept either
3. `git add <resolved-files>`
4. `git rebase --continue`
5. Repeat until rebase is clean

**If conflicts are too complex to resolve safely:**
- Abort: `git rebase --abort`
- Report to operator: "PR #N has conflicts I can't safely resolve: <description>"
- Skip this PR and continue to the next

### 3c: Verify Build

Run the scoped CI checks based on what files changed (same logic as `/push` Step 1.5):

```bash
git diff --name-only origin/main
```

| Files Changed | Checks |
|---------------|--------|
| Only `.md`, `.claude/skills/`, `docs/` | Skip checks |
| Only `web/src/` | Build contract + web, typecheck web, lint web, test web |
| Only `api/src/` | Build contract + api, typecheck api, lint api, test api |
| `packages/contract/` or mixed | Full CI: build all, typecheck all, lint all, test all |

```bash
# Always (if code changed):
npm run build -w packages/contract

# If api changed:
npm run build -w api && npx tsc --noEmit -p api/tsconfig.json && npm run lint -w api && npm run test -w api

# If web changed:
npm run build -w web && npx tsc --noEmit -p web/tsconfig.json && npm run lint -w web && npm run test -w web
```

### 3d: Fix Build/Test Failures

If build, lint, or tests fail AFTER the rebase:
1. Identify the failure — is it from the rebase (merge issue) or pre-existing?
2. Fix the issue
3. Commit the fix: `git commit -m "fix: resolve rebase conflicts with main"`
4. Re-run the failing checks to confirm

**If a fix requires significant code changes:**
- Report to operator: "PR #N needs non-trivial fixes after rebase: <description>"
- Ask whether to proceed or skip

### 3e: Push and Merge

```bash
git push --force-with-lease origin <branch>
```

Wait for GitHub CI to start, then enable auto-merge:
```bash
gh pr merge <number> --auto --squash
```

**Monitor CI:**
```bash
gh pr checks <number> --watch
```

If CI fails on GitHub but passed locally, investigate the delta (environment difference, flaky test, etc).

### 3f: Wait for Merge, Update Main

Once the PR is merged:
```bash
git checkout main
git pull origin main
```

Now main is updated for the next PR. **Continue the loop from Step 3a with the next PR.**

---

## Step 4: Batch Branch Handling

If a batch branch exists (e.g., `batch/2026-03-24`):

1. After all non-batch PRs are merged into main, the batch branch likely has heavy conflicts
2. Check if the batch branch still has unique commits not in main:
   ```bash
   git log --oneline origin/main..origin/batch/2026-03-24
   ```
3. If all commits are already in main (story PRs were merged individually), close the batch PR:
   ```bash
   gh pr close <number> --comment "All story branches merged individually. Batch no longer needed."
   git push origin --delete batch/2026-03-24
   ```
4. If the batch has unique commits, rebase and process like a normal PR (Step 3)

---

## Step 5: Cleanup

```bash
# Delete merged local branches
git checkout main
git branch --merged main | grep -v 'main' | xargs -r git branch -d

# Prune remote tracking branches
git fetch --prune
```

---

## Step 6: Report

```
## Unblock PRs — Complete

| PR | Branch | Result |
|----|--------|--------|
| #515 | rok-946-... | Merged (no conflicts) |
| #517 | batch/2026-03-24 | Closed (superseded) |

PRs processed: N
Merged: N
Skipped: N (reasons listed above)
Failed: N (reasons listed above)

main is now at: <sha>
```
