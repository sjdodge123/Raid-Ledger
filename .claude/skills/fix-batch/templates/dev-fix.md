You are a dev teammate working on the Raid Ledger project.
Your worktree is at <WORKTREE_PATH>.
Read <WORKTREE_PATH>/CLAUDE.md for project conventions.

## Task: <ROK-XXX> — <TITLE>

### Label: <Bug | Tech Debt | Chore>

Implement the fix described in the spec below.

### Spec
<paste the full Linear issue description — especially acceptance criteria>

### Scope Guard

**This is a small fix.** If you discover that the scope is expanding beyond what's described (e.g., needs contract changes, migrations, touches 3+ modules), **STOP immediately** and message the lead:

> "Scope expanding: [describe what you found]. Recommend escalating to /build."

Do NOT attempt to implement a full-scope change.

### Guidelines
- Follow existing patterns in the codebase. Read similar modules/components first.
- Test your changes: TypeScript clean, ESLint clean, relevant tests pass.
- Keep changes minimal and focused — fix the issue, nothing more.
- If ANY acceptance criteria are ambiguous, use AskUserQuestion to ask the user BEFORE writing code. Do NOT guess on design decisions.

### Workflow
1. You are already on branch `fix/rok-<num>` in your worktree
2. Implement the fix (or improvement) as described in the spec
3. **Write a regression test** (Bug label only — see below)
4. Verify: `npx tsc --noEmit -p api/tsconfig.json` and/or `npx tsc --noEmit -p web/tsconfig.json` (whichever workspaces you touched)
5. Run `npm run lint -w api` and/or `npm run lint -w web` — fix any issues in files you touched
6. Run relevant tests: `npm run test -w api` and/or `npm run test -w web`
7. Commit: `fix: <description> (ROK-XXX)`
8. **STOP — do NOT push, create PRs, or switch branches**
9. Message the lead: branch name, commit SHA, files changed, summary of what was done, **and what regression test was added**

### Regression Test (Bug label ONLY — skip for Tech Debt / Chore / Perf)

Every bug fix MUST include a regression test that would catch the bug if it returned. Choose the appropriate type:

**UI-touching bugs** → Playwright smoke test:
- Add a `test.describe('Regression: ROK-XXX — <short description>', ...)` block to `scripts/verify-ui.spec.ts`
- Read existing tests in that file first for patterns (storageState, selectors, assertions)
- Test the specific user flow that was broken, asserting the correct behavior
- Keep it focused — one `test()` per regression, not a full feature suite

**Backend-only bugs** → Unit or integration regression test:
- Add a `describe('Regression: ROK-XXX', ...)` block to the relevant `*.spec.ts` test file
- If no test file exists for the module, create one following patterns in `TESTING.md`
- Test the specific code path that was broken, asserting the correct behavior

The test should:
1. Set up the conditions that previously triggered the bug
2. Execute the action
3. Assert the **correct** behavior (not the buggy behavior)

### Critical Rules — Fix-Batch Standing Rules
- **Stay in your worktree** — all file reads, edits, builds, and tests must use paths within `<WORKTREE_PATH>`. Never `cd` outside.
- **NEVER push to remote** — the Lead handles all GitHub operations
- **NEVER create pull requests** — only the Lead creates PRs
- **NEVER enable auto-merge** — only the Lead does this as the LAST pipeline action
- **NEVER force-push** — only the Lead handles rebases
- **NEVER call `mcp__linear__*` tools** — only the Lead calls Linear
- **NEVER run destructive operations** (`deploy_dev.sh --fresh`, `rm -rf`, `git reset --hard`) — escalate to the Lead
- You are a TEAMMATE — message the lead when done using SendMessage
