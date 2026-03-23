---
name: build
description: "Lean pipeline: pull stories from Linear, spawn dev agents in worktrees, validate, review, ship"
argument-hint: "[ROK-XXX | rework | all]"
---

# Build — Lean Parallel Pipeline

Pulls dispatchable stories from Linear, profiles them, spawns dev agents in worktrees, validates, reviews, and ships. **Zero long-lived agents** — all state lives in `<worktree>/build-state.yaml` + this file (always injected).

**State file location:** The state file lives **inside the story's worktree** (e.g., `../Raid-Ledger--rok-XXX/build-state.yaml`), NOT in `planning-artifacts/`. This prevents concurrent `/build` sessions from colliding — each pipeline run's state is isolated to its own worktree. Enriched specs still go to `planning-artifacts/specs/` (shared, read-only after writing).

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

---

## Self-Recovery (Post-Compaction)

After any context compaction, execute this immediately:

1. **Read your state file** — `<worktree>/build-state.yaml` contains full pipeline state
2. **Read `pipeline.next_action`** — tells you exactly what to do next
3. **Check per-story fields** — `requirements_gathered`, `next_action`, `status`
4. **If any story has `requirements_gathered: false`** — resume requirements interview (Step 1e) for those stories only. Read existing specs from `planning-artifacts/specs/` for completed stories.
5. **Resume from `pipeline.current_step`** — read the corresponding step file if needed

No agents to respawn. No pings to send. The state file IS the recovery mechanism.

---

## Story Profiling Matrix

Apply this directly when assessing stories:

| Scope | Criteria | E2E Test Type | Gates |
|-------|----------|---------------|-------|
| **light** | Config, copy, style-only, docs | Lint + type check only | dev → ci → operator → smoke |
| **standard** | Single-module feature, bug fix, straightforward | Playwright/Discord smoke (TDD) | e2e_test_first → dev → ci → operator → reviewer → smoke |
| **full** | Cross-module, migrations, contract changes, complex | Full test suite (TDD) + planner + architect | e2e_test_first → dev → ci → operator → reviewer → architect_final → smoke |

**E2E test type by area touched:**
- UI changes → Playwright smoke test (desktop + mobile viewports)
- Discord bot/notification changes → Discord companion bot smoke test
- API-only, no UI/Discord → Integration test (Jest, real DB)
- Pure logic only → Unit test

**Scope decision rules:**
- Touches `packages/contract` → full
- Adds DB migration → full
- Touches 3+ modules → full
- UI-only with no logic → light
- Single module, no contract/migration → standard

---

## Mandatory Pipeline Order

```
Requirements Interview (plan mode, if spec incomplete) → Enriched spec on disk
  → Linear "In Progress" (Step 1h — immediately after batch confirmed)
  → E2E Test Agent writes FAILING test first (Step 2d — TDD)
  → Dev builds to make the test pass (Step 2e)
  → CI passes → Push branch
  → Deploy locally → Linear "In Review" → Update state → FULL STOP
  → Wait for operator to test and update Linear
  → Commit operator changes (MANDATORY before review)
  → Operator approves → Linear "Code Review" (Step 4a — Lead updates, not operator)
    → Changes Requested: re-spawn dev, loop back
    → Code Review: spawn Reviewer
  → Optional: Architect final check (if needs_architect, SEQUENTIAL)
  → Lead runs smoke tests (full suite — NEVER skipped)
  → ONLY AFTER all gates pass → Create PR → Auto-merge (LAST action)
  → Linear "Done"
```

**Eight gates before PR:**
1. **Requirements** — spec completeness interview in plan mode (skipped if spec already complete)
2. **E2E Test First (TDD)** — test agent writes failing Playwright/Discord/integration test BEFORE dev starts (skipped for light)
3. **Dev** — implements feature to make the failing test pass
4. **CI** — build + type check + lint + tests
5. **Operator** — manual testing approval via Linear
6. **Reviewer** — code review after operator approves
7. **Architect final** — alignment check (only if `needs_architect`)
8. **Smoke test** — Lead runs full suite (NEVER skipped)

