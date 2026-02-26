# Step 8: Handle Code Review Outcomes

**Stories are processed individually as reviewers report back. Approved stories are QUEUED for PR creation — they are NOT merged immediately. PR creation happens in Step 8b after all stories in the batch have been reviewed.**

**All Linear updates in this step route through the Sprint Planner. The lead does NOT call `mcp__linear__*` tools directly.**

## Three-Way Validation (applies to ALL decisions in this step)

**Before any pipeline decision (proceed to architect, proceed to smoke test, create PR, enable auto-merge), the lead MUST:**

1. **Ask the Orchestrator:** `WHATS_NEXT: { story: 'ROK-XXX', event: '<event>' }`
2. **Validate with the Scrum Master:** "Orchestrator says X — does this match SKILL.md?"
3. **If discrepancy** — SKILL.md wins. The Scrum Master is the pipeline guardian.

**CRITICAL: Auto-merge is a one-way door. Before enabling it, the lead MUST confirm with BOTH the Orchestrator AND Scrum Master that ALL gates have passed. No exceptions.**

---

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

3. **Architect Final Alignment Check (if `needs_architect: true`) — SEQUENTIAL, BEFORE smoke tester:**
   ```
   SendMessage(type: "message", recipient: "architect",
     content: "FINAL_CHECK: ROK-<num>. Review complete diff: `git diff main...rok-<num>-<short-name>` in worktree ../Raid-Ledger--rok-<num>. Confirm implementation followed agreed approach and no architectural drift.",
     summary: "Architect final check ROK-<num>")
   ```
   **WAIT for architect verdict BEFORE proceeding to smoke tester.**
   - APPROVED -> proceed to step 4
   - BLOCKED -> send back to dev, DO NOT proceed to smoke tester

4. **Smoke Test Gate (MANDATORY — never skipped, even for `testing_level: light`):**
   Spawn smoke tester in the story's worktree:
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "smoke-rok-<num>", model: "sonnet", mode: "bypassPermissions",
        prompt: <read and fill templates/smoke-tester.md>)
   ```
   **WAIT for smoke tester verdict BEFORE proceeding.**
   - PASS -> proceed to step 5
   - FAIL -> report regressions to orchestrator. Orchestrator decides: re-spawn dev to fix or flag to operator.

   **CRITICAL: The architect check and smoke test are SEQUENTIAL gates. Do NOT run them in parallel.
   Order: architect -> smoke tester -> approved queue. Parallel execution caused missed regressions in the trial run.**

5. **Add the story to the approved queue.** Track:
   - Story ID (ROK-XXX)
   - Branch name (rok-<num>-<short-name>)
   - Worktree path
   - Linear issue ID
   - Summary of changes

6. **Do NOT create a PR yet.** Wait for all stories in the batch to complete review.

### If reviewer requests changes (BLOCKED):

1. **Update Linear via Sprint Planner:**
   ```
   SendMessage(type: "message", recipient: "sprint-planner",
     content: "QUEUE_UPDATE: { action: 'update_status', issue: 'ROK-XXX', state: 'Changes Requested', priority: 'immediate' }",
     summary: "Set ROK-XXX to Changes Requested (reviewer)")
   ```

2. **Re-block the review task** in the shared task list

3. **Re-spawn the dev teammate** with reviewer feedback:
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "dev-rok-<num>", mode: "bypassPermissions",
        prompt: <rework prompt with reviewer feedback>)
   ```

4. Dev teammate fixes, including updating any unit tests affected, commits

5. Dev teammate runs all tests, messages lead when done

6. **Shut down dev teammate** after fixes are committed

7. **Delegate CI validation, push, and deploy to the build agent:**
   ```
   SendMessage(type: "message", recipient: "build-agent",
     content: "Full pipeline: validate, push, deploy ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
     summary: "Full pipeline ROK-<num> reviewer fixes")
   ```

8. **Move Linear back to "In Review" via Sprint Planner:**
   ```
   SendMessage(type: "message", recipient: "sprint-planner",
     content: "QUEUE_UPDATE: { action: 'update_status', issue: 'ROK-XXX', state: 'In Review', priority: 'immediate' }",
     summary: "Set ROK-XXX back to In Review after reviewer fixes")
   ```

9. Notify operator: "ROK-XXX has reviewer fixes re-deployed at localhost:5173 for re-test."

10. **Review task stays BLOCKED** — cycle repeats from Step 7a (operator re-tests)

---

## 8a-td. Persist Tech Debt to Linear (after each review)

