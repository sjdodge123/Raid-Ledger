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
- [x] Playwright smoke (desktop + mobile) pass
- [x] Chrome MCP e2e — changed flows exercised, console + network clean (summary: `planning-artifacts/chrome-mcp-summary-fix-batch-YYYY-MM-DD.md`)
- [x] Reviewer agent: APPROVED

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

# Any remaining story worktrees (should be cleaned up in Step 2e)
git worktree prune
```

Clean up team artifacts:
```bash
rm -rf ~/.claude/teams/fix-batch-YYYY-MM-DD
rm -rf ~/.claude/tasks/fix-batch-YYYY-MM-DD
```

---

## 4d.5. Reconcile planning artifacts (STRICT)

Per CLAUDE.md "Post-merge planning artifact reconciliation." After `gh pr view ... --json state` confirms `MERGED`. **Run for every story in the batch.**

1. **Story in `planning-artifacts/current-sprint.md`?** Strike-through the row (`~~ROK-XXXX~~ — ~~title~~`) and append `— **Shipped YYYY-MM-DD PR #N**.` to the Notes column. Preserve the row — don't delete.
2. **Story NOT in `current-sprint.md`?** Append a row to the `### Reactive shipments (filed + shipped mid-cycle)` section (create once if absent, between "Deferred from Cycle N" and "Capacity guidance"). Row format: `| **ROK-XXXX** | <title> | <why pulled in>. **Shipped YYYY-MM-DD PR #N**. |`
3. **Strategic decision in this merge?** (architecture call, scope change, lesson learned, postmortem) — append a dated entry to the Active State Linear doc Strategic section (slug `7a4ddc5652c9`). Skip for routine bug fixes.
4. **Derived freshness:** if main has moved >1 PR since the last Active State Derived update, run `/status-report` from main.

Commit the `current-sprint.md` change inline with `chore(planning): reconcile current-sprint.md post-batch-YYYY-MM-DD merge` OR fold into the `chore(config):` ride-along commit per operator-config rules. The reconciliation commit can ride along with the NEXT PR — it does not need its own PR.

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
- Unit tests: DEFERRED → GitHub CI (or PASS if `--full` was run locally)
- Integration tests: DEFERRED → GitHub CI (or PASS if `--full` was run locally)
- Playwright smoke (desktop + mobile): DEFERRED → GitHub CI
- **Chrome MCP e2e:** PASS — `planning-artifacts/chrome-mcp-summary-fix-batch-YYYY-MM-DD.md` (N flows exercised, M screenshots)
- Reviewer (sonnet): APPROVED

### Agent Usage
- Dev agents: <count> (opus)
- Reviewer: 1 (sonnet)
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