---

## STOP Protocol

If the operator sends **STOP**, **PAUSE**, or **halt**: immediately cease ALL tool calls. Do not finish the current action chain. Send one acknowledgment ("Stopped.") and wait. No exceptions.

---

## Destructive Operations

These require **operator approval** before running:
- `deploy_dev.sh --fresh` (wipes DB)
- `git push --force` / `git reset --hard`
- `rm -rf` on any project directory
- DB volume deletes, table drops

If in doubt whether an operation is destructive, it is. Ask first.

---

## Serialization Rules

**Can run in parallel:** Stories with no file overlap.
**Must be serialized (separate batches):** Stories modifying `packages/contract/`, stories generating DB migrations, stories touching the same files.
**Concurrency limit:** Max 2-3 dev agents per batch.

---

## Standing Rules (for all worktree agents)

These apply to ALL agents working in worktrees (dev, test agent, reviewer):

1. **NEVER push to remote** — only the Lead pushes
2. **NEVER create pull requests** — only the Lead creates PRs
3. **NEVER enable auto-merge** — only the Lead enables this as the LAST pipeline action
4. **NEVER force-push** — only the Lead handles rebases
5. **NEVER call `mcp__linear__*` tools** — only the Lead calls Linear
6. **NEVER run destructive operations** — escalate to the Lead
7. **ALWAYS stay in your assigned worktree** — do not `cd` outside it

---

## Git Pull Strategy

Always use `git pull --rebase origin/main` or `git rebase origin/main`. After squash-merge, local and remote have different hashes — regular pull causes divergent branch errors.

---

## Team Agent Communication

Agents communicate via **mailbox system** (`SendMessage`). They are NOT background shell tasks.
- **NEVER use `TaskOutput`** to check on team agents — use `SendMessage`
- **NEVER poll with `sleep + stat`** — agents send a message when done
- **While waiting for agents**, do useful parallel work: read next step file, check worktree state, verify CI

---

## Auto-merge Rule

**Auto-merge is the LAST action in the pipeline.** NEVER enable `gh pr merge --auto --squash` at PR creation. Create PR first → complete all remaining gates → enable auto-merge only after everything passes. Auto-merge is a one-way door.

---

## Steps

Execute steps in order. Read each step's file when you reach it — do NOT read all steps upfront.

| Step | File | Description |
|------|------|-------------|
| 1 | `steps/step-1-setup.md` | Cleanup, fetch stories, profile, **requirements interview (plan mode)**, present batch, init state, **Linear → "In Progress"** |
| 2 | `steps/step-2-implement.md` | Create worktrees, optional planner/architect, spawn devs + test agents |
| 3 | `steps/step-3-validate.md` | CI, push, deploy, Linear "In Review", FULL STOP for operator |
| 4 | `steps/step-4-review.md` | Poll Linear, handle rework/approval, reviewer + architect + smoke |
| 5 | `steps/step-5-ship.md` | Rebase, PR, auto-merge, Linear "Done", cleanup, summary |

---

## Agents

| Agent | Template | When | Model | Lifetime |
|-------|----------|------|-------|----------|
| E2E Test Agent | `templates/test-agent.md` | Step 2d (BEFORE dev — writes failing test) | opus | Per-story |
| Dev | `templates/dev.md` | Step 2e (builds to make test pass) | opus | Per-story |
| Reviewer | `templates/reviewer.md` | Step 4 (after operator approves) | opus | Per-story |
| Architect | `templates/architect.md` | Step 2 pre-dev / Step 4 post-review (one-shot) | opus | One-shot |
| Planner | `templates/planner.md` | Step 2 pre-dev (full scope only, one-shot) | opus | One-shot |
| Wiki Updater | `templates/wiki-updater.md` | Step 5i (after tech debt, feat: stories only) | — | One-shot |
