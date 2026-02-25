# Step 6: CI + Push + Playwright Pipeline (as teammates complete)

**This step is EVENT-DRIVEN, not sequential. The lead reacts to messages from teammates — it does NOT synchronously wait or block on any agent. Stay responsive to the operator and other teammates at all times.**

**All Linear updates in this step route through the Sprint Planner. The lead does NOT call `mcp__linear__*` tools directly.**

---

## Per-Story Pipeline Flow

Each story follows this pipeline independently. Multiple stories can be at different stages simultaneously.

```
Dev completes -> Test agent -> Test Engineer review -> Quality Checker gate
  -> CI -> Push -> Deploy locally
  -> QA test case agent (generates testing checklist, posts to Linear via Sprint Planner)
  -> Playwright gate (uses QA test cases as its test plan)
  -> UX Reviewer gate (if UI changes + mockups exist)
    -> PASS: Sprint Planner "In Review" -> notify operator
    -> FAIL: send back to dev -> dev fixes -> re-run from CI step -> loop
```

**Playwright testing is a GATE. Stories do NOT move to "In Review" until Playwright passes (or is skipped for non-UI stories). Playwright uses the QA-generated test cases as its test plan.**

---

## Three-Way Validation (applies to ALL gate decisions in this step)

**Before spawning any gate agent or making any skip/proceed decision, the lead MUST:**

1. **Ask the Orchestrator** what the next step should be:
   ```
   SendMessage(type: "message", recipient: "orchestrator",
     content: "WHATS_NEXT: { story: 'ROK-XXX', event: '<event>', current_state: '<state>' }",
     summary: "What's next for ROK-XXX after <event>?")
   ```

2. **Validate with the Scrum Master** that the Orchestrator's direction matches the SKILL.md gate order:
   ```
   SendMessage(type: "message", recipient: "scrum-master",
     content: "VALIDATE: Orchestrator says next step for ROK-XXX is <direction>. Does this match SKILL.md gate order?",
     summary: "Validate pipeline direction for ROK-XXX")
   ```

3. **If Scrum Master flags a discrepancy** — SKILL.md wins. Do NOT follow the Orchestrator's direction. The Scrum Master will advise the correct next step.

**The lead NEVER independently decides which gates to skip or which agents to spawn.** That's the Orchestrator's decision matrix, validated by the Scrum Master.

---

## 6a. When a Dev Teammate Completes -> Spawn Test Agent

When a dev teammate messages the lead that their story is complete:

1. **Consult Orchestrator + Scrum Master** (three-way validation) for next step after `dev_complete`.
2. **Spawn a test agent as a teammate** (non-blocking — do NOT wait):
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "test-rok-<num>", model: "sonnet", mode: "bypassPermissions",
        prompt: <read and fill templates/test-agent.md>)
   ```
2. **Immediately return to delegate mode** — handle other messages, respond to the operator
3. The test agent runs independently in the dev's worktree, writes tests, and messages the lead when done

## 6a.5. When Test Agent Completes -> Test Engineer Review

When the test agent messages the lead that tests are written and passing:

1. **Send test results to the Test Engineer** for quality review:
   ```
   SendMessage(type: "message", recipient: "test-engineer",
     content: "REVIEW_TESTS: ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>. Test agent reports tests passing. Review test quality and coverage.",
     summary: "Test Engineer review ROK-<num>")
   ```
2. **Test Engineer verdict:**
   - **PASS** -> proceed to 6a.6 (Quality Checker)
   - **FAIL (standard/full profile)** -> BLOCKING. Re-spawn test agent with feedback. Loop.
   - **FAIL (light profile)** -> advisory only. Log concerns, proceed to 6a.6.

## 6a.6. Quality Checker Gate (skipped for light profile)

Spawn a Quality Checker to verify ACs are met, tests are meaningful, and code is complete:

```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "qc-rok-<num>", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/quality-checker.md>)
```

Wait for verdict:
- **PASS** -> proceed to 6b (CI + Push)
- **FAIL** -> re-spawn dev with feedback. Loop back to 6a after fixes.

## 6b. CI Passes -> Push Branch

**DO NOT CREATE A PR HERE. DO NOT UPDATE LINEAR TO "IN REVIEW" HERE.** The branch is pushed for Playwright testing only. PRs are created in Step 8 AFTER code review passes.

**Delegate push pipeline to the build agent:**

```
SendMessage(type: "message", recipient: "build-agent",
  content: "Push ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
  summary: "Push ROK-<num>")
