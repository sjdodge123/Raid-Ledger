---
name: push
description: "Pre-push checklist: sync with main, run checks, push, and create PR"
---

# Push — Pre-Push Checklist & PR Creation

**Goal:** Ensure the branch is clean, up-to-date, and passing all checks before pushing and creating a PR.

Execute every step in order. Do NOT skip steps.

---

## Step 1: Verify Feature Branch

```bash
git branch --show-current
```

**STOP** if on `main`. Never push directly to main. Create a feature branch first.

The branch name should match the story (e.g., `rok-329-sticky-toolbars` for `ROK-329`). Each story gets its own dedicated branch.

---

## Step 2: Sync with Latest Main

```bash
git fetch origin main && git rebase origin/main
```

**If there are rebase conflicts:**
- Resolve them
- `git rebase --continue`
- Re-run the checks in steps 3-5 after resolving

---

## Step 3: TypeScript Compilation

```bash
npx tsc --noEmit --project web/tsconfig.json
```

**STOP** and fix any errors before continuing.

---

## Step 4: Tests

```bash
npm test --workspace=web
```

**STOP** and fix any failures before continuing.

---

## Step 5: Lint (Targeted)

Lint only changed files for speed:

```bash
cd web && npx eslint $(git diff --name-only origin/main -- 'web/src/**/*.ts' 'web/src/**/*.tsx' | sed 's|^web/||') 2>&1
```

**STOP** and fix any errors before continuing.

---

## Step 6: Review Git Status

```bash
git status --short
```

- Ensure all intended files are staged/committed
- Ensure no untracked files are accidentally left behind
- If there are unstaged changes that should be included, stage and amend the commit

---

## Step 7: Push

```bash
git push origin $(git branch --show-current)
```

If the branch doesn't exist on remote yet, this will create it.

---

## Step 8: Create PR (if needed)

Check if a PR already exists:

```bash
gh pr list --head $(git branch --show-current) --json number,url
```

**If no PR exists**, create one:

```bash
gh pr create --base main --head $(git branch --show-current) --title "<type>(<story-id>): <short description>" --body "<PR body>"
```

- Title format: `feat(ROK-329): short description` (use `fix`, `chore`, `refactor` etc. as appropriate)
- Body should include: Summary, Changes (grouped by area), Testing results from steps 3-5

**If a PR already exists**, the push will update it automatically.

---

## Step 9: Clean Up Stale Local Branches

Prune remote tracking references that no longer exist on origin, then list local branches whose upstream is gone:

```bash
git fetch --prune
git branch -vv | grep ': gone]' | awk '{print $1}'
```

**If any branches are listed**, they've been deleted from origin (e.g., after a PR was merged). Delete them locally:

```bash
git branch -d <branch-name>
```

Use `-D` (force) only if `-d` fails due to unmerged changes you're sure you don't need.
