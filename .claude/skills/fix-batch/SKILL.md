---
name: fix-batch
description: "Fast pipeline: batch small fixes (bugs, tech debt, chores, perf), parallel dev agents, validate, ship as single PR"
argument-hint: "[ROK-XXX ROK-YYY | all]"
---

# Fix-Batch — Fast Fix Pipeline

Pulls small-scope stories (Bug, Tech Debt, Chore, Performance, Spike) from Linear, batches them, spawns parallel dev agents in worktrees, merges all into a single batch branch, validates, and ships one PR. **No operator review gate, no test agents, no architect checks.** **Code review is MANDATORY** — one reviewer agent per story runs in parallel with the env-bound browser-validation track so it adds minimal wall time. The quality gate is: integration tests + full CI + per-story reviewer pass on the merged batch branch.

**rl-infra fleet (preferred when Proxmox is reachable):** Lead runs the preflight at session start (`.claude/skills/_shared/rl-fleet-preflight.md`) to pick MODE=fleet vs MODE=local. Fleet has 2 slots default (4 with the `extra-slots` compose profile). Use `rl_env_deploy({ slug, worktree_path })` for the browser-validation env, `rl_validate_ci({ args, worktree_path })` for the quality gate. **Every rl_* MCP call MUST pass `worktree_path: "<absolute path to worktree>"`** (see `feedback_rl_fleet_worktree_path.md`). Falls back to local model when `RL_TARGET=local` or VM unreachable. Command translations: `.claude/skills/_shared/rl-infra-fleet.md`.

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
Step 3: Validate  → CI (build/ts/lint/unit/integration) → PARALLEL { Track A: deploy + Playwright + Chrome MCP | Track B: ONE reviewer per story (MANDATORY) } → test gaps → regression → push
Step 4: Ship      → Single PR, auto-merge, Linear → Done, cleanup
```

**Eight gates before PR.** Gates 1–3 are sequential. Gates 4+5 (env-bound) run in parallel with gate 6 (reviewer, no env needed). Gates 7+8 run after both tracks converge.

1. **CI** — build + type check + lint *(sequential)*
2. **Unit tests** — all workspaces pass *(sequential)*
3. **Integration tests** — `npm run test:integration -w api` *(sequential)*

   → fork into two parallel tracks ↓

   **Track A (Lead, env-bound):**
4. **Playwright smoke** — desktop + mobile, automated regression sweep
5. **Chrome MCP e2e** — Lead drives the *changed user flows* on the deployed batch branch via `mcp__claude-in-chrome__*`; captures screenshots / GIFs / console / network and produces an operator-facing summary. Playbook: `.claude/skills/_shared/chrome-mcp-e2e.md`.

   **Track B (Per-story reviewer agents, no env):**
6. **Code review (one agent per story, MANDATORY)** — spawn N reviewer agents (`devedup-rl:reviewer`, sonnet) in parallel, where N = number of stories merged into the batch (excluding any that shipped via a separate mid-batch PR). Each reviewer scopes itself to ONE story's commit range, not the whole batch diff — per-story scoping produces sharper, less-noisy findings. Reviewers do NOT depend on Chrome MCP output. If a critical/high finding requires browser re-verification, Lead reruns the affected flow after Track A releases the env lock. If the operator separately invokes `/code-review` (broader harness review), treat it as a SUPPLEMENT, not a replacement.

   → tracks converge ↓

7. **Test gap analysis** — reviewer identifies untested changes; lead adds missing tests before proceeding
8. **Regression tests** — every Bug fix includes a regression test (Playwright or unit/integration)

**Env-lock rule:** the env lock (`mcp__mcp-env__env_lock_acquire`) is held only for Track A (Playwright + Chrome MCP). Lead releases the lock immediately after the Chrome MCP summary is written. Reviewers (Track B), push, PR creation, and auto-merge do NOT need the env.

**Parallelization rule:** spawn ALL per-story reviewer agents in a single message at the same moment Lead acquires the env lock for Track A. Both tracks must complete before gates 7+8 run. `gates.review: PASS` only when EVERY per-story reviewer returns green (no unfixed critical/high findings). If reviewers finish first, Lead checks Track A progress; if Track A finishes first, wait on the reviewer mailbox(es) before proceeding.

---

## Trivial single-story short-circuit (CLAUDE.md "Trivial-fix fast lane")

When the batch resolves to a **single story** that meets the `trivial` bar (≤30 net lines, single file, no `packages/contract`/migration/infra/auth surface, pure logic/copy/style/config), collapse the pipeline — do NOT pay the multi-story batch ceremony for one tiny fix:

- **Step 2:** Lead edits directly on a `fix/rok-<num>` branch off `origin/main`. **No worktree, no `npm install`, no dev-agent spawn, no batch branch.** (Extends [[feedback_lead_does_small_fixes]].)
- **Step 3 collapses to:** `validate-ci.sh --static --scope=auto` (3a) → **exactly one** review pass (Codex pre-push via `/push` Step 8.5; the per-story `devedup-rl:reviewer` in 3i is SKIPPED for a <300-line no-risk diff, mirroring `/build` Step 4b). Human gates tier by blast radius: **non-UI → no env-lock, no deploy, no Chrome MCP** (3f–3h are `N/A`); **cosmetic-UI → one screenshot on a running env** (no `--rebuild`). A Bug still gets a regression test at the lightest tier that proves the fix.
- **Step 4:** PR the `fix/rok-<num>` branch directly.
- **Escape hatch:** if mid-fix it grows past the bar (≥2 files, cross-workspace, contract/migration/infra/auth, or a real rendered-flow change), STOP and run the normal standard path below.

Two or more stories — or any single story above the `trivial` bar — take the full batch pipeline below, unchanged.

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
| **light / trivial** | Config, copy, style-only, docs, OR a single-file ≤30-line logic fix with no contract/migration/infra/auth surface (the `trivial` tier — CLAUDE.md "Trivial-fix fast lane"). Single trivial story → **short-circuit** (Lead-direct, no worktree, one reviewer, blast-radius human gates). | Yes |
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
| 3 | `steps/step-3-validate.md` | CI (build/ts/lint/unit/integration) → PARALLEL { deploy + Playwright + Chrome MCP \| ONE reviewer per story } → test gaps → regression → push |
| 4 | `steps/step-4-ship.md` | Single PR, auto-merge, Linear "Done", cleanup, summary, wiki sync (4f) |

---

## Agents

| Agent | Template | When | Model | Lifetime |
|-------|----------|------|-------|----------|
| Spike | Explore subagent | Step 2c (unknown root cause bugs only) | opus | Per-story |
| Planner | Plan subagent | Step 2c½ (standard stories needing plan) | opus | Per-story |
| Dev | `templates/dev-fix.md` | Step 2d (one per story) | opus | Per-story |
| Reviewer | `devedup-rl:reviewer` subagent | Step 3 (parallel with Track A) | sonnet | **One per merged story (MANDATORY)** |

5 agent types total: Lead + Spike (conditional) + Planner (conditional) + Dev + Reviewer (one per merged story).
