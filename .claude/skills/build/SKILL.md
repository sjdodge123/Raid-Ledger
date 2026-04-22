---
name: build
description: "Lean pipeline: pull stories from Linear, spawn dev agents in worktrees, validate, review, ship"
argument-hint: "[ROK-XXX | rework | all]"
---

# Build — Lean Parallel Pipeline

Pulls dispatchable stories from Linear, profiles them, spawns dev agents in worktrees, validates, reviews, ships. State lives in `<worktree>/build-state.yaml` (per-story isolation prevents concurrent run collisions). Enriched specs go to `planning-artifacts/specs/`.

**Linear Project:** Raid Ledger (`1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (`0728c19f-5268-4e16-aa45-c944349ce386`)

---

## Self-Recovery (Post-Compaction)

Read `<worktree>/build-state.yaml`, follow `pipeline.next_action`. Stories with `requirements_gathered: false` resume Step 1e. No agents to respawn — the state file is the recovery mechanism.

---

## Story Profiling Matrix

| Scope | Criteria | E2E Test Type | Gates |
|-------|----------|---------------|-------|
| **light** | Config, copy, style-only, docs | Lint + type check | dev → ci → operator → smoke |
| **standard** | Single-module feature, bug fix | Playwright/Discord smoke (TDD) | e2e_first → dev → ci → operator → reviewer → smoke |
| **full** | Cross-module, migrations, contract changes | Full suite (TDD) + planner + architect | e2e_first → dev → ci → operator → reviewer → architect_final → smoke |

**E2E type by area touched:** UI → Playwright (desktop + mobile); Discord bot/notifications → Discord smoke; API-only → Jest integration; Pure logic → Unit test.

**Full scope triggers:** `packages/contract` change, DB migration, 3+ modules. UI-only with no logic → light. Single module → standard.

---

## Pipeline Order & Gates

```
Requirements Interview (plan mode, if spec incomplete)
  → Linear "In Progress" (1h)
  → E2E Test Agent writes FAILING test (2d — TDD)
  → Dev builds to pass test (2e)
  → CI → Deploy LOCAL (no push) → Linear "In Review" → FULL STOP for operator
  → Commit operator changes → Linear "Code Review" → Reviewer
  → Optional: Architect final (if needs_architect)
  → Lead smoke tests → git push → Create PR → Auto-merge (LAST) → Linear "Done"
```

**Eight gates before PR:** requirements, e2e_test_first (N/A only for light), dev, ci, operator, reviewer, architect_final (if needed), smoke_test.

---

## Ground Rules

**All subagents run as team members, not loose `Agent()` calls.** Step 1 creates a team (`build-ROK-XXX` or `build-batch-N`); every subagent spawn — planner, architect, test agent, dev, reviewer, pr-writer — passes `team_name` and joins the team. Step 5 tears it down. Solo subagents are a pipeline violation.

**STOP / PAUSE / halt from operator:** cease all tool calls immediately, acknowledge "Stopped.", wait.

**Destructive ops require operator approval:** `deploy_dev.sh --fresh`, `git push --force`, `git reset --hard`, `rm -rf` on project dirs, DB volume deletes, table drops. If in doubt, it's destructive.

**Serialization:** parallel only if no file overlap. Serialize stories touching `packages/contract/`, DB migrations, or same files. Max 2-3 devs per batch.

**Git:** always `git pull --rebase origin/main` or `git rebase origin/main` (squash-merge creates divergent hashes).

**Agent comms:** mailbox via `SendMessage`. Never `TaskOutput` to check on agents. Never poll with `sleep + stat`. While waiting, do parallel useful work.

**No `git push` before code review.** The branch stays LOCAL through Steps 1-4. The first push + PR creation happens only in Step 5, after operator approval AND reviewer approval. Do NOT invoke `/push`, `git push`, `gh pr create`, or `gh pr merge --auto` in Steps 1-4 — even with `--skip-pr`. Pushing pre-review risks PRs + auto-merge landing before a human has reviewed.

**Auto-merge is the LAST action.** Never enable at PR creation. Create PR → complete all gates → enable auto-merge.

**Subagent rules (applied via templates):** subagents stay in their worktree, never push, never create PRs, never enable auto-merge, never force-push, never call `mcp__linear__*`, never run destructive ops. Lead handles all of that.

---

## Steps

Read each step file when you reach it — do not pre-load all steps.

| Step | File | Description |
|------|------|-------------|
| 1 | `steps/step-1-setup.md` | Cleanup, fetch, profile, requirements interview, init state, Linear → In Progress |
| 2 | `steps/step-2-implement.md` | Worktrees, optional planner/architect, spawn devs + test agents |
| 3 | `steps/step-3-validate.md` | CI, deploy LOCAL (**no git push**), Linear → In Review, FULL STOP |
| 4 | `steps/step-4-review.md` | Poll Linear, rework/approval, reviewer + architect + smoke (**still no push**) |
| 5 | `steps/step-5-ship.md` | Rebase, `git push`, create PR, auto-merge, Linear → Done, cleanup |

---

## Agents

All agents use **opus**. One-shot unless noted.

| Agent | Template | When |
|-------|----------|------|
| E2E Test | `templates/test-agent.md` | Step 2d (BEFORE dev, writes failing test) |
| Dev | `templates/dev.md` | Step 2e (makes test pass) |
| Reviewer | `templates/reviewer.md` | Step 4 (after operator approves) |
| Architect | `templates/architect.md` | Step 2 pre-dev / Step 4 post-review |
| Planner | `templates/planner.md` | Step 2 pre-dev (full scope only) |
