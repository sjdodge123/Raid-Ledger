# Step 7: Status-Driven Review Pipeline

The operator controls the testing gate by moving stories in Linear. The lead asks the Sprint Planner to poll and reacts to status changes — **it does NOT call Linear directly or ask the operator for results in the terminal.**

**All Linear I/O in this step routes through the Sprint Planner. The lead does NOT call `mcp__linear__*` tools directly.**

---

## 7a. Poll for Operator Test Results

**Polling loop via Sprint Planner:**

```
SendMessage(type: "message", recipient: "sprint-planner",
  content: "POLL: Check for status changes on stories in 'In Review'",
  summary: "Poll for operator test results")
```

The Sprint Planner will:
1. Refresh its local cache from Linear
2. Compare with previous cache state
3. Report any transitions (e.g., "ROK-123 moved from 'In Review' to 'Code Review'")

**Poll every 5 minutes** until ALL stories have moved out of "In Review" status.

**Important:** Do NOT proceed to Step 7b/7c for a story until the Sprint Planner confirms its Linear status has changed. The operator approval gate is mandatory.

**Edge case:** If stories remain in "In Review" for >24 hours, message the user to check on operator testing progress.

---

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

For stories the Sprint Planner reports as moved to "Changes Requested":

**IMPORTANT:** Ensure the review task remains BLOCKED (do not unblock it). The story must pass operator testing before code review can begin.

1. **Get operator feedback via Sprint Planner:**
   ```
   SendMessage(type: "message", recipient: "sprint-planner",
     content: "READ_CACHE: { filter: 'comments for ROK-XXX' }. If recent operator feedback comments are not in cache, fetch them from Linear and update the cache.",
     summary: "Get operator feedback for ROK-XXX")
   ```

2. **Classify rework scope — ask the Orchestrator:**
   ```
   SendMessage(type: "message", recipient: "orchestrator",
     content: "REWORK_SCOPE: ROK-XXX. Operator feedback: <summary>. Is this minor (co-lead quick fix) or major (full dev re-spawn)?",
     summary: "Classify rework scope for ROK-XXX")
   ```

3. **Minor rework (co-lead quick fix):**
   Read `templates/co-lead-dev.md` and spawn a co-lead dev:
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "co-lead-rok-<num>", mode: "bypassPermissions",
        prompt: <read and fill templates/co-lead-dev.md with operator feedback>)
   ```

4. **Major rework (full dev re-spawn):**
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "dev-rok-<num>", mode: "bypassPermissions",
        prompt: <rework prompt with operator feedback>)
   ```

5. After dev/co-lead completes and tests pass, **shut down the agent**

6. **Delegate CI validation, push, and deploy to the build agent:**
   ```
   SendMessage(type: "message", recipient: "build-agent",
     content: "Full pipeline: validate, push, deploy ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
     summary: "Full pipeline ROK-<num> rework")
   ```

7. **Move Linear back to "In Review" via Sprint Planner:**
   ```
   SendMessage(type: "message", recipient: "sprint-planner",
     content: "QUEUE_UPDATE: { action: 'update_status', issue: 'ROK-XXX', state: 'In Review', priority: 'immediate' }",
     summary: "Set ROK-XXX back to In Review after rework")
   ```

8. Notify operator: "ROK-XXX fixed and re-deployed at localhost:5173 for re-test."

9. **Review task stays BLOCKED** — cycle repeats from Step 7a (operator re-tests)

---

## 7c. Unblock Review Tasks & Dispatch Code Review (for "Code Review" stories)

For stories the Sprint Planner reports as moved to "Code Review" (operator approved):

**1. Verify via Sprint Planner cache:**

Read the Sprint Planner cache to confirm the story is in "Code Review" state. If the cache doesn't reflect this yet, ask the Sprint Planner to poll.

**2. Unblock the corresponding review task** in the shared task list.

**3. Spawn the reviewer** using `templates/reviewer.md`:
```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "reviewer-rok-<num>", model: "default", mode: "bypassPermissions",
     prompt: <read and fill templates/reviewer.md>)
```

The reviewer will:
- Verify the story is in "Code Review" status (reads cache)
- Run `git diff main...rok-<num>-<short-name>` to see code changes
- Check: TypeScript strictness, Zod validation, security, error handling, patterns, naming
- Message the lead with verdict (approve or request changes)

**Critical:** The reviewer should ONLY review stories that have been moved to "Code Review" status by the operator. Code review is gated on operator approval.

**Critical:** When the reviewer reports back with "APPROVED WITH FIXES", their auto-fix commits are LOCAL ONLY (not pushed). Step 8 MUST push these commits before creating the PR. Skipping this causes auto-merge to ship the pre-review code to main.

See `templates/reviewer.md` for the full reviewer prompt template.
