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
| `api/src/drizzle/migrations/**` | Full CI + migration validation (`validate-migrations.sh`) |
| `Dockerfile*`, `docker-entrypoint*`, `nginx/` | Full CI + container startup validation |
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

## Steps 4–7: CI Checks (unified via validate-ci.sh)

If Step 1.5 determined "docs-only" → skip steps 4–8, jump to Step 9.

### Steps 4–7: Build, Typecheck, Lint, Tests, Migration & Container Validation

Run the unified validation script. It handles build, typecheck, lint, unit tests with coverage, integration tests, and conditionally runs migration validation and container startup checks based on changed files.

```bash
./scripts/validate-ci.sh --full
```

**STOP** and fix any failures before continuing. **NEVER dismiss failures as "pre-existing"** — investigate and fix them, or create a Linear story with root cause.

The script auto-detects scope (migration files, Dockerfile changes) and runs the appropriate conditional checks. You do NOT need to manually decide which checks to run — the script handles it.

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

## Step 11: Enable Auto-Merge

**Always enable auto-merge (squash) after creating or pushing to a PR** — this is a project convention from CLAUDE.md.

```bash
gh pr merge $(git branch --show-current) --auto --squash
```

This is safe to run whether the PR was just created or already existed — it's a no-op if already enabled.

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
| Integration tests (api) | ✓ <count> passed / skipped | <reason if skipped> |
| Coverage (api) | ✓ N% / skipped | <reason if skipped> |
| Coverage (web) | ✓ N% / skipped | <reason if skipped> |
| Migration validation | ✓ / skipped | no migration files changed |
| Container startup | ✓ / skipped | no Dockerfile changes |
| Playwright | ✓ / skipped | <reason if skipped> |
| Push | ✓ origin/<branch> | |
| PR | #<number> / existing / skipped | |
```
