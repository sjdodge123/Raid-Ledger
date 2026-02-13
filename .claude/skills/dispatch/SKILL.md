---
name: dispatch
description: "Pull ready stories from Linear (Todo + Changes Requested), plan under-specced stories, spawn parallel dev agents via Agent Teams"
argument-hint: "[ROK-XXX | rework | todo | all]"
---

# Dispatch — Parallel Agent Teams Orchestrator

Pulls dispatchable stories from Linear, plans under-specced stories via Plan agents, presents everything for user approval, and spawns implementation agents **in parallel via Agent Teams and git worktrees**. Handles both **new work** (Todo) and **rework** (Changes Requested).

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

---

## Parallel Execution via Agent Teams

Dev agents run **in parallel**, each in its own git worktree (sibling directory). This eliminates branch switching, stash contamination, and wrong-branch commits.

**Architecture:**
```
Lead (main worktree — orchestrates, creates PRs, syncs Linear)
  ├─ Dev Teammate 1 (worktree ../Raid-Ledger--rok-XXX)
  ├─ Dev Teammate 2 (worktree ../Raid-Ledger--rok-YYY)
  └─ Reviewer Teammate (main worktree — code-reviews PRs)
```

**Concurrency limit:** Max 2-3 dev teammates per batch.

**What CAN run in parallel:**
- Dev agents on stories with **no file overlap** (different domains, separate modules)
- Planning agents (read-only — no git writes, no file edits)
- Research agents (read-only — web searches, file reads, analysis)
- The reviewer teammate (reads PRs via `gh`, doesn't edit files)

**What MUST be serialized (separate batches):**
- Stories modifying `packages/contract/` (shared dependency — all consumers must rebuild)
- Stories generating database migrations (migration number collision)
- Stories touching the same files (merge conflict risk)

**The dispatch flow is:** plan in parallel → present batch → create worktrees → spawn parallel team → lead manages PR pipeline → reviewer reviews → merge approved PRs.

---

## Step 1: Gather Stories

Route based on `$ARGUMENTS`:

- **`ROK-XXX`** (specific story ID) → fetch that single issue, regardless of status
- **`rework`** → fetch only "Changes Requested" stories
- **`todo`** → fetch only "Dispatch Ready" stories
- **`all`** or **no arguments** → fetch both "Dispatch Ready" AND "Changes Requested" stories

```
mcp__linear__list_issues(project: "Raid Ledger", state: "Dispatch Ready")
mcp__linear__list_issues(project: "Raid Ledger", state: "Changes Requested")
```

Run both calls in parallel. Combine results into a single list grouped by type:
- **Rework** = Changes Requested items (need review feedback)
- **New Work** = Dispatch Ready items (need full implementation)

If no stories found in either category, report "No dispatchable stories" and stop.

---

## Step 2: Enrich Stories

### For Rework stories (Changes Requested):

Fetch comments in parallel for each:
```
mcp__linear__list_comments(issueId: <issue.id>)
```

Identify **review feedback** — comments posted AFTER the most recent agent summary comment (agent summaries contain "## Implementation Summary" or "## Review Feedback Addressed" or "Commit:" patterns).

If there are screenshots in feedback comments (markdown image links), describe what the reviewer is pointing out based on surrounding text.

### For New Work stories (Todo):

The Linear issue description IS the spec. Extract:
- Title and priority
- Acceptance criteria count
- Key files mentioned in technical approach (if any)
- Dependencies on other stories (if mentioned)

---

## Step 3: Assess Spec Readiness

For each **New Work** story, evaluate whether the Linear description is **implementation-ready**:

**Ready** (can dispatch directly) — story has ALL of:
- [ ] Clear acceptance criteria with specific, testable conditions
- [ ] Technical approach section identifying files to create/modify
- [ ] Enough detail that an agent won't need to guess on design decisions

**Needs Planning** — story is missing ANY of:
- No technical approach / files to modify
- Vague ACs like "should work well" or "good UX"
- Missing details: no color values, no component names, no API shape
- Ambiguous scope: unclear what's in vs out
- Complex feature with multiple possible implementation approaches

**Rework stories are always "Ready"** — they have existing code + specific feedback.

Classify each story and report the assessment.

---

## Step 4: Plan Under-Specced Stories

For each story classified as **Needs Planning**, spawn a **Plan subagent** in parallel.

Plan agents are **autonomous** — they explore the codebase, identify gaps, and **ask the user directly** via `AskUserQuestion` (questions bubble up to the terminal). The orchestrator does NOT mediate questions. This keeps the orchestrator context lightweight.

Spawn all Plan agents in parallel using `run_in_background: true`:

```
Task(subagent_type: "general-purpose", run_in_background: true, prompt: <see template below>)
```

**Why `general-purpose` not `Plan`?** Plan agents need `AskUserQuestion` to resolve spec gaps autonomously. The `Plan` subagent type cannot ask questions. Use `general-purpose` with explicit instructions not to write code.

### Plan Agent Prompt Template:

```
You are a PLANNING agent for the Raid Ledger project at
/Users/sdodge/Documents/Projects/Raid-Ledger.

Read CLAUDE.md for project conventions and architecture.

## Story: <ROK-XXX> — <title>

### Current Spec (from Linear)
<paste the full Linear issue description>

## YOUR ROLE: Plan only. Do NOT write code, create files, or edit files.

### Phase 1: Explore the Codebase

Research thoroughly before planning:
- Read 2-3 similar existing modules/components to understand patterns
- Identify the exact files that will need to be created or modified
- Find shared utilities, hooks, or services this story should reuse
- Check for potential conflicts with common shared files (App.tsx, router, sidebar, contract)

### Phase 2: Identify & Resolve Spec Gaps

If ANYTHING in the spec is ambiguous or missing, use the `AskUserQuestion` tool
to ask the user IMMEDIATELY. Do not defer questions — resolve them now so the
implementation agent has zero ambiguity. Common gaps to check:

- UI: colors, sizes, spacing, animations, mobile behavior
- API: request/response DTOs, endpoint paths, auth requirements
- State: data flow, cache invalidation, optimistic updates
- Edge cases: error states, empty states, loading states
- Scope: what's in vs out, what can be deferred

### Phase 3: Produce the Implementation Plan

After all questions are resolved, output the plan in this EXACT format:

## Implementation Plan: ROK-XXX

### Summary
<1-2 sentence overview of what will be built>

### Files to Create
- `path/to/new-file.ts` — purpose and what it contains

### Files to Modify
- `path/to/existing-file.ts:NN` — what changes and why (reference line numbers)

### Shared Files (potential conflicts with other agents)
- `web/src/App.tsx` — adding route for /path
- `packages/contract/src/...` — adding XxxSchema

### Implementation Steps (ordered by dependency)
1. Step 1 — specific action with file paths
2. Step 2 — ...

### Contract Changes
- New Zod schemas: XxxSchema, YyySchema
- Existing schemas to extend: ZzzSchema (add field)
- Or: "None"

### Database Changes
- New table: `table_name` with columns [...]
- Migration needed: yes/no
- Or: "None"

### User Clarifications Received
- Q: <question asked> → A: <user's answer>
- Or: "No questions needed — spec was complete"

### Estimated Scope
- Files: ~N new, ~M modified
- Complexity: low / medium / high
```

**Wait for all Plan agents to complete** before proceeding to Step 5. Check on them with `TaskOutput`.

---

## Step 5: Collect Plans & Present Dispatch Summary

Collect the output from each Plan agent. Each returns an Implementation Plan.

### Present the full dispatch plan to the user:

```
## Dispatch Plan — N stories (X rework, Y new)

### Rework (Changes Requested)
| Story | Title | Feedback Summary |
|-------|-------|-----------------|
| ROK-XXX | <title> | <1-2 line summary> |

### New Work — Ready (full spec, no planning needed)
| Story | Pri | Title | Key Files |
|-------|-----|-------|-----------|
| ROK-XXX | P1 | <title> | <primary files from spec> |

### New Work — Planned (spec enriched by Plan agent)
| Story | Pri | Title | Scope | Questions Resolved |
|-------|-----|-------|-------|--------------------|
| ROK-XXX | P1 | <title> | ~N files | <count or "none"> |
```

### Show each plan's key details:
For each planned story, display a condensed version:
- Files to create/modify (list)
- Shared files (conflict flags)
- User clarifications received
- Estimated complexity

### Parallel Batch Assignment:

Group stories into parallel batches (computed here — no `/init` required):

1. **Contract/migration stories first** — run alone in batch 0
2. **Non-overlapping stories** — group into parallel batches (max 2-3 per batch)
3. **Overlapping stories** — separate batches, ordered by priority

```
=== Parallel Batches ===
Batch 1 (parallel):
  ROK-XXX (P1, rework) — [events]
  ROK-YYY (P1, new) — [theme]
  No file overlap ✅

Batch 2 (after batch 1):
  ROK-ZZZ (P1, new) — [events, db-schema] — needs migration
```

Present the proposed batch plan to the user.

---

## Step 6: Confirm Dispatch

Ask the user:
- **Dispatch all** — run all batches in order (stories within each batch run in parallel)
- **Select** — let user pick which stories/batches to dispatch
- **Skip** — don't dispatch, just show the summary

---

## Step 7: Parallel Dispatch (Agent Teams)

Process stories in the confirmed batch order. For each batch:

### 7a. Setup Infrastructure

1. **Reset staging branch:**
   ```bash
   git checkout staging && git reset --hard main && git push --force origin staging
   git checkout main
   ```

2. **Create worktrees** for each story in the batch:
   ```bash
   git worktree add ../Raid-Ledger--rok-<num> -b rok-<num>-<short-name> main
   ```

3. **Install dependencies** in each worktree:
   ```bash
   cd ../Raid-Ledger--rok-<num> && npm install --legacy-peer-deps && npm run build -w packages/contract
   ```

### 7b. Create Agent Team

```
TeamCreate(team_name: "dispatch-batch-N")
```

Create tasks in the shared task list:
- One **implementation task** per story (assigned to dev teammates)
- One **review task** per story (blocked by implementation, assigned later to reviewer)

### 7c. Spawn Dev Teammates

Spawn one dev teammate per story in the batch using:
```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "dev-rok-<num>", mode: "bypassPermissions",
     prompt: <implementation prompt — see templates below>)
```

### 7d. Spawn Reviewer Teammate

Spawn one reviewer teammate for the batch:
```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "reviewer", model: "sonnet",
     prompt: <reviewer prompt — see template below>)
```

### 7e. Lead Enters Delegate Mode

After spawning all teammates, the lead:
1. Tells the operator which stories are running and in which worktrees
2. Remains available to answer teammate questions (via SendMessage)
3. Monitors teammate progress via task list and messages
4. Does NOT block on TaskOutput — stay responsive to the operator

---

## Step 8: PR + Staging Pipeline (as teammates complete)

**⚠️ This step is EVENT-DRIVEN, not sequential. The lead reacts to messages from teammates — it does NOT synchronously wait or block on any agent. Stay responsive to the operator and other teammates at all times.**

### 8a. When a Dev Teammate Completes → Spawn Test Agent

When a dev teammate messages the lead that their story is complete:

1. **Spawn a test agent as a teammate** (non-blocking — do NOT wait):
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "test-rok-<num>", model: "sonnet", mode: "bypassPermissions",
        prompt: <test agent prompt — see template below>)
   ```
2. **Immediately return to delegate mode** — handle other messages, respond to the operator
3. The test agent runs independently in the dev's worktree, writes tests, and messages the lead when done

### 8b. When a Test Agent Completes → Push + PR + Linear (ATOMIC)

When a test agent messages the lead that tests are written and passing, **then** proceed with the PR pipeline. These actions happen together, in order:

**1. Push and create PR:**
```bash
git push -u origin rok-<num>-<short-name>

