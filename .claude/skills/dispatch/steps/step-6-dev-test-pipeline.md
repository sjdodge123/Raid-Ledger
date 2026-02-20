# Step 6: CI + Push Pipeline (as teammates complete)

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

## 6b. When a Test Agent Completes -> Validate CI -> Push -> Update Linear

When a test agent messages the lead that tests are written and passing, **run the full CI pipeline, push, and update Linear**. Do NOT create a PR — the lead handles PRs later after code review passes (Step 8).

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

**2. After build agent confirms push succeeded — update Linear → "In Review" (MANDATORY):**

```
mcp__linear__update_issue(id: <issue_id>, state: "In Review")
mcp__linear__create_comment(issueId: <issue_id>, body: "Implementation + tests complete. CI passing. Branch pushed.\nTest locally with: deploy_dev.sh --branch rok-<num>-<short-name>")
```

**The operator uses Linear "In Review" to know what needs testing. If Linear isn't updated, the operator has no visibility into what changed. This is NOT optional.**

**3. Spawn QA Test Case Agent (runs in background — do not wait):**

Spawn a Sonnet agent to generate manual testing steps and post them to Linear.
Read `templates/qa-test-cases.md` for the prompt template.

```
Task(subagent_type: "general-purpose", model: "sonnet", run_in_background: true,
     prompt: <read and fill templates/qa-test-cases.md>)
```

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

## 6e. Build & Run Locally for Operator Testing (MANDATORY — after all batch stories pass CI)

**The operator cannot test without the feature branch running locally. This is NOT optional — do it automatically.** This does NOT push to origin — it switches the local dev environment (`localhost:5173`) to the feature branch so the operator can test.

Once ALL stories in the current batch have passed CI locally and Linear is updated to "In Review", **immediately tell the build agent to switch the local environment**:

```
SendMessage(type: "message", recipient: "build-agent",
  content: "Run feature branch rok-<num>-<short-name> locally for operator testing.",
  summary: "Build ROK-<num> locally for testing")
```

The build agent will use `deploy_dev.sh --branch rok-<num>-<short-name> --rebuild` to switch the local dev environment to that feature branch. The operator can switch between branches with `deploy_dev.sh --branch <other-branch>`.

## 6f. Spawn Playwright Testing Agent (non-blocking)

After the feature branch is running locally, spawn a Playwright testing agent using `templates/playwright-tester.md`:

```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "playwright-tester", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/playwright-tester.md>)
```

The Playwright agent runs independently — do NOT wait for it.

## 6g. Notify Operator

**Notify the operator — do NOT ask for test results in the terminal:**

```
## Batch N — Built & Ready for Testing
All N stories have passed CI. Local dev environment running at localhost:5173.
Currently on branch: rok-<num>-<short-name> (ROK-XXX)

Stories to test (all in "In Review" in Linear):
- ROK-XXX: <title> — RUNNING NOW at localhost:5173
- ROK-YYY: <title> — switch with: deploy_dev.sh --branch rok-<num>-<short-name>

Testing checklists have been posted to each story in Linear.
Automated Playwright tests are running — results will be posted to Linear shortly.

When done testing each story, update its status in Linear:
  -> "Code Review" = testing passed, ready for code review agent
  -> "Changes Requested" (add comments explaining issues) = testing failed
```

**Do NOT ask the operator for test results in the terminal. The operator communicates results by updating Linear statuses. Poll Linear to detect when they're done.**
