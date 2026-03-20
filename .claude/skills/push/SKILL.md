---
name: push
description: "Pre-push checklist: full local CI, sync with main, push, and create PR"
argument-hint: "[--skip-pr]"
---

# Push — Full Local CI + Push + PR

**Goal:** Run the FULL CI pipeline locally, sync with main, push, and create/update PR. Nothing reaches origin without passing every check first.

**This skill should be used by ALL other skills (/build, /bulk, /fix-batch) when pushing to origin.** Never use raw `git push` — always invoke `/push`.

Execute every step in order. Do NOT skip steps. If any step fails, STOP and fix before continuing.

---

## Step 1: Verify Branch

```bash
BRANCH=$(git branch --show-current)
echo "Branch: $BRANCH"
```

**STOP** if on `main`. Never push directly to main.

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

## Step 4: Build (all workspaces)

Build order matters — contract first, then api and web:

```bash
npm run build -w packages/contract
npm run build -w api
npm run build -w web
```

**STOP** and fix any build errors before continuing.

---

## Step 5: TypeScript (all workspaces)

```bash
npx tsc --noEmit -p api/tsconfig.json
npx tsc --noEmit -p web/tsconfig.json
```

**STOP** and fix any type errors before continuing.

---

## Step 6: Lint (all workspaces)

```bash
npm run lint -w api
npm run lint -w web
```

**STOP** if there are any **errors** (warnings are acceptable). Fix errors before continuing.

---

## Step 7: Tests (all workspaces)

```bash
npm run test -w api
npm run test -w web
```

**STOP** and fix any test failures before continuing. **NEVER dismiss failures as "pre-existing"** — investigate and fix them, or create a Linear story with root cause.

---

## Step 8: Playwright Smoke Tests (if UI changes)

If the branch touches any files in `web/src/`:

```bash
npx playwright test
```

If Playwright fails:
- Diagnose the failure
- Fix the code or the test
- **NEVER skip and proceed**

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

Print a summary:

```
## Push Complete

| Check | Result |
|-------|--------|
| Build | ✓ |
| TypeScript | ✓ |
| Lint | ✓ |
| Tests (api) | ✓ <count> passed |
| Tests (web) | ✓ <count> passed |
| Playwright | ✓ / skipped |
| Push | ✓ origin/<branch> |
| PR | #<number> / existing |
```
