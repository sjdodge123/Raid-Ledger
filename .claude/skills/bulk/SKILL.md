---
name: bulk
description: "Bulk pipeline: pull chore/tech-debt/perf stories from Linear, Agent Team with parallel dev + reviewer teammates in worktrees, validate, ship as single PR"
argument-hint: "[ROK-XXX ROK-YYY | all]"
---

# Bulk — Chore / Tech Debt / Performance Pipeline

Pulls small-scope stories (Tech Debt, Chore, Performance), batches them, spawns parallel dev and reviewer teammates inside a single Agent Team, merges all into one batch branch, validates, and ships one PR. No operator gate, no test agents, no architect. Quality gate: integration tests + full CI on the merged batch branch.

**Requires Agent Teams:** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` must be set in `~/.claude/settings.json` (already configured). Teammates self-claim tasks from a shared task list and message each other directly for auto-fix loops — the Lead only orchestrates the batch.

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
Step 2: Implement → Batch branch, worktrees, Agent Team with shared task list, dev teammates self-claim → per-story reviewer teammates (parallel, message devs directly for auto-fix) → merge
Step 3: Validate  → Test gaps, build + typecheck + lint + unit + integration + smoke, inline push
Step 4: Ship      → Auto-merge, Linear → Done, team + worktree cleanup
```

**Gates:** per-story (dev, reviewer) + batch-level (test_gaps, ci, integration, smoke). Per-story reviewer teammates run in parallel with still-active devs, before merge — catches attribution cleanly, and reviewers can message devs directly to request fixes without involving the Lead.

---

## Branch Strategy (Single PR)

1. Create `batch/YYYY-MM-DD` from `origin/main`
2. Each dev gets `batch/rok-<num>` branched from the batch branch
3. As devs complete, lead merges each `batch/rok-<num>` into the batch branch
4. Validate on batch branch
5. Single PR: `batch/YYYY-MM-DD` → `main`

---

## Self-Recovery (Post-Compaction)

Read `planning-artifacts/batch-state.yaml`, follow `pipeline.next_action`.

**Agent Teams caveat:** in-process teammates do NOT survive `/resume` or `/rewind`. The team config and shared task list persist on disk (`~/.claude/teams/batch-YYYY-MM-DD/` and `~/.claude/tasks/batch-YYYY-MM-DD/`), but the running dev/reviewer teammate processes are gone. Recovery path:

1. Read `batch-state.yaml` for per-story status.
2. Unclaim any task whose owner no longer exists (`TaskUpdate({ owner: null, status: "pending" })`).
3. Re-`TeamCreate` (if team config also lost) and re-spawn dev/reviewer teammates using the thin spawn prompts in Step 2f/2g — they self-claim the unowned tasks.
4. For stories already committed in their worktree, spell that out in the replacement task description so the fresh teammate doesn't redo the work.

See `steps/step-2-implement.md` §2i for full detail.

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

**Agent comms (Agent Teams):** teammates communicate directly via `SendMessage` — dev↔reviewer for auto-fix loops, teammate→Lead for completion summaries. The Lead receives idle notifications automatically when a teammate finishes a task, so never poll: no `TaskOutput` to check on agents, no `sleep + stat` loops. Read the notifications, don't chase them.

**Agent Teams dependency:** this skill requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (already set in `~/.claude/settings.json`). Only one team can be active per Claude Code session — don't run `/bulk` and `/build` in the same session, and finish one bulk batch before starting another. The team lives under `~/.claude/teams/batch-YYYY-MM-DD/`; clean it up in Step 4 before exiting.

**Auto-merge is the LAST action.** Never enable at PR creation.

**Teammate rules (via templates):** stay in worktree, never push, never create PRs, never enable auto-merge, never force-push, never call `mcp__linear__*`, never run `deploy_dev.sh` or other destructive ops. Devs coordinate with reviewers via `SendMessage`; reviewers coordinate with devs for auto-fix. Only the Lead talks to Linear, Git remotes, or GitHub.

---

## Steps

| Step | File | Description |
|------|------|-------------|
| 1 | `steps/step-1-gather.md` | Cleanup, fetch by label, profile, present batch, init state |
| 2 | `steps/step-2-implement.md` | Batch branch, worktrees, Agent Team + shared task list, dev + reviewer teammates, merge |
| 3 | `steps/step-3-validate.md` | Review, test gaps, build/type/lint/unit/integration/smoke |
| 4 | `steps/step-4-ship.md` | PR, auto-merge, Linear → Done, team + worktree cleanup, wiki sync |

---

## Agents

All agents use **opus**.

| Agent | Kind | Template | When |
|-------|------|----------|------|
| Planner | One-shot `Agent` subagent (read-only) | Plan subagent | Step 2c (standard stories needing plan) |
| Dev | Teammate (shared task list, self-claim) | `templates/dev-bulk.md` | Step 2e–2f — task posted, then N teammates spawned |
| Reviewer | Teammate (parallel, messages dev directly) | `templates/reviewer-bulk.md` | Step 2g — review task posted + teammate spawned when dev idles |