When a reviewer's report includes **Tech Debt Identified** items, queue them for creation via the Sprint Planner's deferred queue (they'll be flushed at dispatch end in Step 10b).

**For each tech debt item (TD-1, TD-2, etc.) in the reviewer's report:**

```
SendMessage(type: "message", recipient: "sprint-planner",
  content: "QUEUE_UPDATE: { action: 'create_issue', title: 'tech-debt: <description>', description: '<full description from template below>', teamId: '0728c19f-5268-4e16-aa45-c944349ce386', projectId: '1bc39f98-abaa-4d85-912f-ba62c8da1532', priority: <severity mapping>, state: 'Backlog', priority_queue: 'deferred' }",
  summary: "Queue tech debt story from ROK-XXX review")
```

**Severity -> Priority mapping:**
| Reviewer Severity | Linear Priority | Rationale |
|---|---|---|
| high | 2 (High) | Could cause issues if left unaddressed |
| medium | 3 (Normal) | Should be addressed in a future sprint |
| low | 4 (Low) | Nice-to-have improvement |

**Tech debt story description template:**
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

**After queuing all tech debt stories, report them in the story's review summary:**
```
Tech debt stories queued (deferred): <count>
- tech-debt: <title> (P<N>)
- tech-debt: <title> (P<N>)
```

**Skip this step** if the reviewer reported 0 tech debt items.

---

## 8b. Batch PR Creation (after all stories reviewed)

Once all stories in the batch have passed code review, architect check, and smoke test (or been deferred), create PRs.

**Strategy: try batch PR first, fall back to individual PRs if it fails.**

### Attempt 1: Batch PR (all approved stories in one PR)

If there are 2+ approved stories, try combining them into a single PR:

**1. Create a batch branch from main:**
```bash
git fetch origin main
git checkout -b batch-<N>-combined origin/main
```

**2. Merge each approved story's branch (in order of story ID):**
```bash
git merge --no-ff rok-<num1>-<short-name> -m "merge: ROK-<num1> <title>"
git merge --no-ff rok-<num2>-<short-name> -m "merge: ROK-<num2> <title>"
```

**3. If ANY merge conflicts occur -> STOP and fall back to individual PRs (Attempt 2).**
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

If full CI fails, fall back to individual PRs (Attempt 2).

**5. Push and create the batch PR (NO auto-merge yet):**
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
```

**6. Enable auto-merge ONLY after PR is created and all gates confirmed:**
```bash
gh pr merge <number> --auto --squash
```

**Auto-merge is the LAST action.** It is a one-way door — once CI passes on GitHub, the PR merges automatically and cannot be recalled.

**7. After batch PR merges -> queue "Done" updates via Sprint Planner (deferred):**
```
# For EACH story in the batch:
SendMessage(type: "message", recipient: "sprint-planner",
  content: "QUEUE_UPDATE: { action: 'update_status', issue: 'ROK-XXX', state: 'Done', priority: 'deferred' }",
  summary: "Queue Done transition for ROK-XXX")

SendMessage(type: "message", recipient: "sprint-planner",
  content: "QUEUE_UPDATE: { action: 'create_comment', issue: 'ROK-XXX', body: 'Code review passed. Merged to main via batch PR #<num>.\nKey files changed: <list>\nCommit SHA: <sha>', priority: 'deferred' }",
  summary: "Queue merge comment for ROK-XXX")
```

**8. Worktree + branch cleanup is handled by the Janitor in Step 9b — do NOT clean up here.**

**9. Report:**
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

   **DO NOT create the PR until the build agent confirms PR-prep succeeded.**

2. **Create PR (NO auto-merge yet):**
   ```bash
   gh pr create --base main --head rok-<num>-<short-name> \
     --title "feat(ROK-<num>): <short description>" \
     --body "<summary of changes>"
   ```

3. **Enable auto-merge ONLY after confirming all gates passed:**
   ```bash
   gh pr merge <number> --auto --squash
   ```

4. **IMPORTANT: Wait for the PR to merge before processing the next story.**
   Each subsequent story must rebase onto the updated main.

5. **Once PR merges -> queue "Done" update via Sprint Planner (deferred):**
   ```
   SendMessage(type: "message", recipient: "sprint-planner",
     content: "QUEUE_UPDATE: { action: 'update_status', issue: 'ROK-XXX', state: 'Done', priority: 'deferred' }",
     summary: "Queue Done transition for ROK-XXX")

   SendMessage(type: "message", recipient: "sprint-planner",
     content: "QUEUE_UPDATE: { action: 'create_comment', issue: 'ROK-XXX', body: 'Code review passed. PR #<num> merged to main.\nKey files changed: <list>\nCommit SHA(s): <sha>', priority: 'deferred' }",
     summary: "Queue merge comment for ROK-XXX")
   ```

6. **Report progress per story:**
   ```
   ## [N/total] ROK-XXX — <title>
   PR: #<num> merged to main | Commits: SHA1, SHA2
   ```

---

### Single-story batch (no batching needed)

If only 1 story was approved, skip the batch merge attempt and go straight to Attempt 2 (individual PR).
