# Step 6: CI + Push + Playwright Pipeline (as teammates complete)

**This step is EVENT-DRIVEN, not sequential. The lead reacts to messages from teammates — it does NOT synchronously wait or block on any agent. Stay responsive to the operator and other teammates at all times.**

## Per-Story Pipeline Flow

Each story follows this pipeline independently. Multiple stories can be at different stages simultaneously.

```
Dev completes → Test agent → CI → Push → Deploy locally
  → QA test case agent (generates testing checklist, posts to Linear)
  → Playwright gate (uses QA test cases as its test plan)
    → PASS: Linear "In Review" → notify operator
    → FAIL: send back to dev → dev fixes → re-run from CI step → loop
```

**Playwright testing is a GATE. Stories do NOT move to "In Review" until Playwright passes (or is skipped for non-UI stories). Playwright uses the QA-generated test cases as its test plan.**

---

## 6a. When a Dev Teammate Completes -> Spawn Test Agent

When a dev teammate messages the lead that their story is complete:

1. **Spawn a test agent as a teammate** (non-blocking — do NOT wait):
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "test-rok-<num>", model: "sonnet", mode: "bypassPermissions",
        prompt: <read and fill templates/test-agent.md>)
   ```
2. **Immediately return to delegate mode** — handle other messages, respond to the operator
3. The test agent runs independently in the dev's worktree, writes tests, and messages the lead when done

## 6b. When a Test Agent Completes -> Validate CI -> Push

When a test agent messages the lead that tests are written and passing, **run the full CI pipeline and push**.

**⛔ DO NOT CREATE A PR HERE. DO NOT UPDATE LINEAR TO "IN REVIEW" HERE. The branch is pushed for Playwright testing only. PRs are created in Step 8 AFTER code review passes. Linear is updated to "In Review" in 6f AFTER Playwright passes.**

**1. Delegate push pipeline to the build agent:**

```
SendMessage(type: "message", recipient: "build-agent",
  content: "Push ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
  summary: "Push ROK-<num>")
```

The build agent will: sync with origin/main (fetch + rebase) -> re-run full CI (build/lint/test) -> push. This sync step is critical — other stories may have already merged to main, and pushing a stale branch causes duplicate CI runs on GitHub.

**If rebase conflicts:** The build agent will message back. Re-spawn the dev teammate to resolve conflicts and re-commit.

**If CI fails after rebase:** The build agent messages back with errors. Re-spawn the dev teammate to fix:
```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "dev-rok-<num>", mode: "bypassPermissions",
     prompt: <rework prompt with build/lint/test errors>)
```
After fixes, ask the build agent to push again. Repeat until CI passes and push succeeds.

**2. Shut down test teammate** (dev stays alive for potential Playwright rework):

```
SendMessage(type: "shutdown_request", recipient: "test-rok-<num>")
```

## 6c. Deploy Feature Branch Locally

After the build agent confirms push succeeded, **deploy the feature branch locally** so QA and Playwright agents can test against it:

```
SendMessage(type: "message", recipient: "build-agent",
  content: "Deploy feature branch rok-<num>-<short-name> locally for testing. Worktree: ../Raid-Ledger--rok-<num>",
  summary: "Deploy ROK-<num> locally")
```

Wait for the build agent to confirm the app is running and healthy at localhost:5173 before proceeding.

## 6d. Generate QA Test Cases (BLOCKING — must complete before Playwright)

Spawn a QA test case agent and **WAIT for it to complete**. This agent generates a detailed testing checklist from the story spec and the actual code diff, then posts it to Linear. Playwright will use these test cases as its test plan.

Read `templates/qa-test-cases.md` for the prompt template.

```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "qa-rok-<num>", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/qa-test-cases.md>)
```

**IMPORTANT:** There is no PR at this point — the QA agent should use `git diff main...rok-<num>-<short-name>` to see the code changes, NOT `gh pr diff`.

When the QA agent messages back confirming the testing checklist has been posted to Linear, **shut it down** and proceed to Playwright:

```
SendMessage(type: "shutdown_request", recipient: "qa-rok-<num>")
```

## 6e. Playwright MCP Testing Gate

**Determine if Playwright testing is relevant for this story.** Skip Playwright for stories that are:
- API-only (no frontend changes)
- Schema/migration-only
- Backend-only bug fixes with no UI impact
- Contract-only changes

For stories with **any frontend or UI changes**, Playwright testing is MANDATORY before the story can move to "In Review".

### Run Playwright Tests

Spawn the Playwright tester as a teammate and **WAIT for results** (this is a blocking gate):

```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "playwright-rok-<num>", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/playwright-tester.md — single story, NOT batch>)
```

**IMPORTANT:** The Playwright agent must first read the QA test cases from Linear (posted by the QA agent in 6d) and use them as its primary test plan. Include the Linear issue ID so it can fetch the comments. The agent tests ONLY this single story, not the whole batch.

### Handle Playwright Results

When the Playwright agent messages back:

**If ALL test cases pass → proceed to 6f** (story is ready for operator review).

**If ANY test cases fail → rework loop:**
1. Collect the failure details from the Playwright agent's message and Linear comments
2. **Shut down the Playwright agent:**
   ```
   SendMessage(type: "shutdown_request", recipient: "playwright-rok-<num>")
   ```
3. **Re-spawn the dev teammate** with the Playwright failure details:
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "dev-rok-<num>", mode: "bypassPermissions",
        prompt: "Fix Playwright test failures for ROK-<num>:\n<failure details>\n<screenshots referenced>\n\nFix the issues, run tests, commit, and message the lead.")
   ```
