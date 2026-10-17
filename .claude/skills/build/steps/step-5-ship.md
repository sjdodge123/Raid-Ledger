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
mcp__linear__save_issue({ id: "<linear_id>", state: "Done" })
```

---

## 5e. Wait for Merge, Cleanup (mode-aware)

Check: `gh pr view rok-<num>-<short-name> --json state`. Once merged:

```bash
git worktree remove <worktree_path>
git branch -d rok-<num>-<short-name>
git pull --rebase origin main
```

### Test-infra cleanup (read `pipeline.test_infra_mode`)

**MODE=fleet:** explicit teardown frees runner RAM sooner than the 24h env TTL. Optional — sweeper will reap if you skip:

```
# Destroy this story's spun env (operator may want to keep it for post-merge poking — skip this call if so)
mcp__mcp-rl-fleet__rl_env_destroy({ slug: "rok-<num>" })
```

At the END of the batch (after ALL stories in the batch are shipped), release the slot:

```
mcp__mcp-rl-fleet__rl_release({ worktree_path: "<main repo or last worktree>" })
// preserve-envs defaults to true (M5a) — the slot's child envs are kept and
// inherited by the next queued agent on the same branch. Pass
// `{destroy_envs: true}` (MCP) or `--destroy-envs` (CLI) to nuke instead.
```

If you forget, the sweeper handles it: 5-min heartbeat timeout if the session crashed, 8-hour hoarded-slot reaper otherwise. Both safety nets — explicit release is the polite path.

**MODE=local:** no fleet teardown needed. Env lock was already released in 4a (or 4d for post-rebase). Nothing extra to clean.

---

## 5e.5. Reconcile planning artifacts (STRICT)

Per CLAUDE.md "Post-merge planning artifact reconciliation." After `gh pr view ... --json state` confirms `MERGED`:

1. **Story in `planning-artifacts/current-sprint.md`?** Strike-through the row (`~~ROK-XXXX~~ — ~~title~~`) and append `— **Shipped YYYY-MM-DD PR #N**.` to the Notes column. Preserve the row — don't delete.
2. **Story NOT in `current-sprint.md`?** Append a row to the `### Reactive shipments (filed + shipped mid-cycle)` section (create it once if absent, between "Deferred from Cycle N" and "Capacity guidance"). Row format: `| **ROK-XXXX** | <title> | <why pulled in>. **Shipped YYYY-MM-DD PR #N**. |`
3. **Strategic decision in this merge?** (architecture call, scope change, deferral, lesson learned, postmortem) — append a dated entry to the Active State Linear doc Strategic section (slug `7a4ddc5652c9`). Skip for routine bug fixes.
4. **Derived freshness:** if main has moved >1 PR since the last Active State Derived update, run `/status-report` from main.

Commit the `current-sprint.md` change inline as part of cleanup with `chore(planning): reconcile current-sprint.md post-ROK-XXXX merge` OR fold it into the existing `chore(config):` ride-along commit per operator-config rules.

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
