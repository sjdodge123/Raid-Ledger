---
name: unblock-prs
description: "Loop through open PRs, group into a combined branch where possible, merge as few PRs as possible to minimize CI runs, then auto-monitor until everything lands. Walk-away safe — handles BEHIND-main rebases and unrelated CI flakes automatically."
argument-hint: "[--dry-run] [--no-group] [--no-monitor]"
---

# Unblock PRs — Group, Rebase, Merge, Monitor

**Goal:** Get all open PRs merged with the **fewest CI runs possible** AND keep babysitting them until they actually land. Default behavior is to combine compatible PRs into a single branch and merge once, then auto-monitor every still-open PR through the post-merge tail (rebases, flake reruns) until the operator's queue is empty.

**Walk-away contract:** the operator should be able to invoke `/unblock-prs` and not look at the window again until everything is shipped. If a real blocker appears (main-branch CI red, a non-flaky test failure, a CHANGES_REQUESTED review), surface it and stop monitoring that PR — but otherwise keep grinding.

**Autonomy contract — STRICT:** this skill runs end-to-end without operator gates. Do **not** call `AskUserQuestion`, do **not** print `(y/n)` prompts, do **not** ask "should I proceed?", do **not** wait for "go" or "looks good". Print plans and progress as FYI only; the operator can interrupt with STOP/PAUSE if something looks wrong. The decision rules below cover every branching path so no human-in-the-loop is needed:

* **Group plan** — execute as soon as it's computed (Step 2). Don't wait for approval.
* **Combined-branch CI failure with non-trivial fix** — drop the failing PR from the group automatically, continue with the rest (Step 3e).
* **Individual rebase needs >~50 LOC of non-mechanical edits** — abort the rebase, skip the PR, continue (Step 3-alt-d).
* **Stale branches (PR merged/closed)** — delete automatically (Step 6c).
* **Dormant branches (no PR, >14 days old)** — leave alone, list them in the final report.
* **PR is `BEHIND` main during monitoring** — `gh pr update-branch <num>` automatically (Step 8c).
* **Flaky CI shard fails on a check unrelated to PR diff** — `gh run rerun --failed <run-id>` once per check per loop tick (Step 8d). Investigate FIRST: confirm the failing test path is not touched by the PR's diff. Never re-run hoping; only re-run with evidence the failure is environmental.