4. When dev completes fixes → **re-run from 6b** (CI → push → deploy → Playwright)
5. QA test cases do NOT need to be regenerated — they remain valid. Only Playwright re-runs.
6. Repeat until Playwright passes

**Cost control:** If the Playwright rework loop exceeds 3 iterations, message the operator and ask whether to continue or skip Playwright and proceed to "In Review" for manual testing only.

### Skip Playwright (non-UI stories)

For stories skipped, note it in the Linear comment when updating to "In Review":
```
"Playwright testing skipped — no frontend/UI changes in this story."
```

## 6f. Shut Down Dev Teammate

Once Playwright passes (or is skipped), the dev agent for this story has no more work. **Shut it down immediately** to stop burning tokens:

```
SendMessage(type: "shutdown_request", recipient: "dev-rok-<num>")
```

## 6g. Update Linear → "In Review" (ONLY after Playwright passes)

**⛔ This is the ONLY place where Linear is updated to "In Review". Do NOT update Linear earlier.**

```
mcp__linear__update_issue(id: <issue_id>, state: "In Review")
mcp__linear__create_comment(issueId: <issue_id>, body: "Implementation + tests complete. CI passing. Branch pushed. Playwright tests passing.\nQA test cases and Playwright results posted above.\nTest locally with: deploy_dev.sh --branch rok-<num>-<short-name>")
```

**The operator uses Linear "In Review" to know what needs testing. If Linear isn't updated, the operator has no visibility into what changed. This is NOT optional.**

## 6h. Review Tasks Stay Blocked

Review tasks remain blocked until the operator tests locally and moves the story
to "Code Review" status in Linear. The lead unblocks and spawns review agents
in Step 7c after polling detects operator approval.

## 6i. Notify Operator (after all batch stories reach "In Review")

Once ALL stories in the current batch have passed Playwright and been moved to "In Review", **notify the operator**.

Ensure the last story's feature branch is deployed locally (if not already):

```
SendMessage(type: "message", recipient: "build-agent",
  content: "Deploy feature branch rok-<num>-<short-name> locally for operator testing. Worktree: ../Raid-Ledger--rok-<num>",
  summary: "Deploy ROK-<num> for operator testing")
```

**Notify the operator — do NOT ask for test results in the terminal:**

```
## Batch N — Built & Ready for Testing
All N stories have passed CI + Playwright. Local dev environment running at localhost:5173.
Currently on branch: rok-<num>-<short-name> (ROK-XXX)

Stories to test (all in "In Review" in Linear):
- ROK-XXX: <title> — RUNNING NOW at localhost:5173
- ROK-YYY: <title> — switch with: deploy_dev.sh --branch rok-<num>-<short-name>

Testing checklists and Playwright results have been posted to each story in Linear.

When done testing each story, update its status in Linear:
  -> "Code Review" = testing passed, ready for code review agent
  -> "Changes Requested" (add comments explaining issues) = testing failed
```

**Do NOT ask the operator for test results in the terminal. The operator communicates results by updating Linear statuses. Poll Linear to detect when they're done.**

---

## ⛔ FULL STOP — DO NOT PROCEED PAST THIS POINT

**Step 6 is COMPLETE. You MUST now WAIT for the operator.**

Do NOT:
- Create pull requests (PRs are created in Step 8 AFTER code review)
- Spawn review agents (reviews happen in Step 7c AFTER operator approves)
- Move stories to "Done" or "Code Review" (the OPERATOR controls these transitions)
- Skip ahead to Step 7b/7c/8 without polling Linear first

The ONLY thing you do now is **poll Linear every 5 minutes** (Step 7a) and wait for the operator to move stories out of "In Review". The operator is the gate — you cannot proceed without their approval.

**Creating a PR with auto-merge before operator testing and code review causes unreviewed code to ship to main. This is a critical error.**
