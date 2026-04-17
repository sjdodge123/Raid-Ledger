# Step 4: Ship

---

## 4a. PR (already created inline in 3h)

Verify: `gh pr list --head batch/YYYY-MM-DD --json number,url`.

---

## 4b. Enable Auto-Merge (LAST action)

```bash
gh pr merge batch/YYYY-MM-DD --auto --squash
```

State: `gates.pr: PASS`.

---

## 4c. Linear → Done

For each story:
```
mcp__linear__save_issue({ issueId: "<linear_id>", statusName: "Done" })
```

Update each: `status: "done"`.

---

## 4d. Wait for Merge, Cleanup

```bash
gh pr view batch/YYYY-MM-DD --json state  # wait for merged
git checkout main && git pull --rebase origin main
git branch -d batch/YYYY-MM-DD 2>/dev/null
git worktree prune  # any remaining story worktrees
```

**Team cleanup (Lead only — do NOT let a teammate run this).** By this point every dev + reviewer teammate should have been shut down in Step 2h. Run:

```
TeamDelete({ team_name: "batch-YYYY-MM-DD" })
```

If `TeamDelete` fails because a teammate is still running, shut it down first:

```
SendMessage({ to: "<teammate-name>", message: { type: "shutdown_request", reason: "batch complete" } })
```

Then retry `TeamDelete`. Only fall back to removing `~/.claude/teams/batch-YYYY-MM-DD/` and `~/.claude/tasks/batch-YYYY-MM-DD/` manually if `TeamDelete` is unavailable — the docs warn cleanup from anywhere but the Lead may leave resources in an inconsistent state.

---

## 4e. Final Summary

```
## Bulk Complete — YYYY-MM-DD

| Story | Label | Status |
|-------|-------|--------|

### PR
#<pr_number> — auto-merge enabled (squash)

### Validation
Build / TypeScript / Lint / Unit / Integration / Smoke — PASS

### Agent Usage
Team: batch-YYYY-MM-DD (cleaned up)
Dev teammates: N (opus) + Reviewer teammates: N (opus) + Planner subagents: N (opus)
```

---

## 4f. Wiki Update (optional, best-effort)

Bulk stories are usually `tech-debt:` / `chore:` / `perf:` — wiki updates are rare. If a change materially alters a documented feature, see `../build/steps/step-5i-wiki-update.md`. Wiki failures NEVER fail the pipeline.

---

Archive state:
```bash
mv planning-artifacts/batch-state.yaml planning-artifacts/batch-state-YYYY-MM-DD.yaml
```

**Bulk complete.**
