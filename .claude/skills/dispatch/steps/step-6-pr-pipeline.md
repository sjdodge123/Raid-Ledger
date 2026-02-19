# Step 6: PR + Auto-Merge Pipeline (as teammates complete)

**This step is EVENT-DRIVEN, not sequential. The lead reacts to messages from teammates — it does NOT synchronously wait or block on any agent. Stay responsive to the operator and other teammates at all times.**

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

## 6b. When a Test Agent Completes -> Validate CI -> Update Linear (NO PR YET)

When a test agent messages the lead that tests are written and passing, **run the full CI pipeline locally**. Individual PRs are NOT created — all stories in the batch will be combined into a single PR later (Step 8).

**1. Delegate CI validation to the build agent:**

```
SendMessage(type: "message", recipient: "build-agent",
  content: "Validate ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
  summary: "Validate ROK-<num>")
```

The build agent will run full CI (build/lint/test) in the worktree and message back with pass/fail.

**If CI fails:** The build agent messages back with errors. Re-spawn the dev teammate to fix:
```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "dev-rok-<num>", mode: "bypassPermissions",
     prompt: <rework prompt with build/lint/test errors>)
```
After fixes, ask the build agent to re-validate. Repeat until CI passes.

**2. After build agent confirms CI passes — update Linear (MANDATORY):**
```
mcp__linear__update_issue(id: <issue_id>, state: "In Review")
mcp__linear__create_comment(issueId: <issue_id>, body: "Implementation + tests complete. CI passing locally.\nTest locally with: deploy_dev.sh --branch rok-<num>-<short-name>")
```

**The operator uses Linear "In Review" to know what needs testing. If Linear isn't updated, the operator has no visibility into what changed. This is NOT optional.**

**3. Spawn QA Test Case Agent (runs in background — do not wait):**

Spawn a Sonnet agent to generate manual testing steps and post them to Linear.
Read `templates/qa-test-cases.md` for the prompt template.

```
Task(subagent_type: "general-purpose", model: "sonnet", run_in_background: true,
     prompt: <read and fill templates/qa-test-cases.md>)
```

**No PR is created at this point. The branch stays local (or pushed for backup) but no GitHub PR exists yet. The single batch PR is created in Step 8 after all stories pass code review.**

## 6c. Shut Down Dev + Test Teammates for This Story

Once CI passes, the dev and test agents for this story have no more work. **Shut them down immediately** to stop burning tokens:

```
SendMessage(type: "shutdown_request", recipient: "dev-rok-<num>")
SendMessage(type: "shutdown_request", recipient: "test-rok-<num>")
```

Do NOT wait until batch completion — shut them down as soon as CI passes.

## 6d. Review Tasks Stay Blocked

Review tasks remain blocked until the operator tests locally and moves the story
to "Code Review" status in Linear. The lead unblocks and spawns review agents
in Step 7c after polling detects operator approval.

## 6e. Deploy for Operator Testing (after all batch stories pass CI)

Once ALL stories in the current batch have passed CI locally and Linear is updated to "In Review", **delegate the deploy to the build agent**:

```
SendMessage(type: "message", recipient: "build-agent",
  content: "Deploy feature branch rok-<num>-<short-name> for operator testing.",
  summary: "Deploy ROK-<num> for operator testing")
```

The build agent will use `deploy_dev.sh --branch rok-<num>-<short-name> --rebuild` to deploy. The operator can switch between feature branches for testing.

## 6f. Spawn Playwright Testing Agent (non-blocking)

After the feature branch is deployed, spawn a Playwright testing agent using `templates/playwright-tester.md`:

```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "playwright-tester", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/playwright-tester.md>)
```

The Playwright agent runs independently — do NOT wait for it.

## 6g. Notify Operator

**Notify the operator — do NOT ask for test results in the terminal:**

```
## Batch N — Ready for Testing
All N stories have passed CI locally and are moved to "In Review" in Linear.
No PRs created yet — a single batch PR will be created after code review.

Automated Playwright tests are running — results and screenshots will be
posted to each story in Linear shortly.

Ready for testing:
- ROK-XXX: <title> — deploy_dev.sh --branch rok-<num>-<short-name> (Linear: In Review)
- ROK-YYY: <title> — deploy_dev.sh --branch rok-<num>-<short-name> (Linear: In Review)

Testing checklists have been posted to each story in Linear.
Test each story locally with: deploy_dev.sh --branch <branch-name>
Update each story's status in Linear when done:
  -> "Code Review" = testing passed, ready for code review agent
  -> "Changes Requested" (add comments explaining issues) = testing failed
```

**Do NOT ask the operator for test results in the terminal. The operator communicates results by updating Linear statuses. Poll Linear to detect when they're done.**
