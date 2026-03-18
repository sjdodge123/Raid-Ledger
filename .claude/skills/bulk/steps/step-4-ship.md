# Step 4: Ship — PR, Auto-Merge, Linear Sync, Cleanup, Summary

**Lead does everything directly. Final step.**

---

## 4a. Create PR

Create a single PR covering all stories in the batch:

```bash
gh pr create \
  --title "chore: batch YYYY-MM-DD" \
  --body "$(cat <<'EOF'
## Summary

Batch of tech debt, chores, and performance improvements shipped via bulk pipeline.

| Story | Label | Description |
|-------|-------|-------------|
| ROK-XXX | Tech Debt | 1-line summary of what was improved |
| ROK-YYY | Chore | 1-line summary of what was done |

## Validation

- [x] Build passes (contract + api + web)
- [x] TypeScript clean
- [x] Lint clean
- [x] Unit tests pass (api + web)
- [x] Integration tests pass
- [x] Smoke tests pass / skipped (no UI changes)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" \
  --base main \
  --head batch/YYYY-MM-DD
```

Fill in the actual story table from the state file.

---

## 4b. Enable Auto-Merge (LAST action)

**This is the final pipeline action. Only run after the PR is created and all gates have passed.**

```bash
gh pr merge batch/YYYY-MM-DD --auto --squash
```

Update state: `gates.pr: PASS`

---

## 4c. Sync Linear — Update Stories to "Done"

For each story in the batch:

```
mcp__linear__save_issue({
  issueId: "<linear_id>",
  statusName: "Done"
})
```

Update each story's state: `status: "done"`

---

## 4d. Wait for Merge, Then Cleanup

Wait for the PR to merge (check with `gh pr view batch/YYYY-MM-DD --json state`).

Once merged:
```bash
# Update main
git checkout main
git pull --rebase origin main

# Delete batch branch (local + remote already deleted by squash merge)
git branch -d batch/YYYY-MM-DD 2>/dev/null

# Any remaining story worktrees (should be cleaned up in Step 2e)
git worktree prune
```

Clean up team artifacts:
```bash
rm -rf ~/.claude/teams/batch-YYYY-MM-DD
rm -rf ~/.claude/tasks/batch-YYYY-MM-DD
```

---

## 4e. Final Summary

Present to the operator:

```
## Bulk Complete — YYYY-MM-DD

| Story | Label | Status |
|-------|-------|--------|
| ROK-XXX: Title | Tech Debt | Done |
| ROK-YYY: Title | Chore | Done |

### PR
#<pr_number> — auto-merge enabled (squash)

### Validation Results
- Build: PASS
- TypeScript: PASS
- Lint: PASS
- Unit tests: PASS
- Integration tests: PASS
- Smoke tests: PASS / SKIP

### Agent Usage
- Dev agents: <count> (opus)
```

---

## 4f. Wiki Update (if applicable)

**Best-effort, non-blocking.** If any story in the batch touches a domain with a wiki page, attempt to sync the wiki. See `../build/steps/step-5i-wiki-update.md` for the full procedure and domain-to-page mapping.

**Note:** Bulk stories are typically `tech-debt:`, `chore:`, or `perf:` — wiki updates are rare but may be warranted when a change affects user-facing behavior documented in the wiki. Use judgment: only update if the change materially changes how a documented feature works.

If the wiki push fails, log a warning and continue. Wiki sync failures must NEVER fail the pipeline.

---

Archive the state file:
```bash
mv planning-artifacts/batch-state.yaml planning-artifacts/batch-state-YYYY-MM-DD.yaml
```

**Bulk complete.**
