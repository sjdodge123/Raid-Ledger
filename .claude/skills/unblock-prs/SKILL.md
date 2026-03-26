---
name: unblock-prs
description: "Loop through open PRs, group into a combined branch where possible, and merge as few PRs as possible to minimize CI runs"
argument-hint: "[--dry-run] [--no-group]"
---

# Unblock PRs — Group, Rebase, Merge

**Goal:** Get all open PRs merged with the **fewest CI runs possible**. Default behavior is to combine compatible PRs into a single branch and merge once. Each separate PR triggers its own CI pipeline on push + merge, so grouping saves GitHub Actions minutes.

**References:** Read `CLAUDE.md` for project conventions and `TESTING.md` for test failure rules.

---

## Step 1: Survey the Queue

```bash
gh pr list --state open --json number,headRefName,baseRefName,title,mergeable,autoMergeRequest,labels --limit 30
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

If `--dry-run` was passed, stop after Step 2 and report what WOULD be done.

---

## Step 2: Group PRs for Combined Merge

**Default behavior: group as many PRs as possible into a single combined branch.** This is the primary optimization — one CI run instead of N.

### 2a: Identify groupable PRs

PRs are **groupable** if they ALL meet these criteria:
- Target `main` (not another feature branch)
- Are not infrastructure-only PRs (Dockerfile, entrypoint, nginx changes get their own PR per CLAUDE.md rules)
- Are not blocked by another open PR in the queue

PRs that **must ship individually:**
- Infrastructure PRs (Dockerfile, docker-entrypoint, nginx config changes)
- PRs explicitly marked with a `ship-alone` label
- PRs that are blocked by another PR in the queue (dependency chain)

### 2b: Test for conflicts between grouped PRs

Before committing to a group, verify the branches don't conflict with each other:

```bash
# Start from main
git checkout -b test-combine origin/main

# Try merging each branch in order (oldest first)
git merge --no-commit --no-ff origin/<branch-1> && git reset --hard HEAD
git merge --no-commit --no-ff origin/<branch-2> && git reset --hard HEAD
# ... etc
```

If two branches conflict with each other (not just with main), they cannot be in the same group. Split into separate groups or ship the conflicting one individually.

### 2c: Present the grouping plan

```
## Merge Plan

### Group 1 — Combined PR (saves N-1 CI runs)
| # | Branch | Title |
|---|--------|-------|
| 515 | rok-946-... | ROK-946: automated lineup phase scheduling |
| 518 | rok-959-... | ROK-959: suppress ad-hoc Quick Play |
| 520 | rok-962-... | ROK-962: NaN guards in smoke config |

### Ship Individually
| # | Branch | Title | Reason |
|---|--------|-------|--------|
| 519 | fix/dockerfile-... | fix: allinone entrypoint | Infrastructure PR |

CI runs: 2 (instead of 4)
```

**Ask the operator** to confirm the plan before proceeding.

If `--no-group` was passed, skip grouping and process PRs one at a time (legacy behavior, Step 3-alt).

---

## Step 3: Build the Combined Branch

### 3a: Create the combined branch

```bash
git fetch origin main
git checkout -b combined/unblock-$(date +%Y-%m-%d) origin/main
```

### 3b: Cherry-pick or merge each PR's commits

For each PR in the group, in order (oldest first):

```bash
# Get the PR's commits (relative to where it branched from main)
git log --oneline origin/main..origin/<branch>

# Merge the branch into the combined branch
git merge --no-ff origin/<branch> -m "merge: #<number> <title>"
```

**Why merge instead of cherry-pick:** Merge preserves the full commit history per PR, which makes the combined PR description clearer and attribution easier. The final PR will be squash-merged anyway.

### 3c: Resolve conflicts

If merging a branch conflicts:
1. Read each conflicting file
2. Resolve conflicts intelligently — understand both sides
3. `git add <resolved-files>` and `git commit`

**If conflicts are too complex:**
- Abort: `git merge --abort`
- Remove this PR from the group, note it as "skipped — conflicts with group"
- Continue with remaining PRs

### 3d: Verify the combined build

Run **full CI locally** since the combined branch touches multiple PRs:

```bash
npm run build -w packages/contract
npm run build -w api && npx tsc --noEmit -p api/tsconfig.json && npm run lint -w api && npm run test -w api
npm run build -w web && npx tsc --noEmit -p web/tsconfig.json && npm run lint -w web && npm run test -w web
```

If only one workspace is affected across ALL grouped PRs, scope the checks accordingly (same rules as `/push`).

### 3e: Fix failures

If build/lint/tests fail:
1. Identify whether the failure is from inter-PR conflicts or pre-existing
2. Fix the issue and commit: `git commit -m "fix: resolve integration issues in combined branch"`
3. Re-run failing checks to confirm

**If a fix requires significant changes:** report to operator and ask whether to drop that PR from the group.

### 3f: Push and create the combined PR

```bash
git push -u origin combined/unblock-$(date +%Y-%m-%d)
```

Create a combined PR that references all included PRs:

```bash
gh pr create --title "chore: combined merge — #515, #518, #520" --body "$(cat <<'EOF'
## Summary

Combined merge to reduce CI runs. Includes:

- #515 — ROK-946: automated lineup phase scheduling
- #518 — ROK-959: suppress ad-hoc Quick Play
- #520 — ROK-962: NaN guards in smoke config

## Individual PR descriptions

See each PR for details and test plans.

## Test plan

- [x] Local CI passed (contract + api + web)
- [ ] GitHub CI green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Enable auto-merge:
```bash
gh pr merge combined/unblock-$(date +%Y-%m-%d) --auto --squash
```