gh pr create \
  --title "ROK-<num>: <story title>" \
  --body "$(cat <<'EOF'
## Summary
<1-3 bullet points from implementation>

## Story
[ROK-<num>](https://linear.app/roknuas-projects/issue/ROK-<num>)

## Changes
- <key files changed>

## Test Plan
- [ ] TypeScript compiles clean
- [ ] Lint passes
- [ ] Unit tests pass
- [ ] Manual smoke test on staging

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" \
  --base main \
  --head rok-<num>-<short-name>
```

**2. Update Linear IMMEDIATELY (MANDATORY — do not defer):**
```
mcp__linear__update_issue(id: <issue_id>, state: "In Review")
mcp__linear__create_comment(issueId: <issue_id>, body: "PR created: <PR URL>\nMerged to staging for manual testing.")
```

**⚠️ The operator uses Linear "In Review" to know what's on staging and needs testing. If Linear isn't updated, the operator has no visibility into what changed. This is NOT optional.**

**3. Spawn QA Test Case Agent (runs in background — do not wait):**

Spawn a Sonnet agent to generate manual testing steps and post them to Linear:
```
Task(subagent_type: "general-purpose", model: "sonnet", run_in_background: true,
     prompt: <QA test case prompt — see template below>)
```

This runs in the background while other stories are being processed. It posts a testing checklist as a Linear comment so the operator sees it when they open the story.

**4. Merge to staging:**
```bash
git checkout staging
git merge rok-<num>-<short-name>
git push origin staging
```

**⚠️ Do NOT checkout main yet — stay on staging until deploy is complete (Step 8e).**

### 8c. Shut Down Dev + Test Teammates for This Story

Once the PR is created, the dev and test agents for this story have no more work. **Shut them down immediately** to stop burning tokens:

```
SendMessage(type: "shutdown_request", recipient: "dev-rok-<num>")
SendMessage(type: "shutdown_request", recipient: "test-rok-<num>")
```

Do NOT wait until batch completion — shut them down as soon as their PR is pushed.

### 8d. Unblock Review Task

Update the review task in the shared task list (remove blocker so reviewer can claim it).

### 8e. Auto-Deploy Staging (after all batch stories have PRs)

Once ALL stories in the current batch have PRs created, Linear updated, and staging merged, **automatically deploy from the staging branch** — do NOT ask the operator:

**⚠️ CRITICAL: You MUST be on the `staging` branch when deploying for operator testing. Deploying from `main` will NOT include the PR changes — the operator will test stale code and waste time. This was a real bug — do not repeat it.**

```bash
git checkout staging    # Ensure you are on staging — NOT main
./scripts/deploy_dev.sh --rebuild
git checkout main       # Return to main ONLY AFTER deploy starts
```

### 8f. Spawn Playwright Testing Agent (non-blocking)

After staging is deployed, spawn a Playwright testing agent as a teammate to run automated browser tests and capture screenshots for operator review:

```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "playwright-tester", model: "sonnet", mode: "bypassPermissions",
     prompt: <playwright testing agent prompt — see template below>)
