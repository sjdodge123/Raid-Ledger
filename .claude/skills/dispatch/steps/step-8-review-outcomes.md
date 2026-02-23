# Step 8: Handle Code Review Outcomes

**Stories are processed individually as reviewers report back. Approved stories are QUEUED for PR creation — they are NOT merged immediately. PR creation happens in Step 8b after all stories in the batch have been reviewed.**

## 8a. Per-Story Review Handling

### If reviewer approves (APPROVED or APPROVED WITH FIXES):

1. **Check for unpushed commits in the worktree:**
   ```bash
   cd ../Raid-Ledger--rok-<num>
   git log origin/rok-<num>-<short-name>..HEAD --oneline
   ```

2. **If there are unpushed reviewer auto-fix commits, push them:**
   ```
   SendMessage(type: "message", recipient: "build-agent",
     content: "Push ROK-<num> after reviewer auto-fixes. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
     summary: "Push ROK-<num> reviewer fixes")
   ```
   Use **quick CI** for this push — full CI runs during batch PR-prep.

3. **Add the story to the approved queue.** Track:
   - Story ID (ROK-XXX)
   - Branch name (rok-<num>-<short-name>)
   - Worktree path
   - Linear issue ID
   - Summary of changes

4. **Do NOT create a PR yet.** Wait for all stories in the batch to complete review.

### If reviewer requests changes (BLOCKED):

1. Lead updates Linear -> "Changes Requested"
2. **Re-block the review task** in the shared task list (add blocker back)
   - The story must pass operator re-testing before code review can resume
3. **Re-spawn the dev teammate** (it was shut down after CI passed in Step 6):
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "dev-rok-<num>", mode: "bypassPermissions",
        prompt: <rework prompt with reviewer feedback>)
   ```
4. Dev teammate fixes in its worktree, **including updating any unit tests affected by the code changes**, commits
5. Dev teammate runs all tests to verify they pass, messages lead when done
6. **Shut down dev teammate** after fixes are committed
7. **Delegate CI validation, push, and deploy to the build agent:**
   ```
   SendMessage(type: "message", recipient: "build-agent",
     content: "Full pipeline: validate, push, deploy ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
     summary: "Full pipeline ROK-<num> reviewer fixes")
   ```
   The build agent will: sync with origin/main (rebase) -> run CI -> push -> deploy feature branch -> verify health -> message lead with results.
   If rebase conflicts or CI fails, the build agent messages back — re-spawn the dev teammate to fix.
8. Lead moves Linear -> "In Review"
9. Notify operator: "ROK-XXX has reviewer fixes re-deployed at localhost:5173 for re-test."
10. **Review task stays BLOCKED** — cycle repeats from Step 7a (operator re-tests)

---

## 8a-td. Persist Tech Debt to Linear (after each review)

When a reviewer's report includes **Tech Debt Identified** items, create Linear backlog stories so they aren't lost after `/clear`. Do this immediately after processing each reviewer message (whether approved or blocked).

**For each tech debt item (TD-1, TD-2, etc.) in the reviewer's report:**

1. **Create a Linear issue in Backlog:**
   ```
   mcp__linear__create_issue(
     title: "tech-debt: <concise description from TD item>",
     description: <see template below>,
     teamId: "0728c19f-5268-4e16-aa45-c944349ce386",
     projectId: "1bc39f98-abaa-4d85-912f-ba62c8da1532",
     priority: <severity mapping: high=2, medium=3, low=4>,
     state: "Backlog"
   )
   ```

2. **Severity → Priority mapping:**
   | Reviewer Severity | Linear Priority | Rationale |
   |---|---|---|
   | high | 2 (High) | Could cause issues if left unaddressed |
   | medium | 3 (Normal) | Should be addressed in a future sprint |
   | low | 4 (Low) | Nice-to-have improvement |

3. **Tech debt story description template:**
   ```markdown
   ## Tech Debt — <description>

   **Source:** Code review of ROK-<parent story number>
   **Identified by:** Review agent during dispatch batch <N>
   **Severity:** <low/medium/high>

   ### Details

   **File(s):** `<file:line>`
   **Issue:** <description of the tech debt>

   ### Suggested Fix

   <suggested approach from the reviewer>

   ### Context

   - Found during review of ROK-<num> (<parent story title>)
   - Not a regression — pre-existing or non-blocking for the parent story
   - No immediate user impact
   ```

4. **After creating all tech debt stories, report them in the story's review summary:**
   ```
   Tech debt stories created: <count>
   - ROK-AAA: tech-debt: <title> (P<N>)
   - ROK-BBB: tech-debt: <title> (P<N>)
   ```

**Skip this step** if the reviewer reported 0 tech debt items.

---

## 8b. Batch PR Creation (after all stories reviewed)

Once all stories in the batch have passed code review (or been deferred), create PRs.

**Strategy: try batch PR first, fall back to individual PRs if it fails.**

### Attempt 1: Batch PR (all approved stories in one PR)

If there are 2+ approved stories, try combining them into a single PR:

**1. Create a batch branch from main:**
```bash
git fetch origin main
git checkout -b batch-<N>-combined origin/main
```

**2. Cherry-pick or merge each approved story's branch (in order of story ID):**
```bash
git merge --no-ff rok-<num1>-<short-name> -m "merge: ROK-<num1> <title>"
git merge --no-ff rok-<num2>-<short-name> -m "merge: ROK-<num2> <title>"
# ... repeat for each approved story
```

**3. If ANY merge conflicts occur → STOP and fall back to individual PRs (Attempt 2).**
Remove the batch branch and proceed to Attempt 2:
```bash
git merge --abort
git checkout main
git branch -D batch-<N>-combined
```

**4. If all merges succeed, run full CI (PR-prep):**
```
SendMessage(type: "message", recipient: "build-agent",
  content: "PR-prep batch. Branch: batch-<N>-combined (in main worktree, NOT a worktree path). Full CI: build all + lint all + test all.",
  summary: "PR-prep batch PR")
