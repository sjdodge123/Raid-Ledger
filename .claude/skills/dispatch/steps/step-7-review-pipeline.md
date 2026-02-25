# Step 7: Status-Driven Review Pipeline

The operator controls the testing gate by moving stories in Linear. The lead polls Linear and reacts — **it does NOT ask the operator for results in the terminal.**

## 7a. Poll for Operator Test Results

**Polling loop:**
1. Check Linear every 5 minutes for status updates to stories in "In Review"
2. Detect status transitions:
   - **"Code Review"** = operator approved, ready for code review
   - **"Changes Requested"** = operator found issues during testing
   - **"In Review"** (unchanged) = operator still testing, wait
3. Continue polling until ALL stories have moved out of "In Review" status

**Polling commands:**
```
mcp__linear__list_issues(project: "Raid Ledger", state: "Code Review")
mcp__linear__list_issues(project: "Raid Ledger", state: "Changes Requested")
```

**Important:** Do NOT proceed to Step 7b/7c for a story until its Linear status
has changed from "In Review". The operator approval gate is mandatory.

**Edge case:** If stories remain in "In Review" for >24 hours, message the
user to check on operator testing progress.

## 7a.5. Commit Operator Testing Changes (MANDATORY)

**After the operator finishes testing a story (whether approved or requesting changes), check for and commit any uncommitted changes in the story's worktree.**

The operator often makes small tweaks while testing (CSS fixes, copy changes, config adjustments). These changes must be committed BEFORE re-deploying or spawning review agents, or they'll be lost.

```bash
cd ../Raid-Ledger--rok-<num>
git status
# If there are changes:
git add -A
git commit -m "chore: incorporate operator testing feedback"
```

**Do this for EVERY story after the operator moves it out of "In Review", regardless of whether they approved or requested changes.**

---

## 7b. Handle Changes Requested (from operator testing)

For stories the operator moved to "Changes Requested":

**IMPORTANT:** Ensure the review task remains BLOCKED (do not unblock it). The story
must pass operator testing before code review can begin.

1. Fetch comments to get the operator's feedback: `mcp__linear__list_comments(issueId: <id>)`
2. **Re-spawn the dev teammate** (it was shut down after CI passed in Step 6c):
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "dev-rok-<num>", mode: "bypassPermissions",
        prompt: <rework prompt with operator feedback>)
   ```
3. Dev teammate fixes in its worktree, **including updating any unit tests affected by the code changes**, commits
4. Dev teammate runs all tests to verify they pass, messages lead when done
5. **Shut down dev teammate** after fixes are committed
6. **Delegate CI validation, push, and deploy to the build agent:**
   ```
   SendMessage(type: "message", recipient: "build-agent",
     content: "Full pipeline: validate, push, deploy ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
     summary: "Full pipeline ROK-<num> rework")
   ```
   The build agent will: sync with origin/main (rebase) -> run CI -> push -> deploy feature branch -> verify health -> message lead with results.
   If rebase conflicts or CI fails, the build agent messages back — re-spawn the dev teammate to fix.
7. Lead moves Linear back to "In Review"
8. Notify operator: "ROK-XXX fixed and re-deployed at localhost:5173 for re-test."
9. **Review task stays BLOCKED** — cycle repeats from Step 7a (operator re-tests)

## 7c. Unblock Review Tasks & Dispatch Code Review (for "Code Review" stories)

For stories the operator moved to "Code Review" (operator approved):

**1. Unblock the corresponding review task** in the shared task list (remove blocker).
   This allows the reviewer to claim the task and begin code review.
   Do NOT send a message to the reviewer (they will auto-poll the task list).

**2. Verify Linear status is "Code Review" (MANDATORY):**

The operator moved the story to "Code Review" in Linear. Confirm this before proceeding:
```
mcp__linear__get_issue(id: <issue_id>)
```
If the status is NOT "Code Review", DO NOT proceed — the operator hasn't approved yet.

**3. Reviewer claims operator-approved tasks** and for each story's branch:
   - **VERIFY the story has "Code Review" status in Linear** (operator approved)
   - If status is NOT "Code Review", DO NOT review — message lead about premature unblock
   - Run `git diff main...rok-<num>-<short-name>` to see code changes
   - Check: TypeScript strictness, Zod validation, security, error handling, patterns, naming
   - Message the lead with verdict (approve or request changes)

**Critical:** The reviewer should ONLY review stories that have been moved to
"Code Review" status by the operator. Code review is gated on operator approval.

**Critical:** When the reviewer reports back with "APPROVED WITH FIXES", their auto-fix
commits are LOCAL ONLY (not pushed). Step 8 MUST push these commits before creating the PR.
Skipping this causes auto-merge to ship the pre-review code to main.

See `templates/reviewer.md` for the full reviewer prompt template.