```

The Playwright agent runs independently — do NOT wait for it. It will:
1. Navigate the staging app using Playwright MCP tools
2. Test each story's acceptance criteria in the browser
3. Capture screenshots at key states
4. Post results + screenshots to each story in Linear
5. Message the lead with a summary

### 8g. Notify Operator

**Notify the operator — do NOT ask for test results in the terminal:**

```
## Batch N — Staging Deployed
All N stories are on staging at localhost:5173.
All stories moved to "In Review" in Linear.

Automated Playwright tests are running — results and screenshots will be
posted to each story in Linear shortly.

Ready for testing:
- ROK-XXX: PR #<num> — <title> (Linear: In Review ✓)
- ROK-YYY: PR #<num> — <title> (Linear: In Review ✓)

Testing checklists have been posted to each story in Linear.
Test each story on staging. Update each story's status in Linear when done:
  → "Code Review" = testing passed, ready for code review agent
  → "Changes Requested" (add comments explaining issues) = testing failed
```

**⚠️ Do NOT ask the operator for test results in the terminal. The operator communicates results by updating Linear statuses. Poll Linear to detect when they're done.**

---

## Step 9: Status-Driven Review Pipeline

The operator controls the testing gate by moving stories in Linear. The lead polls Linear and reacts — **it does NOT ask the operator for results in the terminal.**

### 9a. Poll Linear for Status Changes

The operator tests on staging and updates Linear:
- **"Code Review"** = operator approved, ready for code review agent
- **"Changes Requested"** (with comments) = operator found issues

The lead polls Linear to detect changes:
```
mcp__linear__list_issues(project: "Raid Ledger", state: "Code Review")
mcp__linear__list_issues(project: "Raid Ledger", state: "Changes Requested")
```

Process any stories that have changed status. Stories still in "In Review" haven't been tested yet — leave them alone.

### 9b. Handle Changes Requested (from operator testing)

For stories the operator moved to "Changes Requested":
1. Fetch comments to get the operator's feedback: `mcp__linear__list_comments(issueId: <id>)`
2. **Re-spawn the dev teammate** (it was shut down after PR creation in Step 8c):
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "dev-rok-<num>", mode: "bypassPermissions",
        prompt: <rework prompt with operator feedback>)
   ```