```
**WAIT for the build agent to confirm full CI passes.**

If full CI fails (stories interact badly when combined), fall back to individual PRs (Attempt 2).

**5. Push and create the batch PR:**
```bash
git push -u origin batch-<N>-combined
gh pr create --base main --head batch-<N>-combined \
  --title "batch <N>: <short summary of all stories>" \
  --body "$(cat <<'EOF'
## Batch <N> — <count> stories

### Stories
- **ROK-XXX:** <title> (branch: rok-<num>-<short-name>)
- **ROK-YYY:** <title> (branch: rok-<num>-<short-name>)

### Summary
<grouped summary of all changes>

### CI
Full build + lint + test passed locally.
EOF
)"
gh pr merge <number> --auto --squash
```

**6. After batch PR merges → update all stories in Linear → "Done":**
```
# For EACH story in the batch:
mcp__linear__update_issue(id: <issue_id>, state: "Done")
mcp__linear__create_comment(issueId: <issue_id>, body: "Code review passed. Merged to main via batch PR #<num>.\nKey files changed: <list>\nCommit SHA: <sha>")
```

**7. Clean up all story worktrees + branches:**
```bash
# For each story:
git worktree remove ../Raid-Ledger--rok-<num>
git branch -d rok-<num>-<short-name>
# Also clean up the batch branch (it was squash-merged):
git branch -D batch-<N>-combined
```

**8. Report:**
```
## Batch N — <count> stories merged via single PR
PR: #<num> merged to main
- ROK-XXX: <title>
- ROK-YYY: <title>
```

---

### Attempt 2: Individual PRs (fallback)

If the batch merge failed (conflicts or CI failures), create individual PRs per story:

**For each approved story (in order of story ID):**

1. **Run full CI (PR-prep) and push:**
   ```
   SendMessage(type: "message", recipient: "build-agent",
     content: "PR-prep ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
     summary: "PR-prep ROK-<num>")
   ```
   **WAIT for the build agent to confirm everything passes before proceeding.**
   The build agent will: sync with origin/main (rebase) -> full CI (build all + lint all + test all) -> push.
   If anything fails, re-spawn the reviewer or dev to fix.

   **DO NOT create the PR until the build agent confirms PR-prep succeeded.**

2. **Create PR and enable auto-merge:**
   ```bash
   gh pr create --base main --head rok-<num>-<short-name> \
     --title "feat(ROK-<num>): <short description>" \
     --body "<summary of changes>"
   gh pr merge <number> --auto --squash
   ```

3. **IMPORTANT: Wait for the PR to merge before processing the next story.**
   Each subsequent story must rebase onto the updated main (the previous story's changes).
   The build agent's PR-prep task handles this (it rebases onto origin/main).

4. **Once CI passes and PR merges — update Linear → "Done" (MANDATORY):**
   ```
   mcp__linear__update_issue(id: <issue_id>, state: "Done")
   mcp__linear__create_comment(issueId: <issue_id>, body: "Code review passed. PR #<num> merged to main.\nKey files changed: <list>\nCommit SHA(s): <sha>")
   ```

5. **Clean up worktree:**
   ```bash
   git worktree remove ../Raid-Ledger--rok-<num>
   ```

6. **Report progress per story:**
   ```
   ## [N/total] ROK-XXX — <title>
   PR: #<num> merged to main | Commits: SHA1, SHA2
   ```

---

### Single-story batch (no batching needed)

If only 1 story was approved in the batch, skip the batch merge attempt and go straight to Attempt 2 (individual PR) for that story.