```

The build agent will: sync with origin/main (fetch + rebase) -> re-run full CI (build/lint/test) -> push.

**If rebase conflicts:** The build agent will message back. Re-spawn the dev teammate to resolve conflicts and re-commit.

**If CI fails after rebase:** The build agent messages back with errors. Re-spawn the dev teammate to fix, then ask build agent to push again.

**Shut down test teammate** (dev stays alive for potential Playwright rework):

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

Wait for the build agent to confirm the app is running and healthy at localhost:5173.

## 6d. Generate QA Test Cases (BLOCKING — must complete before Playwright)

Spawn a QA test case agent and **WAIT for it to complete**. This agent generates a detailed testing checklist from the story spec and the actual code diff, then posts it to Linear **via the Sprint Planner**.

Read `templates/qa-test-cases.md` for the prompt template.

```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "qa-rok-<num>", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/qa-test-cases.md>)
```

**IMPORTANT:** There is no PR at this point — the QA agent should use `git diff main...rok-<num>-<short-name>` to see the code changes, NOT `gh pr diff`.

**IMPORTANT:** The QA agent posts its test cases to Linear via the Sprint Planner (deferred queue), NOT by calling `mcp__linear__create_comment` directly.

When the QA agent messages back confirming the testing checklist has been posted, **shut it down** and proceed to Playwright:

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

**IMPORTANT:** The Playwright agent must first read the QA test cases from the Sprint Planner cache (posted by the QA agent in 6d) and use them as its primary test plan.

### Handle Playwright Results

When the Playwright agent messages back:

**If ALL test cases pass -> proceed to 6e.5 (UX review, if applicable) or 6f.**

**If ANY test cases fail -> rework loop:**
1. Collect the failure details from the Playwright agent's message
2. **Shut down the Playwright agent:**
   ```
   SendMessage(type: "shutdown_request", recipient: "playwright-rok-<num>")
   ```
3. **Re-spawn the dev teammate** with the Playwright failure details
4. When dev completes fixes -> **re-run from 6b** (CI -> push -> deploy -> Playwright)
5. QA test cases do NOT need to be regenerated — they remain valid. Only Playwright re-runs.
6. Repeat until Playwright passes

**Cost control:** If the Playwright rework loop exceeds 3 iterations, message the operator and ask whether to continue or skip Playwright.

### Skip Playwright (non-UI stories)

For stories skipped, note it in the "In Review" comment posted via Sprint Planner.

## 6e.5. UX Reviewer Gate (UI stories with mockups only)

If the story has UI changes AND design mockups exist, spawn the UX Reviewer:

```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "ux-rok-<num>", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/ux-reviewer.md>)
```

Wait for verdict. If the UX Reviewer flags issues, route back to dev for fixes.

## 6f. Shut Down Dev Teammate

Once Playwright passes (or is skipped) and UX review passes (or is skipped), the dev agent for this story has no more work. **Shut it down immediately** to stop burning tokens:

```
SendMessage(type: "shutdown_request", recipient: "dev-rok-<num>")
```

## 6g. Update Linear -> "In Review" (ONLY after all gates pass)

**This is the ONLY place where Linear is updated to "In Review". Do NOT update Linear earlier.**

Route through the Sprint Planner:

```
SendMessage(type: "message", recipient: "sprint-planner",
  content: "QUEUE_UPDATE: { action: 'update_status', issue: 'ROK-XXX', state: 'In Review', priority: 'immediate' }",
  summary: "Set ROK-XXX to In Review")

SendMessage(type: "message", recipient: "sprint-planner",
  content: "QUEUE_UPDATE: { action: 'create_comment', issue: 'ROK-XXX', body: 'Implementation + tests complete. CI passing. Branch pushed. Playwright tests passing.\nQA test cases and Playwright results posted above.\nTest locally with: deploy_dev.sh --branch rok-<num>-<short-name>', priority: 'immediate' }",
  summary: "Post In Review comment for ROK-XXX")
```

**The operator uses Linear "In Review" to know what needs testing. This is NOT optional.**

## 6h. Review Tasks Stay Blocked

Review tasks remain blocked until the operator tests locally and moves the story to "Code Review" status in Linear. The lead unblocks and spawns review agents in Step 7c after polling detects operator approval.

## 6i. Notify Operator (after all batch stories reach "In Review")

Once ALL stories in the current batch have passed all gates and been moved to "In Review", **notify the operator**.

Ensure the last story's feature branch is deployed locally:

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

**Do NOT ask the operator for test results in the terminal. The operator communicates results by updating Linear statuses. The Sprint Planner polls Linear to detect changes.**

---

## FULL STOP — DO NOT PROCEED PAST THIS POINT

**Step 6 is COMPLETE. You MUST now WAIT for the operator.**

Do NOT:
- Create pull requests (PRs are created in Step 8 AFTER code review)
- Spawn review agents (reviews happen in Step 7c AFTER operator approves)
- Move stories to "Done" or "Code Review" (the OPERATOR controls these transitions)
- Skip ahead to Step 7b/7c/8 without the Sprint Planner confirming status changes

The ONLY thing you do now is **ask the Sprint Planner to poll** (Step 7a) and wait for the operator to move stories out of "In Review". The operator is the gate — you cannot proceed without their approval.

**Creating a PR with auto-merge before operator testing and code review causes unreviewed code to ship to main. This is a critical error.**
