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

When a dev teammate messages the lead that their story is complete:

### 8a. Push Branch + Create PR

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

### 8b. Merge to Staging

```bash
git checkout staging
git merge rok-<num>-<short-name>
git push origin staging
git checkout main
```

Do this for each story as its PR is created. Do NOT deploy yet — wait until all stories in the batch have PRs (Step 8e).

### 8c. Update Linear

- Move story to "In Review"
- Post comment: `PR created: <PR URL>\nMerged to staging for manual testing.`

### 8d. Unblock Review Task

Update the review task in the shared task list (remove blocker so reviewer can claim it).

### 8e. Auto-Deploy Staging (after all batch stories have PRs)

Once ALL stories in the current batch have PRs created and are merged to staging, **automatically deploy** — do NOT ask the operator:

```bash
./scripts/deploy_dev.sh --rebuild
```

Then **pause and notify the operator:**

```
## Batch N — Staging Deployed
All N stories are on staging at localhost:5173.

PRs created:
- ROK-XXX: #<num> — <title>
- ROK-YYY: #<num> — <title>

Please smoke test, then say "approved" to proceed to code review,
or report issues with specific story IDs.
```

**WAIT for operator response before proceeding.** This is the manual testing gate.

---

## Step 9: Operator Tests + Code Review

### 9a. Operator Manual Testing

The operator tests on staging (localhost:5173). They signal:
- "approved" or "looks good" → proceed to 9b for ALL stories in batch
- "ROK-XXX has issues: <description>" → lead messages dev teammate with feedback, wait for fix cycle
- "approved except ROK-XXX" → proceed to 9b for approved stories, handle ROK-XXX separately

### 9b. Reviewer Reviews PRs

The reviewer teammate claims review tasks and:
1. Runs `gh pr diff <number>` to inspect changes
2. Checks: TypeScript strictness, Zod validation, security, error handling, pattern consistency, naming conventions
3. Posts review: `gh pr review <number> --approve` or `--request-changes --body "..."`
4. Messages the lead with the verdict

---

## Step 10: Handle Review Outcomes

### If reviewer approves:

1. Lead (or operator) merges PR:
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
   Next batch: <batch info or "all done">
   ```

### If reviewer requests changes:

1. Lead updates Linear → "Changes Requested"
2. Lead messages the dev teammate with specific feedback from the review
3. Dev teammate fixes in its worktree, commits
4. Lead pushes updated branch (force-push OK since PR is open)
5. Lead re-merges to staging, notifies operator for re-test
6. Cycle repeats from Step 9

---

## Step 11: Batch Completion + Next Batch

After all stories in a batch are merged (or deferred):

1. **Shut down batch teammates:**
   ```
   SendMessage(type: "shutdown_request", recipient: "dev-rok-<num>")
   SendMessage(type: "shutdown_request", recipient: "reviewer")
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
