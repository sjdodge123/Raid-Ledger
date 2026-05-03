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

## 5h. Tech Debt Findings — Append to Backlog (no auto-filed Linear stories)

**Do NOT create Linear `tech-debt:` stories from reviewer findings.** This step previously auto-filed an issue per batch, which produced a self-perpetuating queue: reviewer flags items → Lead files story → next batch picks it up → reviewer flags more items → loop. Findings now land in a working doc; the operator decides what becomes a Linear story.

What to do instead:

1. **Append findings to `TECH-DEBT-BACKLOG.md`** at the repo root. Use the exact format the file's header documents (dated section header → severity-tagged bullets with file path + description). One section per batch, appended below the `<!-- agents append below this line -->` marker.
2. **Stage and commit** the backlog update with the rest of the batch's changes (`chore(config): append tech-debt findings — ROK-XXX` is fine). It rides along with the PR.
3. **Mirror the same list** in the PR description under a `## Tech debt observed (not auto-filed)` heading so it's visible on review without opening the file.
4. **Keep the "Tech Debt Identified" section** in 5g (Final Summary) so the chat output also shows it.
5. **Do NOT call `mcp__linear__save_issue`** to create new tech-debt issues from this step. Operator triages from the backlog file later.

**Critical / security / blocking issues are NOT tech debt** — those are auto-fixed in Phase 2 of review or sent back to dev. This rule applies to deferred items only.

**Severity convention** (must match the backlog format): `high` / `med` / `low` / `nit`. Never `crit` — anything critical was already addressed.

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