3. Dev teammate fixes in its worktree, **including updating any unit tests affected by the code changes**, commits
4. Dev teammate runs all tests to verify they pass, messages lead when done
5. **Shut down dev teammate** after fixes are committed
6. Lead pushes updated branch: `git push origin rok-<num>-<short-name>`
7. Lead re-merges to staging and deploys **from staging**:
   ```bash
   git checkout staging
   git merge rok-<num>-<short-name>
   git push origin staging
   ./scripts/deploy_dev.sh --rebuild
   git checkout main
   ```
8. Lead moves Linear back to "In Review"
9. Notify operator: "ROK-XXX fixed and re-deployed to staging for re-test"

### 9c. Dispatch Code Review (for "Code Review" stories)

For stories the operator moved to "Code Review", dispatch the reviewer teammate:
1. Unblock the review tasks in the shared task list
2. Reviewer claims tasks and for each PR:
   - Runs `gh pr diff <number>`
   - Checks: TypeScript strictness, Zod validation, security, error handling, patterns, naming
   - Posts: `gh pr review <number> --approve` or `--request-changes --body "..."`
   - Messages the lead with verdict

---

## Step 10: Handle Code Review Outcomes

### If reviewer approves:

1. Lead merges PR:
   ```bash
   gh pr merge <number> --merge --delete-branch
   ```
