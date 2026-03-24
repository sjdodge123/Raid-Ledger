---
name: push
description: "Pre-push checklist: full local CI, sync with main, push, and create PR"
argument-hint: "[--skip-pr]"
---

# Push — Full Local CI + Push + PR

**Goal:** Run the FULL CI pipeline locally, sync with main, push, and create/update PR. Nothing reaches origin without passing every check first.

**This skill should be used by ALL other skills (/build, /bulk, /fix-batch) when pushing to origin.** Never use raw `git push` — always invoke `/push`.

**References:** Read `CLAUDE.md` for project conventions and `TESTING.md` for test failure rules before proceeding. Test failures are NEVER dismissed as "pre-existing."

Execute every step in order. If any step fails, STOP and fix before continuing.

---

## Step 1: Verify Branch

```bash
BRANCH=$(git branch --show-current)
echo "Branch: $BRANCH"
```

**STOP** if on `main`. Never push directly to main.

---

## Step 1.5: Scope Detection — Determine Which Checks to Run

Analyze the diff against main to decide which CI steps are relevant:

```bash
git diff --name-only origin/main
```

Evaluate the changed files and classify the changeset:

| Files Changed | Checks Needed |
|---------------|---------------|
| **Only** `.claude/skills/`, `.md` files, `docs/` | **None** — skip to Step 9 (push) |
| **Only** `web/src/` (no api, no contract) | Web only: build contract + web, typecheck web, lint web, test web, Playwright |
| **Only** `api/src/` (no web, no contract) | API only: build contract + api, typecheck api, lint api, test api |
| **Only** `packages/contract/` | Contract + both: build all, typecheck all, lint all, test all |
| **Only** test files (`*.spec.ts`, `*.test.tsx`) | Tests only: run tests for affected workspace(s), skip build/lint |
| **Only** config/tooling (`.eslintrc`, `tsconfig`, `package.json`, CI workflows) | Full CI — config changes can break anything |
| **Mixed** (api + web, or contract + anything) | Full CI |

**Present your assessment** before running checks:

```
## Scope Assessment
Changed files: 3
- api/src/events/signups.service.ts
- api/src/events/signups.service.spec.ts
- web/src/pages/event-detail/EventDetailRoster.tsx

Classification: Mixed (api + web)
Checks to run: Full CI (build all, typecheck all, lint all, test all, Playwright)
```

**Rules:**
- When in doubt, run MORE checks, not fewer
- Contract changes always trigger full CI
- If a `.spec.ts` file changed, always run that workspace's tests even if only tests changed
- Never skip checks for files you're unsure about

---

## Step 2: Check for Uncommitted Changes

```bash
git status --short
```

