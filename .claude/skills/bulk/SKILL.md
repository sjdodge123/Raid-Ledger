---
name: bulk
description: "Bulk pipeline: pull chore/tech-debt/perf stories from Linear, parallel dev agents in worktrees, validate, ship as single PR"
argument-hint: "[ROK-XXX ROK-YYY | all]"
---

# Bulk — Chore / Tech Debt / Performance Pipeline

Pulls small-scope stories (Tech Debt, Chore, Performance), batches them, spawns parallel devs in worktrees, merges all into one batch branch, validates, and ships one PR. No operator gate, no test agents, no architect. Quality gate: integration tests + full CI on the merged batch branch.

**Linear Project:** Raid Ledger (`1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (`0728c19f-5268-4e16-aa45-c944349ce386`)

---

## When to Use

Tech debt, chores, perf improvements — light or standard scope only. If a story is full scope (contract changes, migrations, cross-module), flag it and recommend `/build` instead.

**Not for:** bug fixes, features, stories needing operator testing, migrations, contract changes, or planner/architect/reviewer gates. Infrastructure changes (`Dockerfile*`, `docker-entrypoint.sh`, `nginx/`) are also ineligible — they need their own PR with local container validation.

---

## Pipeline (4 steps)

```
Step 1: Gather    → Linear search by label, profile, operator approves
Step 2: Implement → Batch branch, worktrees, plan, parallel devs → per-story reviewers (parallel) → merge
Step 3: Validate  → Test gaps, build + typecheck + lint + unit + integration + smoke, inline push
Step 4: Ship      → Auto-merge, Linear → Done, cleanup
```

**Gates:** per-story (dev, reviewer) + batch-level (test_gaps, ci, integration, smoke). Per-story reviewers run in parallel with still-active devs, before merge — catches attribution cleanly.

---

## Branch Strategy (Single PR)

1. Create `batch/YYYY-MM-DD` from `origin/main`
2. Each dev gets `batch/rok-<num>` branched from the batch branch
3. As devs complete, lead merges each `batch/rok-<num>` into the batch branch
4. Validate on batch branch
5. Single PR: `batch/YYYY-MM-DD` → `main`

---

## Self-Recovery (Post-Compaction)

Read `planning-artifacts/batch-state.yaml`, follow `pipeline.next_action`. No agents to respawn.

---

## Story Profiling Matrix

| Scope | Criteria | Eligible? |
|-------|----------|-----------|
| **light** | Config, copy, style-only, docs | Yes |
| **standard** | Single-module change | Yes |
| **full** | Cross-module, migrations, contract | **No — recommend `/build`** |

Touches `packages/contract`, adds migration, or touches 3+ modules → full → reject.

---

## Ground Rules

**STOP / PAUSE / halt from operator:** cease all tool calls immediately, acknowledge "Stopped.", wait.

**Destructive ops require operator approval:** `deploy_dev.sh --fresh`, `git push --force`, `git reset --hard`, `rm -rf` on project dirs, DB volume deletes, table drops.

**Serialization:** parallel only if no file overlap. Max 2-3 devs per batch.

**Git:** always `git pull --rebase origin/main` or `git rebase origin/main`.

**Agent comms:** mailbox via `SendMessage`. Never `TaskOutput` to check on agents. Never poll with `sleep + stat`.

**Auto-merge is the LAST action.** Never enable at PR creation.

**Subagent rules (via templates):** stay in worktree, never push, never create PRs, never enable auto-merge, never force-push, never call `mcp__linear__*`, never run destructive ops.

---

## Steps

| Step | File | Description |
|------|------|-------------|
| 1 | `steps/step-1-gather.md` | Cleanup, fetch by label, profile, present batch, init state |
| 2 | `steps/step-2-implement.md` | Batch branch, worktrees, spawn devs, merge |
| 3 | `steps/step-3-validate.md` | Review, test gaps, build/type/lint/unit/integration/smoke |
| 4 | `steps/step-4-ship.md` | PR, auto-merge, Linear → Done, cleanup, wiki sync |

---

## Agents

All agents use **opus**. One-shot.

| Agent | Template | When |
|-------|----------|------|
| Planner | Plan subagent | Step 2c (standard stories needing plan) |
| Dev | `templates/dev-bulk.md` | Step 2d (one per story, parallel) |
| Reviewer | `devedup-rl:reviewer` | Step 2e (one per story, parallel, before merge) |