2. Lead updates Linear → "Done", posts summary comment:
   - Key files changed, commit SHA(s), PR number
   - Notable decisions or deviations
3. Lead removes worktree:
   ```bash
   git worktree remove ../Raid-Ledger--rok-<num>
   ```
4. Report progress:
   ```
   ## [N/total] ROK-XXX — <title> ✓
   PR: #<num> merged to main | Commits: SHA1, SHA2
   ```

### If reviewer requests changes:

1. Lead updates Linear → "Changes Requested"
2. **Re-spawn the dev teammate** (it was shut down after PR creation in Step 8c):
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "dev-rok-<num>", mode: "bypassPermissions",
        prompt: <rework prompt with reviewer feedback>)
   ```
3. Dev teammate fixes in its worktree, **including updating any unit tests affected by the code changes**, commits
4. Dev teammate runs all tests to verify they pass, messages lead when done
5. **Shut down dev teammate** after fixes are committed
6. Lead pushes updated branch: `git push origin rok-<num>-<short-name>`
7. Lead re-merges to staging and deploys **from staging**:
   ```bash
   git checkout staging
   git merge rok-<num>-<short-name>
   git push origin staging
   ./scripts/deploy_dev.sh --rebuild
   git checkout main
   ```
8. Lead moves Linear → "In Review"
9. Notify operator: "ROK-XXX has reviewer fixes re-deployed to staging for re-test"
10. Cycle repeats from Step 9a (operator re-tests)

---

## Step 11: Batch Completion + Next Batch

After all stories in a batch are merged (or deferred):

1. **Shut down remaining teammates** (dev + test agents were already shut down in Step 8c):
   ```
   SendMessage(type: "shutdown_request", recipient: "reviewer")
   SendMessage(type: "shutdown_request", recipient: "playwright-tester")
   ```

2. **Clean up team:**
   ```
   TeamDelete()
   ```

3. **If more batches remain:**
   - **Auto-deploy main** (merged PRs are now on main):
     ```bash
     ./scripts/deploy_dev.sh --rebuild
     ```
   - **Pause and present next batch:**
     ```
     ## Batch N complete — N stories merged to main
     Deployed to localhost:5173 for verification.

     Next batch (N stories):
     - ROK-XXX: <title> — [domains]
     - ROK-YYY: <title> — [domains]

     Say "next" to dispatch the next batch, or "stop" to end dispatch.
     ```
   - **WAIT for operator response** before starting the next batch
   - On "next" → Go back to Step 7a for the next batch
   - On "stop" → Proceed to Step 12

4. **If all batches done:** Proceed to Step 12

---

## Step 12: Final Summary

After ALL batches have completed:

```
## Dispatch Complete — N stories across M batches

| Batch | Story | Dev Agent | PR | Review | Status |
|-------|-------|-----------|-----|--------|--------|
| 1 | ROK-XXX | dev-rok-xxx | #1 | approved | Done |
| 1 | ROK-YYY | dev-rok-yyy | #2 | approved | Done |
| 2 | ROK-ZZZ | dev-rok-zzz | #3 | approved | Done |

All PRs merged to main.
Staging reset to main.
Run `deploy_dev.sh --rebuild` to test all changes.
```

---

## Implementation Agent Prompt Templates

### For Rework stories (Changes Requested):

```
You are a dev teammate working on the Raid Ledger project.
Your worktree is at <WORKTREE_PATH>.
Read <WORKTREE_PATH>/CLAUDE.md for project conventions.

## Task: <ROK-XXX> — Review Feedback Fixes

The reviewer has requested changes on this story. Address ALL of the following feedback:

### Feedback
<paste the reviewer's feedback bullets here>

### Context
<paste relevant details: what the story is about, what was already implemented, key files>

### Guidelines
- If any feedback is AMBIGUOUS or you're unsure how to implement it, use the
  AskUserQuestion tool to ask the user for clarification BEFORE making changes.
  Do NOT guess on design decisions — ask.
- If the feedback mentions a screenshot/visual issue, read the relevant component
  files and look for the described problem.
