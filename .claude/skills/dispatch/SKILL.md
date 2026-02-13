---
name: dispatch
description: "Pull ready stories from Linear (Todo + Changes Requested), plan under-specced stories, spawn parallel subagents"
argument-hint: "[ROK-XXX | rework | todo | all]"
---

# Dispatch — Parallel Agent Orchestrator

Pulls dispatchable stories from Linear, plans under-specced stories via Plan agents, presents everything for user approval, and spawns parallel implementation agents. Handles both **new work** (Todo) and **rework** (Changes Requested).

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

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

### Conflict Analysis:
From ALL stories (rework + ready + planned), identify parallel-safe lanes:

1. Identify **primary file areas** per story:
   - `api/src/<module>/` — which backend modules
   - `web/src/pages/` — which pages
   - `web/src/components/` — which component directories
   - `packages/contract/` — contract changes
   - Shared files: `App.tsx`, `admin-sidebar.tsx`, router config

2. Flag conflicts: two stories touching the same files cannot run in parallel.

3. Group into **parallel-safe lanes**.

---

## Step 6: Confirm Dispatch

Ask the user:
- **Dispatch all** — spawn agents for all stories in the planned lanes
- **Select** — let user pick which stories to dispatch
- **Skip** — don't dispatch, just show the summary

---

## Step 7: Spawn Implementation Agents

### For Rework stories, use this prompt template:

```
You are working on the Raid Ledger project at /Users/sdodge/Documents/Projects/Raid-Ledger.
Read CLAUDE.md for project conventions.

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
1. Create branch: `git checkout -b <rok-xxx>-rework main`
2. Make changes to address ALL feedback items
3. Verify: `npx tsc --noEmit -p api/tsconfig.json` and/or `npx tsc --noEmit -p web/tsconfig.json`
4. Commit with message: `fix: <description> (ROK-XXX)`
5. **STOP HERE — do NOT merge to main.** Leave the branch as-is.
6. Output a summary with: branch name, commit SHA, files changed, what was done.
   A separate review agent will handle merge and Linear updates.
```

### For New Work stories (Ready — had full spec), use this prompt template:

```
You are working on the Raid Ledger project at /Users/sdodge/Documents/Projects/Raid-Ledger.
Read CLAUDE.md for project conventions.

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
1. Create branch: `git checkout -b rok-<number>-<short-name> main`
2. Implement all acceptance criteria
3. Verify: `npx tsc --noEmit -p api/tsconfig.json` and/or `npx tsc --noEmit -p web/tsconfig.json`
4. Run `npm run lint -w api` and/or `npm run lint -w web` — fix any issues in files you touched
5. Commit with message: `feat: <description> (ROK-XXX)` (or `fix:` for bug fixes)
6. **STOP HERE — do NOT merge to main.** Leave the branch as-is.
7. Output a summary with: branch name, commit SHA, files changed, what was done.
   A separate review agent will handle merge and Linear updates.
```

### For New Work stories (Planned — enriched by Plan agent), use this prompt template:

The Plan agent already asked the user all clarifying questions and resolved ambiguities.
The implementation agent gets a **clean, fully-resolved plan** with zero gaps. Its context
is fresh — no planning baggage, just the plan + spec + instructions.

```
You are working on the Raid Ledger project at /Users/sdodge/Documents/Projects/Raid-Ledger.
Read CLAUDE.md for project conventions.

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
1. Create branch: `git checkout -b rok-<number>-<short-name> main`
2. Implement all acceptance criteria following the plan's step order
3. Verify: `npx tsc --noEmit -p api/tsconfig.json` and/or `npx tsc --noEmit -p web/tsconfig.json`
4. Run `npm run lint -w api` and/or `npm run lint -w web` — fix any issues in files you touched
5. Commit with message: `feat: <description> (ROK-XXX)` (or `fix:` for bug fixes)
6. **STOP HERE — do NOT merge to main.** Leave the branch as-is.
7. Output a summary with: branch name, commit SHA, files changed, what was done.
   A separate review agent will handle merge and Linear updates.
```

### Dispatch Rules

- Stories in the **same lane** are dispatched to a **single agent** that handles them sequentially.
- Stories in **different lanes** are dispatched to **separate agents** running in parallel.
- Use `run_in_background: true` for all agents.
- Each agent prompt includes ALL stories assigned to its lane.

---

## Step 8: Report

