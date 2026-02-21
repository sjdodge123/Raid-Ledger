# Step 0: Workspace Cleanup & Linear Sync

**Run this FIRST before anything else.** Clean up stale artifacts from previous dispatch sessions, sync Linear to match reality, and preserve any in-flight work that still has value.

---

## Phase 1: Linear Status Audit

Fetch all non-terminal stories to understand what Linear thinks is happening:

```
mcp__linear__list_issues(project: "Raid Ledger", state: "In Progress")
mcp__linear__list_issues(project: "Raid Ledger", state: "In Review")
mcp__linear__list_issues(project: "Raid Ledger", state: "Code Review")
mcp__linear__list_issues(project: "Raid Ledger", state: "Changes Requested")
```

Also check GitHub for recently merged PRs that Linear might not reflect:

```bash
gh pr list --state merged --limit 10 --json number,title,mergedAt,headRefName
```

Build a map of `ROK-XXX → { linearStatus, hasMergedPR, hasBranch, hasWorktree }` for cross-referencing in later phases.

---

## Phase 2: Inventory & Clean Active Worktrees

List all worktrees git knows about:

```bash
git worktree list
```

For each non-main worktree (paths like `../Raid-Ledger--rok-*`), check for uncommitted/unpushed work:

```bash
# For each worktree path:
cd <worktree-path>
git status --short              # Any uncommitted changes?
git log --oneline main..HEAD    # Any commits ahead of main?
git log --oneline @{u}..HEAD 2>/dev/null  # Any unpushed commits?
cd -
```

**Classify each worktree:**

| State | Action |
|-------|--------|
| Clean, branch merged to main | **Remove** worktree, **mark Linear → Done** if not already |
| Clean, branch pushed to remote, PR merged | **Remove** worktree, **mark Linear → Done** if not already |
| Clean, branch pushed to remote, PR open/pending | **Remove** worktree (work is safe on GitHub), preserve Linear status |
| Has unpushed commits | **Preserve** — flag for Step 1 as in-flight |
| Has uncommitted changes | **Preserve** — flag for Step 1, warn operator |
| Detached HEAD (review worktrees) | **Remove** — review artifacts, no unique work |

### Remove stale worktrees

Only remove worktrees classified for removal:

```bash
git worktree remove ../Raid-Ledger--rok-<num>
```

Use `--force` only for detached HEAD review worktrees. For dirty worktrees that should be removed, stash or commit first if the work looks intentional, then remove.

---

## Phase 2b: Remove Orphaned Worktree Directories

**CRITICAL:** `git worktree list` only shows worktrees git is actively tracking. Previous sessions may have removed the git worktree tracking (via `git worktree remove` or branch deletion) but left the **directory on disk**. These orphaned folders accumulate and clutter the filesystem.

Scan for orphaned directories by comparing what's on disk vs what git tracks:

```bash
# Get directories git knows about
TRACKED=$(git worktree list --porcelain | grep '^worktree ' | sed 's/^worktree //')

# Get all Raid-Ledger--rok-* directories on disk
ALL_DIRS=$(ls -d ../Raid-Ledger--rok-* 2>/dev/null)

# Find orphans: on disk but NOT in git worktree list
for dir in $ALL_DIRS; do
  abs_dir=$(cd "$dir" && pwd)
  if ! echo "$TRACKED" | grep -qF "$abs_dir"; then
    echo "ORPHAN: $dir"
  fi
done
```

**For each orphaned directory:**

1. Check if it contains any uncommitted work worth preserving:
   ```bash
   # Quick check — if there's no .git file, it's fully orphaned
   ls <orphan-dir>/.git 2>/dev/null
   ```
2. If there's no `.git` file or the directory is empty/stale, **delete it directly**:
   ```bash
   rm -rf <orphan-dir>
   ```
3. If it somehow still has a `.git` pointer, prune and then delete:
   ```bash
   git worktree prune
   rm -rf <orphan-dir>
   ```

Always run `git worktree prune` after removing orphaned directories to clean up git's internal tracking:

```bash
git worktree prune
```

**Count orphans removed** and include in the Phase 6 summary report.

---

## Phase 3: Clean Up Merged Branches & Sync Linear

Switch to main and pull latest:

```bash
git checkout main
git pull origin main
```

Delete local branches already merged to main:

```bash
git branch --merged main | grep -E 'rok-[0-9]' | xargs -r git branch -d
```

**For each merged branch, update Linear if needed:**

Cross-reference the branch name (e.g., `rok-276-wow-talent-builds`) with the Linear map from Phase 1. If the story's PR is merged but Linear status is NOT "Done":

```
mcp__linear__update_issue(id: "ROK-XXX", state: "Done")
mcp__linear__create_comment(issueId: "ROK-XXX", body: "PR merged to main. Marked Done during workspace cleanup.")
```

List unmerged branches — these are potential in-flight work:

```bash
git branch --no-merged main | grep -E 'rok-[0-9]'
```

**Do NOT delete unmerged branches.** Step 1 will evaluate them against Linear status.

Also delete remote tracking branches for branches that no longer exist on origin:

```bash
git fetch --prune
```

---

## Phase 4: Clean Up Team Artifacts

Check for leftover team/task directories:

```bash
ls ~/.claude/teams/ 2>/dev/null
ls ~/.claude/tasks/ 2>/dev/null
```

Remove stale `dispatch-batch-*` directories:

```bash
rm -rf ~/.claude/teams/dispatch-batch-*
rm -rf ~/.claude/tasks/dispatch-batch-*
```

---

## Phase 5: Kill Zombie Processes

Check for orphaned API/web processes from previous `deploy_dev.sh` runs:

```bash
ps aux | grep -E 'node.*api/dist|node.*nest start' | grep -v grep
```

If multiple API processes are running (common after branch switches without clean restarts), kill them all. Step 1 will start fresh if needed:

```bash
pkill -f 'node.*enable-source-maps.*api/dist/src/main' 2>/dev/null
pkill -f 'node.*nest start --watch' 2>/dev/null
```

---

## Phase 6: Verify & Report

```bash
git worktree list          # Main + any preserved in-flight worktrees
git branch | grep rok-     # Only unmerged in-flight branches
git status                 # Clean, on main
```

### Summary Output

```
## Workspace Cleanup

### Cleaned Up
- Worktrees removed: <count> (list names)
- Orphaned directories removed: <count> (list names — were on disk but not tracked by git)
- Merged branches deleted: <count> (list names)
- Linear updated to Done: <count> (list ROK-XXX identifiers)
- Team artifacts: <cleaned / none found>
- Zombie processes: <killed N / none found>

### Preserved (in-flight)
- Worktrees: <count> (list names + why: unpushed commits, uncommitted changes)
- Unmerged branches: <count> (list names — Step 1 will check Linear status)

### Linear Status After Cleanup
| Story | Status | Notes |
|-------|--------|-------|
| ROK-XXX | Done (updated) | PR #N merged, was stuck in <old status> |
| ROK-YYY | In Progress (preserved) | Unpushed commits in worktree |

### Workspace State: CLEAN / <issues to note>
```

Proceed to **Step 1** after cleanup is complete. Any preserved worktrees/branches will be evaluated against Linear status in Step 1.