- Test your changes: TypeScript clean, ESLint clean, relevant tests pass.

### Workflow
1. You are already on branch `rok-<num>-<short-name>` in your worktree
2. Make changes to address ALL feedback items
3. Verify: `npx tsc --noEmit -p api/tsconfig.json` and/or `npx tsc --noEmit -p web/tsconfig.json`
4. Commit with message: `fix: <description> (ROK-XXX)`
5. **STOP HERE — do NOT push, create PRs, or switch branches.**
6. Message the lead with: branch name, commit SHA, files changed, what was done.

### Critical Rules
- Do NOT push to remote — the lead handles all GitHub operations
- Do NOT create pull requests
- Do NOT switch branches or leave your worktree
- Do NOT access Linear — the lead handles all Linear operations
```

### For New Work stories (Ready — full spec):

```
You are a dev teammate working on the Raid Ledger project.
Your worktree is at <WORKTREE_PATH>.
Read <WORKTREE_PATH>/CLAUDE.md for project conventions.

## Task: <ROK-XXX> — <title>

Implement this story from the spec below.

### Spec
<paste the full Linear issue description here>

### Guidelines
- If ANY acceptance criteria are ambiguous or you're unsure how to implement them,
  use the AskUserQuestion tool to ask the user for clarification BEFORE writing code.
  Do NOT guess on design decisions — ask.
- Follow existing patterns in the codebase. Read similar modules/components first.
- Test your changes: TypeScript clean, ESLint clean, relevant tests pass.
- For new API endpoints: add Zod schemas to packages/contract, run `npm run build -w packages/contract` first.
- For new DB tables: use Drizzle schema + `npm run db:generate -w api` for migrations.
- For new frontend pages: add routes in App.tsx, follow existing page component patterns.

### Workflow
1. You are already on branch `rok-<num>-<short-name>` in your worktree
2. Implement all acceptance criteria
3. Verify: `npx tsc --noEmit -p api/tsconfig.json` and/or `npx tsc --noEmit -p web/tsconfig.json`
4. Run `npm run lint -w api` and/or `npm run lint -w web` — fix any issues in files you touched
5. Commit with message: `feat: <description> (ROK-XXX)` (or `fix:` for bug fixes)
6. **STOP HERE — do NOT push, create PRs, or switch branches.**
7. Message the lead with: branch name, commit SHA, files changed, what was done.

### Critical Rules
- Do NOT push to remote — the lead handles all GitHub operations
- Do NOT create pull requests
- Do NOT switch branches or leave your worktree
- Do NOT access Linear — the lead handles all Linear operations
```

### For New Work stories (Planned — enriched by Plan agent):

```
You are a dev teammate working on the Raid Ledger project.
Your worktree is at <WORKTREE_PATH>.
Read <WORKTREE_PATH>/CLAUDE.md for project conventions.

## Task: <ROK-XXX> — <title>

Implement this story using the implementation plan below. A planning agent already
explored the codebase, identified exact files and patterns, and resolved all ambiguities
with the user. Your job is to execute the plan.

### Original Spec
<paste the full Linear issue description here>

### Implementation Plan
<paste the Plan agent's FULL output here — including "User Clarifications Received">

### Guidelines
- Follow the implementation plan's file list and step order — it was built from
  actual codebase exploration, not guesses.
- If you discover something the plan missed or got wrong, adapt — but prefer the plan's
  approach unless there's a clear reason to deviate.
- If ANY remaining ambiguity exists, use the AskUserQuestion tool BEFORE writing code.
- Test your changes: TypeScript clean, ESLint clean, relevant tests pass.
- For new API endpoints: add Zod schemas to packages/contract, run `npm run build -w packages/contract` first.
- For new DB tables: use Drizzle schema + `npm run db:generate -w api` for migrations.
- For new frontend pages: add routes in App.tsx, follow existing page component patterns.

### Workflow
1. You are already on branch `rok-<num>-<short-name>` in your worktree
2. Implement all acceptance criteria following the plan's step order
3. Verify: `npx tsc --noEmit -p api/tsconfig.json` and/or `npx tsc --noEmit -p web/tsconfig.json`
4. Run `npm run lint -w api` and/or `npm run lint -w web` — fix any issues in files you touched
5. Commit with message: `feat: <description> (ROK-XXX)` (or `fix:` for bug fixes)
6. **STOP HERE — do NOT push, create PRs, or switch branches.**
7. Message the lead with: branch name, commit SHA, files changed, what was done.