- If there are unstaged changes that should be included → stage and commit them
- If there are untracked files that should be included → add and commit them
- If changes are intentionally uncommitted → proceed (they won't be pushed)

---

## Step 3: Sync with Latest Main

```bash
git fetch origin main && git rebase origin/main
```

**If there are rebase conflicts:**
1. Resolve them
2. `git rebase --continue`
3. **Re-run ALL checks** (steps 4-8) after resolving — the rebase may have introduced issues

---

## Steps 4–8: CI Checks (scoped by Step 1.5)

**Only run the checks identified in your scope assessment.** Skip steps that don't apply.

If Step 1.5 determined "docs-only" → skip ALL of steps 4–8, jump to Step 9.

### Step 4: Build (affected workspaces)

Build order matters — contract first, then downstream:

```bash
# Always build contract if ANY code changed (it's fast)
npm run build -w packages/contract

# Only if api files changed:
npm run build -w api

# Only if web files changed:
npm run build -w web
```

**STOP** and fix any build errors before continuing.

---

### Step 5: TypeScript (affected workspaces)

```bash
# Only if api files changed:
npx tsc --noEmit -p api/tsconfig.json

# Only if web files changed:
npx tsc --noEmit -p web/tsconfig.json
```

**STOP** and fix any type errors before continuing.

---

### Step 6: Lint (affected workspaces)

```bash
# Only if api files changed:
npm run lint -w api

# Only if web files changed:
npm run lint -w web
```

**STOP** if there are any **errors** (warnings are acceptable). Fix errors before continuing.

---

### Step 7: Tests (affected workspaces)

```bash
# Only if api files changed:
npm run test -w api

# Only if web files changed:
npm run test -w web
```

**STOP** and fix any test failures before continuing. **NEVER dismiss failures as "pre-existing"** — investigate and fix them, or create a Linear story with root cause.

**If only test files changed** (e.g., fixing a flaky test), you can skip build/typecheck/lint and just run the tests.

---

### Step 8: Playwright Smoke Tests (if UI changes)

Only if `web/src/` files changed:

```bash
# CRITICAL: Do NOT add --project=desktop. CI runs BOTH desktop AND mobile.
# Running only desktop locally and pushing will fail CI on mobile tests.
npx playwright test
```

**This runs BOTH desktop and mobile projects (~450 tests).** Takes ~3 minutes.

After Playwright passes, create the sentinel file so the pre-push hook allows `git push`:

```bash
touch "/tmp/.playwright-verified-$(git rev-parse --short HEAD)"
```

If Playwright fails:
- Check the error: "element not found" vs "strict mode" vs "timeout"
- "Strict mode" = your new DOM elements collided with selectors in OTHER test files
- New components on shared pages (Games, Events, Layout) affect tests in other files — run the FULL suite
- Fix the code or the test
- **NEVER skip and proceed**
- **NEVER re-push and re-run CI hoping it passes** — fix locally first

If the branch is API-only (no web changes), this step can be skipped.

---

## Step 9: Push

```bash
git push -u origin $(git branch --show-current)
```

If the push is rejected (remote has newer commits), pull and rebase:
```bash
git pull --rebase origin $(git branch --show-current)
git push origin $(git branch --show-current)
```

---

## Step 10: Create or Update PR

**Skip this step** if `--skip-pr` was passed as an argument.

Check if a PR already exists:

```bash
gh pr list --head $(git branch --show-current) --json number,url
```

### If no PR exists — create one:

```bash
gh pr create \
  --base main \
  --head $(git branch --show-current) \
  --title "ROK-<num>: <short description>" \
  --body "$(cat <<'PREOF'
## Summary
<1-3 bullet points>

## Linear
ROK-<num>

## Test plan
- [x] Build passes (contract + api + web)
- [x] TypeScript clean
- [x] Lint clean
- [x] Unit tests pass (api + web)
- [x] Playwright smoke tests pass (if applicable)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PREOF
)"
```

**Title format:** `ROK-<num>: <description>` — matches our Linear story convention.

### If a PR already exists:

The push in Step 9 updated it. No action needed unless the PR description needs updating.

---

## Step 11: Auto-Merge (ONLY when instructed)

**Do NOT enable auto-merge by default.** Auto-merge is a one-way door.

Only enable auto-merge when:
- The operator explicitly says to merge
- All pipeline gates have passed (operator testing, code review, smoke tests)
- This is the LAST action before the story is "Done"

```bash
gh pr merge $(git branch --show-current) --auto --squash
```

---

## Step 12: Report

Print a summary showing which checks ran and which were skipped (with reason):

```
## Push Complete

| Check | Result | Reason |
|-------|--------|--------|
| Scope | docs-only / api-only / web-only / full | <file count> files changed |
| Build | ✓ / skipped | <reason if skipped> |
| TypeScript | ✓ / skipped | <reason if skipped> |
| Lint | ✓ / skipped | <reason if skipped> |
| Tests (api) | ✓ <count> passed / skipped | <reason if skipped> |
| Tests (web) | ✓ <count> passed / skipped | <reason if skipped> |
| Playwright | ✓ / skipped | <reason if skipped> |
| Push | ✓ origin/<branch> | |
| PR | #<number> / existing / skipped | |
```
