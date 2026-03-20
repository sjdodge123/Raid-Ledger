# Step 5: Ship — Rebase, PR, Auto-Merge, Cleanup, Summary

**Lead does everything directly. Final step.**

---

## 5a. Rebase, CI, Push, and Create PR

**Use the `/push` skill** — it handles rebase onto main, full local CI (build + typecheck + lint + tests + Playwright), push, and PR creation in one step.

```
/push
```

The `/push` skill will:
1. Rebase onto `origin/main` (resolves conflicts if needed)
2. Run full CI: build all workspaces, typecheck, lint, tests
3. Run Playwright smoke tests (if UI changes)
4. Push to origin
5. Create the PR with test plan checklist

If `/push` fails at any step, fix the issue before retrying. Do NOT bypass with raw `git push`.

After `/push` completes, verify the PR was created:
```bash
gh pr list --head $(git branch --show-current) --json number,url
```

```bash
gh pr create \
  --title "ROK-<num>: <title>" \
  --body "$(cat <<'EOF'
## Summary
<1-3 bullet points describing what this PR does>

## Linear
ROK-<num>

## Test plan
- [x] Unit tests added/updated
- [x] CI passes (build + lint + type check + tests)
- [x] Operator tested locally
- [x] Code review passed
- [x] Smoke tests passed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" \
  --base main \
  --head rok-<num>-<short-name>
```

---

## 5c. Enable Auto-Merge (LAST action)

**This is the final pipeline action. Only run after ALL gates have passed.**

```bash
gh pr merge rok-<num>-<short-name> --auto --squash
```

---

## 5d. Update Linear to "Done"

```
mcp__linear__save_issue({
  issueId: "<linear_id>",
  statusName: "Done"
})
```

---

## 5e. Wait for Merge, Then Cleanup

Wait for the PR to merge (check with `gh pr view rok-<num>-<short-name> --json state`).

Once merged:
```bash
# Remove worktree
git worktree remove <worktree_path>

# Delete local branch
git branch -d rok-<num>-<short-name>

# Update main
git pull --rebase origin main
```

---

## 5f. Update State

```yaml
stories:
  ROK-XXX:
    status: "done"
    gates:
      # all PASS
    next_action: "Shipped."
```

---

## 5g. Final Summary

Present to the operator:

```
## Build Batch <N> Complete

| Story | PR | Status |
|-------|----|--------|
| ROK-XXX: Title | #<pr_number> | Merged ✓ |
| ROK-YYY: Title | #<pr_number> | Auto-merge pending CI |

### Agent Usage
- Dev agents: <count> (opus)
- Test agents: <count> (sonnet)
- Reviewers: <count> (sonnet)
- Architect checks: <count> (opus)
- Planner: <count> (opus)

### Tech Debt Identified
<list any TD items from reviewer reports>
```

---

## 5h. Create Tech Debt Story in Linear

**If the reviewer identified any tech debt items**, create a single consolidated Linear story to track them.

```
mcp__linear__save_issue({
  title: "tech-debt: <summary of tech debt from ROK-XXX>",
  team: "Roknua's projects",
  project: "Raid Ledger",
  labels: ["Tech Debt"],
  priority: 4,  // Low
  description: "<markdown with numbered list of all TD items from reviewer report, including file paths, descriptions, and suggested fixes. Reference the source PR.>"
})
```

**Rules:**
- Only create if the reviewer reported tech debt items (skip if none)
- One story per batch, consolidating all TD items from all reviewers
- Always use the `tech-debt:` title prefix
- Always assign to project "Raid Ledger" and label "Tech Debt"
- Priority 4 (Low) unless a specific item is high severity
- Include the source story/PR reference in the description

---

## 5i. Wiki Update (feat: stories only)

**After shipping a `feat:` story**, attempt to sync the relevant wiki page. See `steps/step-5i-wiki-update.md` for the full procedure.

**Trigger criteria:** Story title starts with `feat:`.
**Non-blocking:** If the wiki push fails (network, auth), log a warning and continue. Wiki sync failures must NEVER fail the pipeline.

**Skip this step if:**
- The story is not a `feat:` story (fix:, tech-debt:, chore:, perf:)
- No wiki page maps to the story's domain

---

The state file lives in the worktree and is cleaned up automatically when the worktree is removed (step 5e).

Clean up team artifacts:
```bash
rm -rf ~/.claude/teams/build-batch-<N>
rm -rf ~/.claude/tasks/build-batch-<N>
```

**Build complete.**