### Critical Rules
- Do NOT push to remote — the lead handles all GitHub operations
- Do NOT create pull requests
- Do NOT switch branches or leave your worktree
- Do NOT access Linear — the lead handles all Linear operations
```

---

### Reviewer Teammate Prompt Template:

```
You are a code reviewer for the Raid Ledger project.
Read /Users/sdodge/Documents/Projects/Raid-Ledger/CLAUDE.md for project conventions.

Your job:
1. Claim review tasks from the task list (TaskList → TaskUpdate to claim)
2. For each PR assigned to you, run: `gh pr diff <number>`
3. Check:
   - TypeScript strictness (no `any`, proper types)
   - Zod validation (schemas in contract package, not duplicated)
   - Security (auth guards, input validation, no injection vectors)
   - Error handling (try/catch, proper error responses)
   - Pattern consistency (follows existing codebase conventions)
   - Test coverage (relevant tests exist and pass)
   - Naming conventions (files kebab-case, classes PascalCase, vars camelCase, DB snake_case)
4. Post your review:
   - If approved: `gh pr review <number> --approve --body "LGTM. <brief summary of what looks good>"`
   - If changes needed: `gh pr review <number> --request-changes --body "<specific issues found>"`
5. Message the lead with your verdict and key findings
6. Mark the review task as completed and claim the next one

You do NOT implement code. You do NOT merge PRs. You do NOT access Linear. You only review.
If no review tasks are available yet (blocked), wait for the lead to unblock them.
```

---

### QA Test Case Agent Prompt Template:

```
You are a QA test case designer for the Raid Ledger project.

## Story: <ROK-XXX> — <title>

### Story Spec
<paste the full Linear issue description — especially acceptance criteria>

### PR Diff
Run this command to see exactly what changed:
```bash
gh pr diff <PR_NUMBER>
```

### Your Job
Generate a manual testing checklist that the operator can follow to verify
this story works correctly on staging (localhost:5173).

### Guidelines
- Read the story's acceptance criteria carefully — each AC should map to at least one test step
- Read the PR diff to understand what actually changed (routes, components, API endpoints)
- Include the specific URL paths to navigate to (e.g., localhost:5173/events, localhost:5173/profile)
- Include specific actions: what to click, what to type, what to look for
- Include edge cases: empty states, error states, mobile/responsive if relevant
- Include regression checks: things that should still work after this change
- Keep it practical — these are manual smoke tests, not exhaustive QA

### Output Format
Post your testing checklist as a Linear comment using this tool:
```
mcp__linear__create_comment(issueId: "<ISSUE_ID>", body: "<your checklist>")
```

Use this format for the comment body:

## Manual Testing Checklist

### Setup
- [ ] Staging deployed at localhost:5173
- [ ] Logged in as admin (password in .env ADMIN_PASSWORD)

### Acceptance Criteria Tests
- [ ] **AC1: <description>** — Navigate to <path>, <action>, verify <expected result>
- [ ] **AC2: <description>** — <steps>

### Edge Cases
- [ ] <edge case 1> — <how to test>
- [ ] <edge case 2> — <how to test>

### Regression
- [ ] <related feature> still works after this change

---
After posting the comment, you are done. Do NOT edit any files or make any code changes.
```

---

### Test Agent Prompt Template:

```
You are a test engineer for the Raid Ledger project.
Your worktree is at <WORKTREE_PATH>.
Read <WORKTREE_PATH>/CLAUDE.md for project conventions.

## Story: <ROK-XXX> — <title>

### Story Spec
<paste the full Linear issue description — especially acceptance criteria>

### Changed Files
<list the files the dev teammate changed, from their completion message>

### Your Job
Write unit tests for the changes made by the dev teammate. You are a SEPARATE agent
from the developer — your job is to write adversarial tests that verify the implementation
is correct, handles edge cases, and doesn't break existing behavior.

### Guidelines
- Read every changed file to understand what was implemented
- Read existing test files in the same directories to follow established test patterns
- Backend tests: co-located `*.spec.ts` files, Jest, follow existing test structure
- Frontend tests: co-located `*.test.tsx` files, Vitest + React Testing Library
- Test the acceptance criteria — each AC should have at least one test
- Test edge cases: null/undefined inputs, empty arrays, boundary values, error paths
- Test error handling: what happens when things fail?
- Do NOT test implementation details (private methods, internal state) — test behavior
- Do NOT mock excessively — prefer testing real behavior over mocked behavior
- If the story adds API endpoints, test the controller/service layer
- If the story adds UI components, test rendering, user interactions, and conditional display