### 3g: Close the original PRs

Once the combined PR is merged, close the individual PRs with a reference:

```bash
gh pr close <number> --comment "Shipped via combined PR #<combined-number>"
```

Delete the now-shipped branches:
```bash
git push origin --delete <branch-1> <branch-2> <branch-3>
```

---

## Step 3-alt: Process Individual PRs (when grouping isn't possible)

For PRs that must ship individually (infrastructure, `--no-group`, or single PR in queue):

### 3-alt-a: Checkout and Rebase

```bash
git fetch origin main
git checkout <branch>
git pull origin <branch>
git rebase origin/main
```

### 3-alt-b: Resolve Conflicts (if any)

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

### 3-alt-c: Verify Build

Run scoped CI checks based on what files changed:

```bash
git diff --name-only origin/main
```

| Files Changed | Checks |
|---------------|--------|
| Only `.md`, `.claude/skills/`, `docs/` | Skip checks |
| Only `web/src/` | Build contract + web, typecheck web, lint web, test web |
| Only `api/src/` | Build contract + api, typecheck api, lint api, test api |
| `packages/contract/` or mixed | Full CI: build all, typecheck all, lint all, test all |

### 3-alt-d: Fix Build/Test Failures

If build, lint, or tests fail AFTER the rebase:
1. Identify the failure — is it from the rebase (merge issue) or pre-existing?
2. Fix the issue
3. Commit the fix: `git commit -m "fix: resolve rebase conflicts with main"`
4. Re-run the failing checks to confirm

**If a fix requires significant code changes:**
- Report to operator: "PR #N needs non-trivial fixes after rebase: <description>"
- Ask whether to proceed or skip

### 3-alt-e: Push and Merge

```bash
git push --force-with-lease origin <branch>
gh pr merge <number> --auto --squash
```

**Monitor CI:**
```bash
gh pr checks <number> --watch
```

### 3-alt-f: Wait for Merge, Update Main

Once merged:
```bash
git checkout main
git pull origin main
```

---

## Step 4: Post-Merge Verification

**After the combined PR (or each individual PR) merges, verify main is healthy.**

```bash
gh run list --branch main --limit 1 --json databaseId,status,conclusion
```

If CI is still running, wait. If CI failed on main:
1. **STOP processing further PRs** — main is broken
2. Investigate: `gh run view <id> --log-failed`
3. Fix on a hotfix branch, push, and merge
4. Only resume once main CI is green

---

## Step 5: Batch Branch Handling

If a batch branch exists (e.g., `batch/2026-03-24`):

1. Check if the batch branch still has unique commits not in main:
   ```bash
   git log --oneline origin/main..origin/batch/2026-03-24
   ```
2. If all commits are already in main (shipped via combined or individual PRs), close it:
   ```bash
   gh pr close <number> --comment "All story branches merged. Batch no longer needed."
   git push origin --delete batch/2026-03-24
   ```
3. If the batch has unique commits, include it in the next combined group or process individually

---

## Step 6: Stale Remote Branch Cleanup

After all PRs are processed, clean up remote branches whose work is already on main.

### 6a: List all remote branches (excluding main)

```bash
git fetch --prune
for branch in $(git branch -r | grep -v 'origin/main\|origin/HEAD' | sed 's|origin/||'); do
  pr=$(gh pr list --head "$branch" --state all --json number,state --jq '.[0] | "\(.number) \(.state)"' 2>/dev/null)
  echo "$branch | PR: ${pr:-none}"
done
```

### 6b: Classify each branch

| Condition | Classification | Action |
|-----------|---------------|--------|
| PR exists and state = MERGED | **Stale** — squash-merged, branch leftover | Delete |
| PR exists and state = CLOSED (not merged) | **Stale** — shipped via combined PR or abandoned | Delete |
| No PR, 0 commits ahead of main | **Stale** — empty/subsumed | Delete |
| No PR, commits ahead, last commit > 14 days old | **Dormant** — flag for operator review | Ask |
| No PR, commits ahead, last commit < 14 days old | **Active WIP** | Keep |
| PR exists and state = OPEN | **Active** — being processed | Keep |

### 6c: Delete stale branches

Present the list and **ask the operator to confirm** before deleting:

```
## Stale Branches to Delete
| Branch | Reason | Last updated |
|--------|--------|-------------|
| chore/pre-push-playwright-hook-v2 | PR #512 merged | 18 hours ago |
| fix/batch-2026-03-01-r3 | PR #317 merged | 3 weeks ago |

Delete these N branches? (y/n)
```

If confirmed:
```bash
git push origin --delete <branch1> <branch2> ...
```

For **dormant** branches (no PR, old commits), present separately and ask.

### 6d: Local cleanup

```bash
git checkout main
git branch --merged main | grep -v 'main' | xargs -r git branch -d
git fetch --prune
```

---

## Step 7: Report

```
## Unblock PRs — Complete

### Combined PRs
| Combined PR | Included PRs | Result |
|-------------|-------------|--------|
| #525 combined/unblock-2026-03-26 | #515, #518, #520 | Merged |

### Individual PRs
| PR | Branch | Result |
|----|--------|--------|
| #519 | fix/dockerfile-... | Merged (infrastructure, shipped alone) |

CI runs saved: N (grouped M PRs into 1)
PRs processed: N
Merged: N
Skipped: N (reasons listed above)
Failed: N (reasons listed above)

Branches deleted: N (stale/merged)
Branches kept: N (active WIP)

main is now at: <sha>
Main CI: ✓ green / ✗ red (details)
```
