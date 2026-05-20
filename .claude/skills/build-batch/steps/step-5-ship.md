# Step 5: Ship — Rebase + Push + PR + Auto-merge (mirrors `/build` step-5)

Same shape as `/build`'s step-5-ship — one PR with ALL milestones, auto-merge enabled LAST.

---

## 5a. Rebase against origin/main

```bash
cd <worktree>
git fetch origin main
git rebase origin/main
```

Per `feedback_rebase_before_diff_audit.md`: always rebase BEFORE the PR diff audit so reviewers see the actual delta.

Resolve any conflicts (operator config files in `.claude/**`, `CLAUDE.md`, `.mcp.json` ride along — never exclude). Per `feedback_operator_config_rides_along.md`.

Rebuild contract if rebase touched `packages/contract/`:
```bash
npm run build -w packages/contract
```
Per `feedback_rebuild_contract_after_rebase.md`.

Re-run lint + type-check after rebase to catch any drift:
```bash
npm run lint -w api
npm run lint -w web
npx tsc --noEmit -p api/tsconfig.json
npx tsc --noEmit -p web/tsconfig.json
```

If lint:fix produced unrelated drift, `git checkout -- .` AFTER the last check per `feedback_lint_fix_worktree_drift.md`.

---

## 5b. PR description via devedup-rl:pr-writer

```
Agent({
  description: "PR writer <STORY>",
  subagent_type: "devedup-rl:pr-writer",
  team_name: "build-batch-<STORY>",
  prompt: "Generate a PR description for <STORY>. Read planning-artifacts/specs/<STORY>-plan.md for the milestone list, and `git log origin/main..HEAD --oneline` for the commit range. Group the description by milestone (M1, M2, ...). Each milestone gets its own H3 section with: goal, ACs delivered, files changed, test plan. End with a single 'Cross-milestone integration' section. Output to stdout. Do NOT touch any files. Do NOT push or create the PR — Lead does that."
})
```

---

## 5c. Push the branch

```bash
git push -u origin <branch>
```

If push fails because the branch already exists on remote (resumed session): `git push --force-with-lease origin <branch>`. NEVER use `--force` per CLAUDE.md.

---

## 5d. Create the PR

```bash
gh pr create \
  --title "<STORY>: feat: <short title> (batch — M1..MN)" \
  --body "$(cat <<'EOF'
<paste from PR writer output>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Do NOT enable auto-merge yet.** Auto-merge is the LAST action.

---

## 5e. Verify PR shape

```bash
gh pr view <branch> --json title,body,additions,deletions,changedFiles,labels
```

Sanity check:
- Title matches story + batch shape
- Body contains all milestone sections
- Changed files is non-trivial (~50-200+ for a 6-milestone batch)
- Labels applied (will be missing on a fresh PR; that's fine, the auto-PR-labeler workflow handles it)

---

## 5e.5. Post-merge planning artifact reconciliation (per CLAUDE.md STRICT)

Before enabling auto-merge, update `planning-artifacts/current-sprint.md`:

1. If the story IS in the cycle plan → strike-through the row + append `— **Shipped YYYY-MM-DD PR #N**.` to Notes.
2. If the story is NOT in the cycle plan → append a row to `### Reactive shipments (filed + shipped mid-cycle)`.

Commit this with `chore(config): post-merge planning artifact reconciliation for <STORY>`.

---

## 5f. Enable auto-merge LAST

```bash
gh pr merge <branch> --auto --squash
```

This is the last gate. Per CLAUDE.md "Pull Requests" section: always enable auto-merge (squash) after creating the PR.

---

## 5g. Linear → Done

```
mcp__linear__save_issue({ issueId: "<linear_id>", statusName: "Done" })
```

Add a final Linear comment with the PR URL + brief summary.

---

## 5h. Cleanup

After auto-merge confirms (poll `gh pr view <branch> --json state` until `MERGED`):

```bash
cd /Users/sdodge/Documents/Projects/Raid-Ledger
git worktree remove <worktree-path>
git fetch --prune
```

Tear down the team:
```
mcp__teams__delete({ name: "build-batch-<STORY>" })
```

Clean up gitignored working artifacts (optional — leaving them helps post-mortem):
- `planning-artifacts/specs/<STORY>-M*-spec.md`
- `planning-artifacts/dev-brief-<STORY>-M*.md`
- `planning-artifacts/review-<STORY>-M*.md`
- `planning-artifacts/architect-final-<STORY>.md`

Append a final entry to `.claude/skills/build-batch/_notes.md` capturing lessons learned (especially anything that should be promoted into the skill).

Update task list, close any open tasks for this run.

---

## When step 5 is "done"

PR merged, branch + worktree cleaned, team torn down, Linear flipped to Done, notes appended.

The batch is complete. Operator gets a final report:

```
✅ <STORY> shipped — PR #<N>, merged <YYYY-MM-DD HH:MM>
   <N> milestones across <K> dev waves
   Total agents: <count>
   Total wallclock: <hrs>
```
