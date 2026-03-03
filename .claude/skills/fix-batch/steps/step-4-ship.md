# Step 4: Ship — PR, Auto-Merge, Linear Sync, Cleanup, Summary

**Lead does everything directly. Final step.**

---

## 4a. Create PR

Create a single PR covering all stories in the batch:

```bash
gh pr create \
  --title "fix: batch fixes YYYY-MM-DD" \
  --body "$(cat <<'EOF'
## Summary

Batch of small fixes shipped via fix-batch pipeline.

| Story | Label | Description |
|-------|-------|-------------|
| ROK-XXX | Bug | 1-line summary of what was fixed |
| ROK-YYY | Tech Debt | 1-line summary of what was improved |

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
  --head fix/batch-YYYY-MM-DD
```

Fill in the actual story table from the state file.

---

## 4b. Enable Auto-Merge (LAST action)

**This is the final pipeline action. Only run after the PR is created and all gates have passed.**

```bash
gh pr merge fix/batch-YYYY-MM-DD --auto --squash
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

Wait for the PR to merge (check with `gh pr view fix/batch-YYYY-MM-DD --json state`).

Once merged:
```bash
# Update main
git checkout main
git pull --rebase origin main

# Delete batch branch (local + remote already deleted by squash merge)
git branch -d fix/batch-YYYY-MM-DD 2>/dev/null

# Any remaining story worktrees (should be cleaned up in Step 2d)
git worktree prune
```

Clean up team artifacts:
```bash
rm -rf ~/.claude/teams/fix-batch-YYYY-MM-DD
rm -rf ~/.claude/tasks/fix-batch-YYYY-MM-DD
```

---

## 4e. Final Summary

Present to the operator:

```
## Fix Batch Complete — YYYY-MM-DD

| Story | Label | Status |
|-------|-------|--------|
| ROK-XXX: Title | Bug | Done |
| ROK-YYY: Title | Tech Debt | Done |

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

**Note:** Fix-batch stories are typically `fix:`, `tech-debt:`, or `chore:` — wiki updates are rare but may be warranted when a fix changes user-facing behavior documented in the wiki. Use judgment: only update if the fix materially changes how a documented feature works.

If the wiki push fails, log a warning and continue. Wiki sync failures must NEVER fail the pipeline.

---

Archive the state file:
```bash
mv planning-artifacts/fix-batch-state.yaml planning-artifacts/fix-batch-state-YYYY-MM-DD.yaml
```

**Fix batch complete.**
