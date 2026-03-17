---
name: fix-batch
description: "Fast pipeline: batch small fixes (bugs, tech debt, chores, perf), parallel dev agents, validate, ship as single PR"
argument-hint: "[ROK-XXX ROK-YYY | all]"
---

# Fix-Batch — Fast Fix Pipeline

Pulls small-scope stories (Bug, Tech Debt, Chore, Performance, Spike) from Linear, batches them, spawns parallel dev agents in worktrees, merges all into a single batch branch, validates, and ships one PR. **No operator review gate, no test agents, no reviewer agents, no architect checks.** The quality gate is: integration tests + full CI pass on the merged batch branch.

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

---

## When to Use

- Bug fixes, tech debt, chores, performance improvements, spikes, small improvements
- Stories that are light or standard scope ONLY
- If a story looks full-scope (contract changes, migrations, cross-module), flag it and recommend `/build` instead

## When NOT to Use

- Feature work (use `/build`)
- Stories requiring operator testing or manual review
- Stories with DB migrations or contract changes
- Anything that needs planner/architect/reviewer gates

---

## Pipeline Overview (4 steps)

```
Step 1: Gather    → Linear search by label, profile (incl. root cause + planner assessment), present, operator approves
Step 2: Implement → Batch branch, worktrees, spike unknown bugs, plan complex stories, parallel devs, merge into batch branch
Step 3: Review & Validate → Code review, test gap analysis, build + typecheck + lint + unit tests + integration tests + smoke
Step 4: Ship      → Single PR, auto-merge, Linear → Done, cleanup
```

**Six gates before PR:**
1. **Code review** — reviewer agent checks correctness, security, performance, and contract integrity
2. **Test gap analysis** — reviewer identifies untested changes; lead adds missing tests before proceeding
3. **Regression tests** — every Bug fix includes a regression test (Playwright or unit/integration)
4. **Unit tests** — all workspaces pass
5. **Integration tests** — `npm run test:integration -w api`
6. **CI** — build + type check + lint (validated as part of gate 3-4 process)

---

## Branch Strategy (Single PR)

1. Create `fix/batch-YYYY-MM-DD` from `origin/main`
2. Each dev gets a worktree on `fix/rok-<num>` branched from the batch branch
3. As devs complete, lead merges each `fix/rok-<num>` into `fix/batch-YYYY-MM-DD`
4. All validation runs on the batch branch
5. Single PR: `fix/batch-YYYY-MM-DD` → `main`

---

## Self-Recovery (Post-Compaction)

After any context compaction, execute this immediately:

1. **Read `planning-artifacts/fix-batch-state.yaml`** — contains full pipeline state
2. **Read `pipeline.next_action`** — tells you exactly what to do next
3. **Check per-story `next_action` fields** — tells you what each story needs
4. **Resume from `pipeline.current_step`** — read the corresponding step file if needed

No agents to respawn. No pings to send. The state file IS the recovery mechanism.

---

## Story Profiling Matrix

| Scope | Criteria | Eligible? |
|-------|----------|-----------|
| **light** | Config, copy, style-only, docs | Yes |
| **standard** | Single-module fix, bug fix, straightforward | Yes |
| **full** | Cross-module, migrations, contract changes, complex | **No — recommend `/build`** |

**Scope decision rules:**
- Touches `packages/contract` → full → reject, recommend `/build`
- Adds DB migration → full → reject, recommend `/build`
- Touches 3+ modules → full → reject, recommend `/build`
- Touches `Dockerfile*`, `docker-entrypoint.sh`, or `nginx/` → **NOT eligible for fix-batch** — infrastructure changes require their own PR with local container validation (see CLAUDE.md)
- UI-only with no logic → light
- Single module, no contract/migration → standard

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
**Must be serialized (separate batches):** Stories modifying the same files.
**Concurrency limit:** Max 2-3 dev agents per batch.

---

## Standing Rules (for all worktree agents)

These apply to ALL agents working in worktrees:

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
- **While waiting for agents**, do useful parallel work: read next step file, check worktree state, verify builds

---

## Auto-merge Rule

**Auto-merge is the LAST action in the pipeline.** NEVER enable `gh pr merge --auto --squash` at PR creation. Create PR first → verify CI passes → enable auto-merge only after everything passes. Auto-merge is a one-way door.

---

## Steps

Execute steps in order. Read each step's file when you reach it — do NOT read all steps upfront.

| Step | File | Description |
|------|------|-------------|
| 1 | `steps/step-1-gather.md` | Cleanup, fetch stories by label, profile, present batch, init state |
| 2 | `steps/step-2-implement.md` | Batch branch, worktrees, spawn devs, merge into batch branch |
| 3 | `steps/step-3-validate.md` | Code review, test gap analysis, build + typecheck + lint + unit tests + integration tests + smoke |
| 4 | `steps/step-4-ship.md` | Single PR, auto-merge, Linear "Done", cleanup, summary, wiki sync (4f) |

---

## Agents

| Agent | Template | When | Model | Lifetime |
|-------|----------|------|-------|----------|
| Spike | Explore subagent | Step 2c (unknown root cause bugs only) | opus | Per-story |
| Planner | Plan subagent | Step 2c½ (standard stories needing plan) | opus | Per-story |
| Dev | `templates/dev-fix.md` | Step 2d (one per story) | opus | Per-story |
| Reviewer | `devedup-rl:reviewer` subagent | Step 3a (once, on batch branch diff) | sonnet | Once per batch |

5 agent types total: Lead + Spike (conditional) + Planner (conditional) + Dev + Reviewer.