Only halt for: a STOP/PAUSE from the operator, main-branch CI failure (Step 4 — that's an actual blocker), a non-flake CI failure that maps to the PR's diff (Step 8e), or auth/permission errors that no automatic action can resolve.

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

Print the plan as an FYI line — **do not ask for confirmation**. Proceed directly to Step 3. The operator runs this skill expecting work to happen, not approval gates; they'll see the same plan in the final report and can interrupt if something looks wrong.

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

**If a fix requires significant changes** (more than ~50 LOC of non-mechanical edits, or touches files outside the failing PR's diff): drop the PR from the group automatically — `git reset --hard HEAD~1` to back out the merge, note it as "skipped — non-trivial integration fix", and continue with the remaining PRs. Do not ask.

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

**If a fix requires significant code changes** (>~50 LOC of non-mechanical edits, or touches files outside the PR's diff): skip this PR automatically — `git rebase --abort` if the rebase is mid-flight, note it as "skipped — non-trivial fix after rebase", and continue with the next PR. Do not ask.

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

**Stale branches** (PR merged or closed, or 0 commits ahead of main) are deleted automatically — these are unambiguously resolved work. Print the list as an FYI, then delete:

```
## Stale Branches Deleted
| Branch | Reason | Last updated |
|--------|--------|-------------|
| chore/pre-push-playwright-hook-v2 | PR #512 merged | 18 hours ago |
| fix/batch-2026-03-01-r3 | PR #317 merged | 3 weeks ago |
```

```bash
git push origin --delete <branch1> <branch2> ...
```

**Dormant branches** (no PR, commits ahead, last commit > 14 days old) are *not* deleted automatically — they may represent unfinished work that nobody opened a PR for yet. List them in the final report (Step 7) under a "Dormant — review manually" section so the operator can act later, but don't ask inline.

### 6d: Local cleanup

```bash
git checkout main
git branch --merged main | grep -v 'main' | xargs -r git branch -d
git fetch --prune
```

---

## Step 7: Initial Report (then continue to Step 8)

```
## Unblock PRs — Initial Pass Complete

### Combined PRs
| Combined PR | Included PRs | Result |
|-------------|-------------|--------|
| #525 combined/unblock-2026-03-26 | #515, #518, #520 | Merged or auto-merge enabled |

### Individual PRs
| PR | Branch | Result |
|----|--------|--------|
| #519 | fix/dockerfile-... | Auto-merge enabled (infrastructure, shipped alone) |

CI runs saved: N (grouped M PRs into 1)
PRs processed: N
Skipped: N (reasons listed above)

Branches deleted: N (stale/merged)
Branches kept: N (active WIP)

main is now at: <sha>
Main CI: ✓ green / ✗ red (details)

### Auto-monitor armed
Watching N PRs through CI / merge tail (Step 8). Will surface only on operator-needed blockers.
```

The initial pass usually leaves PRs with auto-merge enabled but CI still running. Step 8 watches them through to MERGED so the operator can walk away.

---

## Step 8: Auto-Monitor Until Merged (default behavior)

After the initial pass, identify every PR that is still OPEN — these need monitoring. Skip Step 8 only if `--no-monitor` was passed OR if there are zero remaining open PRs in the queue.

**Goal:** walk-away behavior. The operator invoked `/unblock-prs` to ship things, not to keep checking back. Step 8 grinds through the post-push tail — rebases when main moves, reruns when CI flakes — until every PR in the queue is either MERGED or has surfaced a real blocker.

### 8a: Build the monitor list

Open PRs from Steps 3 and 3-alt that:
- have auto-merge enabled (verify via `gh pr view <num> --json autoMergeRequest`), AND
- are not in CHANGES_REQUESTED or DRAFT state.

For PRs that lack auto-merge: enable it via `gh pr merge <num> --auto --squash` per CLAUDE.md, then add them to the list.

### 8b: Arm a self-paced loop

Invoke the `/loop` skill (no leading interval — dynamic mode) with a polling prompt that targets the monitor list. Example:

```
Skill({skill: "loop", args: "Poll PRs #N1, #N2, #N3 until ALL are MERGED. Each tick: gh pr view <num> --json state,mergeStateStatus,headRefOid,statusCheckRollup. Per PR — see Step 8c-e of the unblock-prs skill for decisions. Self-pace 270s while CI moves; stretch to 1200s if every remaining PR is BLOCKED on operator decision."})
```

The /loop skill runs the prompt now, then ScheduleWakeup at the chosen cadence. It re-enters itself each tick until the loop body returns "stop." Step 8c–e describes the loop body.

### 8c: Per-tick decision tree

For each PR still in the monitor list:

| Observed state | Action |
|----------------|--------|
| `state == MERGED` | Drop from monitor list. If list now empty, print final report (Step 8f) and stop the loop. |
| `state == CLOSED` (not merged) | Drop from monitor list, surface "PR #N closed without merge — needs investigation". |
| `mergeStateStatus == BEHIND` | `gh pr update-branch <num>` (idempotent). This will rebase the PR onto current main and trigger a fresh CI cycle. Keep monitoring. |
| `mergeStateStatus == DIRTY` / `BLOCKED` (no failing checks) | Surface and drop — usually means branch protection rule the skill can't satisfy (required review, signed commits, etc.). |
| `mergeStateStatus == CONFLICTING` | Surface and drop — needs human merge resolution. |
| `reviewDecision == CHANGES_REQUESTED` | Surface and drop — addressing review feedback is outside skill scope. |
| Failing checks present | See 8d. |
| All checks passing AND mergeStateStatus is `CLEAN`/`HAS_HOOKS`/`UNKNOWN` | Auto-merge will fire imminently. Keep monitoring; expect MERGED next tick. |
| Checks running | Keep monitoring. |

### 8d: Failing-check triage (rerun-once policy)

When a check has `conclusion == FAILURE`:

1. **Identify the failing run + check name** from `statusCheckRollup`.
2. **Look up `git diff --name-only origin/main..origin/<branch>`** (or for a combined branch, the union diff). Extract the failing test/file path from the CI log via `gh run view <run-id> --log-failed | head -50`.
3. **Decide flake vs real:**
   - The failing test/file path **does not appear** in the PR's diff and isn't part of a workspace the diff materially touches → **flake candidate**. Action: `gh run rerun --failed <run-id>` ONCE per check per loop lifetime. Track which (PR, check) pairs you've already rerun in the loop's prompt context — never rerun the same pair twice.
   - The failing test/file path **does appear** in the PR's diff, OR you've already rerun this check once and it failed again → **real failure**. Surface "PR #N: CI failing on <check name> — <one-line cause from log>", drop from monitor list, do not retry.
   - Build / typecheck / lint failures → almost always real (config or code-level), surface and drop.
4. Reruns trigger a fresh check; the loop catches the result on a subsequent tick. Don't poll the same PR more aggressively just because you reran it.

**Important:** never push code from inside the monitor loop. If a fix is needed, the loop's job is to surface it; the operator (or a separate `/build` / `/fix-batch`) handles the fix.

### 8e: Hard stops for the loop

The loop terminates when ANY of:

1. **All monitored PRs have reached MERGED** → final report, stop.
2. **Monitor list emptied via real failures + drops** → loop has nothing left to watch.
3. **Operator says STOP/PAUSE** → stop immediately.
4. **Main-branch CI fails** (Step 4 condition) → stop everything, do not push more PR updates.

Each individual PR stops being monitored (but loop continues for the rest) when it reaches MERGED, CLOSED, CHANGES_REQUESTED, CONFLICTING, or has a non-flake check failure (8d.3).

### 8f: Final report (loop end)

```
## Unblock PRs — Auto-Monitor Complete

| PR | Outcome | Notes |
|----|---------|-------|
| #708 | ✅ Merged at <sha> | One automatic rebase post-#709-merge; one rerun on flaky integration-test-shard |
| #709 | ✅ Merged at <sha> | One rerun on flaky integration-test-shard |
| #710 | ⚠️ Surfaced — CI failing on `unit-tests-api`: <test path> is in PR's diff (not flake). Operator must address before merge. | dropped from monitor |

main is now at: <sha>
PRs merged this run: N
PRs surfaced needing operator: N
Total CI reruns triggered: N (all on checks investigated as unrelated to PR diff)
```