After dispatching implementation agents, show:

```
## Agents Dispatched

| Lane | Stories | Agent | Type | Planning |
|------|---------|-------|------|----------|
| 1 | ROK-XXX | <agent_id> | New Work | Pre-planned |
| 2 | ROK-YYY | <agent_id> | Rework | N/A |
| 3 | ROK-AAA, ROK-BBB | <agent_id> | New Work | Ready (full spec) |

Agents will commit on feature branches. Review agents will be spawned after completion.
```

---

## Step 9: Review Gate

When an implementation agent completes, the orchestrator spawns a **review subagent** for its branch. The review agent has fresh context — it hasn't seen the implementation and approaches the code with no assumptions.

**Spawn one review agent per completed implementation agent**, using `run_in_background: true`.

### Review Agent Prompt Template:

```
You are a CODE REVIEW agent for the Raid Ledger project at
/Users/sdodge/Documents/Projects/Raid-Ledger.

Read CLAUDE.md for project conventions and architecture.

## Review: <ROK-XXX> — <title>

An implementation agent has completed work on branch `<branch-name>`.
Your job is to review the changes, fix any issues, then merge to main.

### What was implemented
<paste the implementation agent's completion summary here>

### Review Checklist

Run these checks and FIX any issues you find (commit fixes to the same branch):

#### 1. Compilation & Lint
- Run `npx tsc --noEmit -p api/tsconfig.json` (if backend changes)
- Run `npx tsc --noEmit -p web/tsconfig.json` (if frontend changes)
- Run `npm run lint -w api` and/or `npm run lint -w web`
- Fix ALL errors in files touched by this branch

#### 2. Code Quality
- Read every changed file (`git diff main...<branch-name>`)
- Check for `any` types that slipped through
- Check for unused imports, dead code, unreachable branches
- Check for hardcoded values that should be configurable
- Check for missing error handling on API calls or DB operations
- Verify naming conventions: files kebab-case, classes PascalCase, vars camelCase, DB snake_case

#### 3. Security
- Check for unvalidated user input (missing Zod validation)
- Check for missing auth guards on new endpoints
- Check for SQL injection vectors (raw queries, string interpolation in SQL)
- Check for XSS vectors (dangerouslySetInnerHTML, unescaped user content)
- Check for secrets or credentials in committed code

#### 4. Pattern Consistency
- Do new components follow existing patterns in the codebase?
- Are hooks, services, and controllers structured like their neighbors?
- Are new routes registered correctly in App.tsx?
- Are new Zod schemas in the contract package (not duplicated locally)?
- Are new DB schemas using Drizzle conventions?

#### 5. Tests
- Run relevant tests: `npm run test -w api` and/or `npm run test -w web`
- If tests fail on code from this branch, fix them
- Pre-existing test failures in unrelated files can be noted but not fixed

#### 6. Edge Cases
- Are loading/empty/error states handled in new UI components?
- Are new API endpoints returning consistent error responses?
- Are nullable fields handled properly (no unchecked .property access)?

### Fix Protocol
- For each issue found: fix it directly, don't just report it
- Commit fixes with message: `review: <description> (ROK-XXX)`
- If a fix is ambiguous or would change the feature's behavior, use AskUserQuestion
  to ask the user before making the change

### After Review
1. If fixes were made, verify compilation + lint again after your changes
2. Merge to main: `git checkout main && git merge <branch-name> && git branch -d <branch-name>`
3. Update Linear:
   - Add comment with implementation summary (key files, ALL commit SHAs, notable decisions)
   - Include a "Review Findings" section listing what was fixed
   - Move status to "In Review"
   Issue ID: <issue_id>
4. Output: merge commit SHA, number of review fixes made, summary
```

### Review Dispatch Rules

- Spawn review agents **as implementation agents complete** — don't wait for all to finish
- Each review agent handles one branch (one story or one lane's stories)
- Review agents run in background with `run_in_background: true`
- If the review agent finds zero issues, it still merges and updates Linear

---

## Step 10: Final Summary

After ALL review agents complete, show:

```
## Dispatch Complete

| Story | Impl Agent | Review Agent | Branch | Commits | Review Fixes | Status |
|-------|-----------|-------------|--------|---------|-------------|--------|
| ROK-XXX | <id> | <id> | merged | SHA1, SHA2 | N fixes | In Review |

Run `deploy_dev.sh --rebuild` to test all changes.
```
