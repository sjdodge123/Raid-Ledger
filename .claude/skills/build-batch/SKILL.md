Base directory for this skill: /Users/sdodge/Documents/Projects/Raid-Ledger/.claude/skills/build-batch

# /build-batch — Parallel Multi-Milestone Build Pipeline

For stories too big for a single `/build` cycle that the operator wants shipped in ONE PR. Drives off a pre-existing milestone plan at `planning-artifacts/specs/<STORY>-plan.md`.

**This skill is distinct from `/build`:**
- `/build` — one story, one milestone, one PR. Standard.
- `/bulk` — small chore/perf cluster, one PR.
- `/build-batch` — one story, MANY milestones, ONE PR. Parallel fan-out with wave-by-wave dev agents.

**Linear Project:** Raid Ledger (`1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (`0728c19f-5268-4e16-aa45-c944349ce386`)

---

## When to use this skill

The operator types `/build-batch <ROK-XXXX>` (and optionally `--from-wave <N>` to resume). Trigger context:

- Story has a milestone plan at `planning-artifacts/specs/<STORY>-plan.md` (typically produced by a prior planner pass).
- Operator has explicitly chosen multi-milestone fan-out for THIS story (not the default).
- All open design questions in the plan are resolved.
- Pre-requisite operator actions (VM packages, image rebuilds, etc.) are done OR explicitly deferred.

If any of the above are missing → STOP, ask, do not start fan-out.

---

## Inputs (read from disk)

1. **Spec source:** `planning-artifacts/specs/<STORY>.md` — full Linear description + comments verbatim.
2. **Milestone plan:** `planning-artifacts/specs/<STORY>-plan.md` — milestones, deps, sizing, file-overlap matrix, operator decisions on open design questions.
3. **Per-milestone specs (Wave 0 output, may not exist on first run):** `planning-artifacts/specs/<STORY>-M<N>-spec.md`.

---

## Pipeline overview

```
Pre-flight: Read plan, verify decisions, compute wave structure

Setup:    ONE worktree + ONE branch + ONE team (per-batch)
          Copy .env, npm install, deploy_dev.sh --ci if needed
          Initialize <worktree>/build-state.yaml
          Linear → In Progress

Wave 0 — Spec:  N parallel spec agents (one per milestone)
                → planning-artifacts/specs/<STORY>-M<N>-spec.md per milestone
                Lead reviews specs for gaps before TDD wave

Wave 1 — TDD:   N parallel test agents (one per milestone)
                → Failing integration/unit/e2e tests per milestone
                Lead verifies each test fails for the expected reason

Wave 2..K — Dev: wave-by-wave dev agents per the dependency graph
                Cap parallelism at 3 dev agents per wave (per /general conventions)
                ALL agents fan out in same worktree with `git commit -o <paths>` pathspec
                Lead audits each wave's commits BEFORE spawning next wave

Validate: CI (fleet validate-ci --full once), local deploy,
          Playwright (if UI changes), Chrome MCP e2e
          Operator FULL STOP for browser-test verdict

Review:   Codex + /security-review + devedup-rl chunked reviewer (parallel)
          Architect final pass (mandatory for batch builds — cross-milestone surface)

Lead smoke tests on combined branch

Push → 1 PR with all milestones → enable auto-merge LAST → Linear → Done
```

---

## Ground rules (STRICT)

1. **One worktree, one branch, one team.** Never per-milestone worktrees. Disk + npm install + merge complexity not justified for the file-isolation we get from pathspec commits.

2. **Pathspec-only commits.** Every dev agent uses `git commit -o <files...> -m "<msg>"`. NEVER `git add` + `git commit`. NEVER `git reset`. Per memory `feedback_parallel_fanout_git_hygiene.md` — fan-out cost recovery from one wrong reset was ~10min in the past.

3. **Cap dev wave parallelism at 3.** Per memory `general conventions`: max 2-3 parallel dev agents. If a wave has >3 milestones, split into sub-waves OR push later milestones to the next wave.

4. **Long-pole rule.** If any single milestone is sized >20h in the plan, the planner should have split it before fan-out. If you see one in the plan, STOP and tell the operator the plan needs revision before /build-batch can proceed.

5. **Lead audits between waves.** After each dev wave, Lead:
   - Reads `git log --oneline -<N>` to see what each agent committed
   - Spot-checks file diffs for shape (don't deep-review yet — that's reviewer's job)
   - Verifies sanity: `npm run lint -w <touched-workspace>`, `npx tsc --noEmit -p <touched>` if scope is meaningful
   - Verifies wait:true backcompat (if the story touches /push surface): run a stubbed CLI invocation to confirm sync path still works
   - Updates build-state.yaml `next_action` to spawn the next wave
   - DO NOT proceed if a previous wave's agent reported FAIL or returned silent

6. **No push before review.** Steps 1-5 local-only. First push is in Step 7 ship.

7. **Auto-merge is the LAST action.** Never enable at PR creation. Create PR → complete all gates → enable auto-merge.

8. **All agents are team members.** Every spawn passes `team_name: build-batch-<STORY>`. Lead creates the team in Setup, tears it down in Step 7. Solo `Agent()` calls without team membership are a pipeline violation.

9. **Cost discipline.** Lead writes per-milestone dev briefs ONCE to `planning-artifacts/dev-brief-<STORY>-M<N>.md`. Every agent prompt body is 2-4 lines: "Read `planning-artifacts/specs/<STORY>-M<N>-spec.md` and `planning-artifacts/specs/<STORY>-plan.md` section M<N>. Execute <task>. Commit with pathspec and report ≤500 words." That's it. Full context lives on disk; don't paste it back into agent prompts.

---

## Steps (mirrors `/build` — same numbering, expanded for parallel fan-out)

Read each step file when you reach it. Do not pre-load all steps.

| Step | File | Description | /build analog |
|------|------|-------------|---------------|
| 1 | `steps/step-1-setup.md` | Cleanup, fetch story, profile milestones from plan, compute wave structure, init state, Linear → In Progress | step-1-setup |
| 2 | `steps/step-2-implement.md` | **2a: Wave 0 spec** (N parallel spec agents)<br>**2b: Architect PRE-DEV pass** (MANDATORY for batch — cross-milestone interface validation)<br>**2c: Wave 1 TDD** (N parallel failing-test agents)<br>**2d: Wave 2..K dev** (wave-by-wave dev fan-out with per-dev AC audit + between-wave audit) | step-2-implement |
| 3 | `steps/step-3-validate.md` | Full CI on the COMBINED branch — **FLEET by default** (`RL_TARGET=remote`), local fallback. Deploy to fleet slot via `rl_env_deploy`. Playwright + Chrome MCP target the slot URL. Linear → In Review | step-3-validate |
| 4 | `steps/step-4-review.md` | Poll Linear for operator verdict. Reviewer (Codex + /security-review + devedup-rl chunked PER MILESTONE in parallel) + Architect POST-REVIEW final cross-milestone pass + Lead smoke | step-4-review |
| 5 | `steps/step-5-ship.md` | Rebase, push, create PR (ONE PR with all milestones), enable auto-merge LAST, Linear → Done | step-5-ship |

**Two architect passes per batch** (both MANDATORY): pre-dev (after Wave 0 specs, before TDD) validates cross-milestone interfaces before any dev code lands; post-review (after Step 4c reviewer) validates final integration. Templates at `templates/architect.md`.

**Fleet-by-default for batch e2e**: CI, deploy, Playwright, AND Chrome MCP all target the rl-infra fleet (`RL_TARGET=remote` + `RL_SLOT`). Local fallback only if fleet unreachable. Big win: zero env-lock contention with other agents using local env.

---

## Pre-flight checklist (run BEFORE Step 1)

Lead does these inline before creating anything.

```bash
# 1. Plan file exists?
test -f planning-artifacts/specs/<STORY>-plan.md || { echo "NO PLAN — run planner first"; exit 1; }

# 2. Linear story still in Backlog / Dispatch Ready (not already shipped)?
# Use mcp__linear__get_issue to check.

# 3. Branch name confirmed with operator?
# Default to kebab-case from Linear story title; ask if unclear.

# 4. Open design questions in plan all resolved?
grep -c "OPEN\|DECIDED:" planning-artifacts/specs/<STORY>-plan.md
# Should be 0 OPENs (other than research-task ones like "check SDK source").
```

**Parse the plan to build a wave structure:**

For each milestone in the plan, extract:
- `id` (e.g. M1, M2, M5a, M5b)
- `sizing_hours`
- `depends_on: [...]`
- `file_set: [...]` (from "Files" sub-section)
- `parallelizable_with: [...]`

Then:
1. Topologically sort by `depends_on`.
2. For milestones in the same dependency-rank: check pairwise file-set intersection.
   - **Disjoint** → same wave (parallel-safe).
   - **Overlapping** → push the smaller to next wave OR split into non-overlapping + overlapping sub-parts (only if the plan explicitly marks it as splittable).
3. Cap each wave at 3 dev agents. If more eligible, push extras to next wave.

**Output:** a wave table. Write it to `<worktree>/build-state.yaml::waves[]` after Setup creates the worktree.

---

## State file shape

`<worktree>/build-state.yaml`:

```yaml
pipeline:
  skill: build-batch
  current_step: "wave_3_dev"      # spec | tdd | wave_<N>_dev | validate | review | smoke | ship
  current_wave: 3
  story: <STORY>
  story_title: "..."
  worktree: ../Raid-Ledger--<branch>
  branch: <branch>
  team: build-batch-<STORY>
  next_action: "Spawn M5a + M6a in parallel via Agent() with team_name."

milestones:
  M1:
    title: "..."
    sizing_hours: 8
    depends_on: []
    file_set: [...]
    spec_file: planning-artifacts/specs/<STORY>-M1-spec.md
    status: "completed"            # queued | spec_done | test_done | dev_active | dev_done | completed
    wave: 2
    gates:
      spec: PASS
      test_first: PASS
      dev: PASS
    agent_history: []
  # ... per milestone

waves:
  - wave_id: 0
    phase: spec
    members: [M1, M2, M3, M4, M5a, M5b, M6a, M6b]
    status: completed
    started_at: "..."
    completed_at: "..."
  - wave_id: 1
    phase: tdd
    members: [M1, M2, M3, M4, M5a, M5b, M6a, M6b]
    status: completed
  - wave_id: 2
    phase: dev
    members: [M1]
    status: completed
  - wave_id: 3
    phase: dev
    members: [M2, M3, M4]
    status: in_progress
  - wave_id: 4
    phase: dev
    members: [M5a, M6a]
    status: pending
  - wave_id: 5
    phase: dev
    members: [M6b]
    status: pending
  - wave_id: 6
    phase: dev
    members: [M5b]
    status: pending

global_gates:
  ci: PENDING
  playwright: PENDING
  chrome_mcp: PENDING
  operator_review: PENDING
  reviewer: PENDING
  architect_final: PENDING
  smoke: PENDING
```

---

## Self-recovery (post-compaction)

Read `<worktree>/build-state.yaml`. The `current_step` + `current_wave` + `next_action` tell you exactly where to resume.

- `spec` step incomplete → re-run any pending Wave 0 spec agents (the rest of the wave will already have files on disk; only re-spawn for missing spec files).
- `wave_<N>_dev` in progress → check `milestones[*].status` to find which agents completed and which to spawn next.
- `validate` / `review` / `smoke` / `ship` → follow `/build`'s step-3/4/5 patterns.

State file is the source of truth. Lead never re-derives wave structure from the plan after Setup — the plan can change between sessions, but the in-flight build is locked to the wave plan it started with.

---

## Agents

All agents use **opus**. One-shot unless noted.

| Agent | Template | When | Parallel-safe |
|-------|----------|------|---------------|
| Spec writer | `templates/spec-agent.md` | Step 2a (Wave 0) | Yes (different output files) |
| Architect PRE-DEV | `templates/architect.md` with TASK_TYPE=PRE_DEV | Step 2b | No |
| E2E test author | `templates/test-agent.md` | Step 2c (Wave 1) | Yes (different test files) |
| Dev | `templates/dev-agent.md` | Step 2d (Wave 2..K) | Within wave only — pathspec discipline required |
| Reviewer (devedup-rl chunked) | (existing) | Step 4c review phase | Yes (chunks the diff per-milestone) |
| Codex reviewer | (existing CLI) | Step 4c review phase | N/A (CLI) |
| Security reviewer | `/security-review` skill | Step 4c review phase | N/A |
| Architect POST-REVIEW | `templates/architect.md` with TASK_TYPE=POST_REVIEW | Step 4d final pass | No |
| PR writer | (existing devedup-rl:pr-writer) | Step 5 ship | No |

---

## Subagent rules (applied via templates)

- Subagents stay in their worktree.
- NEVER push, create PRs, enable auto-merge, force-push.
- NEVER call `mcp__linear__*` (Lead handles Linear).
- NEVER run destructive ops (`deploy_dev.sh --fresh`, `rm -rf`, `git reset --hard`).
- NEVER `git add` or `git commit -a`. Always `git commit -o <paths> -m "<msg>"`.
- NEVER touch files outside the milestone's declared file_set without escalating to Lead first.

---

## Notes / lessons-learned log

See `_notes.md` (same dir). Append observations as you learn. Promote stable patterns to this SKILL.md.
