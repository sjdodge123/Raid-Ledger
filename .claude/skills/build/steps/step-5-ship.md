# Step 5: Ship — Rebase, PR, Auto-Merge, Cleanup, Summary

**This is the ONLY step that pushes.** Entering this step requires both gates from Step 4 to be PASS:
- `gates.operator: PASS` (Linear status `Code Review`, operator approved in browser)
- `gates.reviewer: PASS` (reviewer report APPROVED, blockers addressed)

If either is still PENDING / WAITING / FAIL → return to Step 4. Do not push.

---

## 5a. Rebase, Push, Create PR (inline — no skill nesting)

Step 3a already validated CI. Step 4d already ran smoke tests. This step only handles rebase + push + PR — NO additional CI run unless rebase pulled new commits.

```bash
cd <worktree_path>

# Rebase onto main
git fetch origin main
git rebase origin/main
# If rebase pulled new commits: `./scripts/validate-ci.sh --full` (default to full — context is unclear after rebase)

# Push
git push -u origin $(git branch --show-current)
cd -
```

### Create PR

Replace the `<...>` placeholders BEFORE running. Don't submit the literal text.

```bash
gh pr create --base main --head <branch> \
  --title "ROK-<num>: <actual title>" \
  --body "$(cat <<'EOF'
## Summary
- <actual bullet 1>
- <actual bullet 2>

## Linear
ROK-<num>

## Test plan
- [x] Unit tests added/updated
- [x] CI passes (build + lint + type + tests)
- [x] Operator tested locally
- [x] Code review passed
- [x] Smoke tests passed
EOF
)"
```

Verify PR: `gh pr list --head <branch> --json number,url`.

---

## 5c. Enable Auto-Merge (LAST action)

Only after ALL gates pass:

```bash
gh pr merge rok-<num>-<short-name> --auto --squash
```

---

## 5d. Linear → Done

```
mcp__linear__save_issue({ issueId: "<linear_id>", statusName: "Done" })
```

---

## 5e. Wait for Merge, Cleanup

Check: `gh pr view rok-<num>-<short-name> --json state`. Once merged:

```bash
git worktree remove <worktree_path>
git branch -d rok-<num>-<short-name>
git pull --rebase origin main
```

---

## 5f. Update State

```yaml
stories.ROK-XXX:
  status: "done"
  next_action: "Shipped."
```

---

## 5g. Final Summary

```
## Build Batch <N> Complete

| Story | PR | Status |
|-------|----|--------|

### Agent Usage
- Dev / Test / Reviewer / Architect / Planner

### Tech Debt Identified
<list from reviewer reports>
```

---

## 5h. Create Tech Debt Story (if reviewer reported any)

One consolidated Linear story per batch:

```
mcp__linear__save_issue({
  title: "tech-debt: <summary from ROK-XXX>",
  team: "Roknua's projects",
  project: "Raid Ledger",
  labels: ["Tech Debt"],
  priority: 4,
  description: "<numbered list with file paths, descriptions, suggested fixes, PR reference>"
})
```

Skip if reviewer reported none. Priority 4 (Low) unless an item is high severity.

---

## 5i. Wiki Update (feat: stories only — MUST run after 5h)

**If the shipped story title starts with `feat:`, read and execute `steps/step-5i-wiki-update.md`.** Best-effort — wiki failures NEVER fail the pipeline, but invoking the step is NOT optional.

Skip only if the story is `fix:`, `tech-debt:`, `chore:`, or `perf:`.

---

State file is inside the worktree — cleaned up automatically in 5e. Clean team artifacts:

```bash
rm -rf ~/.claude/teams/build-batch-<N>
rm -rf ~/.claude/tasks/build-batch-<N>
```

**Build complete.**