### Workflow
1. Read all changed files in the worktree
2. Read existing test files for patterns and conventions
3. Write test files (co-located with the source files)
4. Run tests to verify they pass:
   - Backend: `npx jest --config <WORKTREE_PATH>/api/jest.config.js -- <test_file>`
   - Frontend: `npx vitest run <WORKTREE_PATH>/web/src/<test_file>`
5. Fix any failing tests until they all pass
6. Commit with message: `test: add unit tests for <feature> (ROK-XXX)`
7. **Message the lead** with: test files created, number of tests, pass/fail status

### Critical Rules
- Do NOT modify any source code — only add/modify test files
- Do NOT push to remote
- Do NOT create pull requests
- Do NOT switch branches or leave the worktree
- All tests MUST pass before you commit
- You are a TEAMMATE — message the lead when done using SendMessage
```

---

### Playwright Testing Agent Prompt Template:

```
You are an automated QA tester for the Raid Ledger project using Playwright MCP browser automation.

## Stories to Test
<for each story in the batch, include:>
### ROK-XXX: <title>
- Linear Issue ID: <issue_id>
- PR: #<num>
- Acceptance Criteria:
  <paste ACs from the story spec>

## Your Job
Run automated browser tests against the staging deployment at http://localhost:5173.
For each story, navigate the app, verify acceptance criteria, and capture screenshots
at key states. Post your results and screenshots directly to each story in Linear.

## Setup
The app is running at http://localhost:5173.
To log in as admin, navigate to /login and use:
- Username: Admin (or check .env ADMIN_PASSWORD for the password)

## Testing Workflow

For EACH story:

1. **Navigate to the relevant pages** using Playwright MCP tools:
   - Use `mcp__playwright__browser_navigate` to go to URLs
   - Use `mcp__playwright__browser_snapshot` to read the accessibility tree
   - Use `mcp__playwright__browser_click`, `mcp__playwright__browser_type` for interactions

2. **Verify each acceptance criterion:**
   - Navigate to the page/feature the AC describes
   - Interact with the UI as a user would
   - Verify the expected behavior occurs (check for elements, text, states)

3. **Capture screenshots at key states:**
   - Before the feature interaction (baseline)
   - After the feature interaction (result)
   - Any error states or edge cases found
   - Use `mcp__playwright__browser_screenshot` to capture each screenshot
   - Save screenshots locally first, then upload to Linear

4. **Upload screenshots to Linear as attachments on the story:**
   For each screenshot captured, upload it directly to the Linear story:
   ```
   mcp__linear__create_attachment(
     issue: "<ROK-XXX>",
     base64Content: "<base64-encoded screenshot>",
     filename: "rok-XXX-<description>.png",
     contentType: "image/png",
     title: "Playwright: <what the screenshot shows>"
   )
   ```

5. **Test edge cases:**
   - Empty states (no data)
   - Error states (invalid input)
   - Responsive behavior if relevant
   - Navigation flows (back/forward)

6. **Record results** for each story:
   - PASS: AC verified, screenshot attached
   - FAIL: AC not met, screenshot of actual behavior attached
   - BLOCKED: Could not test (explain why)

## Posting Results to Linear

For each story, post a summary comment AND attach screenshots:

**Screenshots:** Upload each screenshot as a Linear attachment using `mcp__linear__create_attachment`
(see step 4 above). This ensures the operator can see the screenshots directly in the Linear story.

**Summary comment:** Use `mcp__linear__create_comment` with the story's issue ID:

## Automated Playwright Test Results

### Summary
- X/Y acceptance criteria passed
- Z screenshots attached to this story

### Acceptance Criteria Results
- [x] **AC1: <description>** — PASS (screenshot: rok-XXX-ac1-result.png)
- [ ] **AC2: <description>** — FAIL
  Expected: <what should happen>
  Actual: <what actually happened>
  Screenshot: rok-XXX-ac2-actual.png

### Edge Cases Tested
- <edge case 1>: PASS/FAIL
- <edge case 2>: PASS/FAIL

### Issues Found
- <any bugs or unexpected behavior discovered>

## After posting results for ALL stories, message the lead with a summary:
- Total stories tested
- Total ACs passed/failed
- Any blocking issues or critical failures found

## Critical Rules
- Do NOT modify any code or files
- Do NOT push to remote or create PRs
- Do NOT switch git branches
- You are a TEAMMATE — message the lead when done using SendMessage
- If Playwright MCP tools are not available, message the lead immediately
- If the app is not running at localhost:5173, message the lead immediately
- **ALWAYS upload screenshots to Linear via mcp__linear__create_attachment** — do not just save them locally
```
