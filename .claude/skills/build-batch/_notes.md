# /build-batch skill — design notes (working file)

These notes capture the pattern that emerged from running ROK-1331 as a parallel multi-milestone build. The eventual `/build-batch` skill should codify the proven flow into a real SKILL.md + steps/* + templates/*.

**Do not treat this as authoritative yet.** It's a side log. Update as we learn. Promote to `SKILL.md` at the end of the cycle once the pattern is proven.

---

## When /build-batch is the right skill

Distinct from `/build` (single story, one PR) and `/bulk` (small chore/perf cluster, one PR). `/build-batch` is for:

- **One story too big for a single /build cycle**, broken into multiple internal milestones (e.g. ROK-1331 with 6 milestones, ~60-70h of dev work).
- **Operator wants ALL milestones in ONE PR** (not split across stories/PRs).
- **Story has been planned in advance** — a milestone plan file exists at `planning-artifacts/specs/<STORY>-plan.md` with each milestone scoped + dependencies mapped.

Trigger phrases from operator:
- "run this one in a parallel run"
- "all of these in one PR"
- "i want to spec them before direct to implement as well"
- "make sure they follow the remaining steps in the build pipeline but in a parallel fashion"

If only ONE milestone needs to ship, fall back to `/build <STORY>` and treat the milestone as the story.

---

## Prerequisites before /build-batch can run

1. **Milestone plan exists** at `planning-artifacts/specs/<STORY>-plan.md` with:
   - Per-milestone goal, AC coverage, file paths
   - Sizing estimate (hours)
   - Dependency graph (which milestones block which)
   - Parallelization compatibility (which milestones touch overlapping files)
   - File-overlap matrix
2. **Open design questions resolved** — operator-decided answers folded into the plan file or accompanying spec.
3. **Pre-requisite operator actions completed** (VM packages installed, image rebuilds, etc.).
4. **Branch name confirmed** — short, kebab-case, fits the story (`rok-XXXX-short-name`).

If any are missing, `/build-batch` STOPS and asks. Don't start fan-out on a half-baked plan.

---

## Pipeline shape (ROK-1331 model)

```
Setup:    1 worktree, 1 branch, 1 team
          npm install, .env copy, build-state.yaml, Linear → In Progress

Wave 0 — Spec (N parallel spec agents, ~20-40min wallclock)
  M1-spec | M2-spec | ... | MN-spec
  → planning-artifacts/specs/<STORY>-M<N>-spec.md per milestone
  → Lead reviews specs for gaps before TDD wave

Wave 1 — TDD (N parallel test agents, ~30-60min)
  M1-test | M2-test | ... | MN-test
  → Failing integration / unit / e2e tests per milestone
  → Lead verifies each test fails for the expected reason

Wave 2+ — Dev (waves determined by dependency graph)
  Wave 2: foundation milestones (no deps)
  Wave 3: milestones that depend on wave 2 outputs
  Wave 4+: cascade as deps clear
  Within each wave: agents fan out in parallel with `git commit -o <paths>` (pathspec)
  Lead audits each wave's commits before spawning next

Validate → CI (fleet validate-ci --full once on combined branch), local deploy, Playwright, Chrome MCP e2e
Operator FULL STOP for browser-test verdict
Review → Codex + /security-review + devedup-rl chunked reviewer (parallel)
Architect final (likely needed given the scope)
Lead smoke tests
Push → 1 PR, auto-merge LAST
```

---

## Wave-planning algorithm

For each milestone in the plan, identify:
1. **Dependencies** — which prior milestones must complete first (data, files, types)
2. **File set** — exact list of files written/modified
3. **Sizing** — wallclock hours

Then:
1. Topologically sort by dependencies → starting wave assignment
2. For milestones in the same wave: check file-set intersection
   - **Disjoint sets** → keep in same wave (parallel-safe)
   - **Overlapping sets** → either split the smaller milestone into "non-overlapping" + "overlapping" sub-parts, OR push the smaller to the next wave
3. **Cap wave parallelism at 3 dev agents.** Per memory `general conventions`: max 2-3 parallel dev agents. Splitting into more waves is cheaper than babysitting 5+ concurrent agents.
4. **Long-pole milestones (>20h):** consider splitting into sub-milestones to reduce context-cut risk. 22h is the rough ceiling for a single dev agent run.

---

## Agent count budget (ROK-1331 example, 6 milestones)

- 6 spec agents (one per milestone, parallel)
- 6 test agents (one per milestone, parallel)
- 8 dev agents (M1, M2, M3, M4, M5a, M5b, M6a, M6b across 5 waves)
- ~3-5 reviewer agents (devedup-rl chunked, runs in parallel with Codex + security)
- 1 architect (final pass, given the scope)
- 1 PR writer

**Total agent runs: ~26.** Peak parallelism: 6 (spec/test waves). Peak dev parallelism: 3.

---

## State file shape (`<worktree>/build-state.yaml`)

Extends the standard `/build` state file:

```yaml
pipeline:
  current_step: "wave_3_dev"  # spec | tdd | wave_<N>_dev | validate | review | smoke | ship
  story: ROK-1331
  story_title: "..."
  worktree: ../Raid-Ledger--rok-1331
  branch: rok-1331-rl-infra-task-execution
  team: build-ROK-1331
  next_action: "Spawn M5a + M6a in parallel."

milestones:
  M1:
    title: "Orchestrator task primitives"
    sizing_hours: 8
    depends_on: []
    file_set: [...]
    spec_file: planning-artifacts/specs/ROK-1331-M1-spec.md
    test_file: planning-artifacts/specs/ROK-1331-M1-tests.md  # what tests cover
    status: "completed"  # queued | spec_done | test_done | dev_active | dev_done | completed
    wave: 2
    gates:
      spec: PASS
      test_first: PASS
      dev: PASS
    agent_history: [...]
  M2: ...
  ...

waves:
  - wave_id: 0
    phase: spec
    members: [M1, M2, M3, M4, M5a, M5b, M6a, M6b]
    status: completed
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
  ...

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

## Open design decisions accumulated for /build-batch

These are decisions made for ROK-1331 that the skill should encode (or surface to operator) by default:

1. **Spec → TDD → Dev order** (matches /build pipeline; not shortcut).
2. **One worktree, one branch** — agents fan out with `git commit -o <paths>` (pathspec) per `feedback_parallel_fanout_git_hygiene.md`. Never per-milestone worktrees (too much disk + npm install + merge overhead).
3. **Lead audits commits between waves** — don't trust dev agents blindly; spot-check the diff before spawning the next wave.
4. **wait:true backcompat verified after each dev wave** — for stories that touch MCP/CLI surfaces used by /push, Lead runs sanity-check command before spawning next wave.
5. **Architect final pass is almost always needed** for batch builds — the cross-milestone integration surface is the highest-risk part of the diff.

---

## Notes captured during ROK-1331 (running log — append as we go)

### 2026-05-19 — operator chose "plan first, don't implement" for the FIRST run

ROK-1331 was opened, profiled as full-scope, then operator asked for a planner pass before any implementation. The planner produced `planning-artifacts/specs/ROK-1331-plan.md` (254 lines, 6 milestones). Operator then asked for the parallel-batch flow — making this the first /build-batch invocation.

**Lesson for skill:** if the story is filed without a milestone plan, the FIRST step of /build-batch should be a "planner-only" pass that exits before implementation. Operator reviews + decides. THEN /build-batch resumes with the plan as input.

### 2026-05-19 — operator added "side-log of the process" instruction mid-flow

Operator said: *"i want you to keep a side log of the process we're following for this build skill usage, this will turn into the /build-batch skill, but i dont want to stop our flow and build that now, just make notes along the way."*

**Lesson for skill:** when a skill is being shaped through real use, the using session captures notes. Don't pause to formalize; capture observations and decisions inline.

### 2026-05-19 — open design questions interview flow

After plan was written, operator asked to be interviewed on the open design questions. The interview surfaced material scope changes:
- M5 grew from 12h → 16h → 22h as operator clarified intent (lease-queue model, claim-duration with extensions, hard cutover across build skills).
- Pin scope shifted from "operator-only" to "any claim-holder" + 24h idle ceiling → then to "claim-duration model" (different concept entirely).

**Lesson for skill:** open design questions should be interviewed BEFORE the planner produces a milestone plan, not after. Otherwise the plan rots when answers redirect intent. Maybe: spec interview → design-Q interview → planner. Three steps before any dev fan-out.

### 2026-05-19 — hard cutover propagates work across skill files

Operator chose "hard cutover" on the claim 409 → queue migration. Every build skill (push, build, fix-batch, handover) that calls `rl claim` was updated to handle the new `{enqueued, queue_position, queue_ahead, inherited_envs}` response and pair with `rl_claim_wait`. Folded into M5b sub-component J — landed in this PR.

**Lesson for skill:** if a story changes an MCP tool / orchestrator contract that other skills depend on, the cross-skill migration is part of the story scope. Don't defer to follow-up — that creates a window where the codebase has broken callers.

### 2026-05-19 — wave structure trade-off: 4 waves (big M5) vs 5 waves (split M5)

Choice was between:
- Option A: M5 as one 22h agent (4 dev waves) — simpler pipeline, but context-cut risk
- Option B: Split M5 into M5a + M5b (5 dev waves) — cleaner cognitive boundaries, no single super-long agent run

Operator chose B.

**Lesson for skill:** when a single milestone exceeds ~20h, splitting it into sub-milestones improves agent reliability. The skill should have a hard rule: "if any milestone is sized >20h in the plan, the planner is asked to split it before fan-out begins."

---

### 2026-05-19 — operator wants reboot + handoff to fresh agent

Mid-flow the operator asked to reboot the laptop and feed a single command into a FRESH agent to execute the build. This is the test of whether the skill + plan + spec files are ACTUALLY self-sufficient.

Created `planning-artifacts/specs/ROK-1331-RESUME.md` as the bridge document. Fresh agent reads it, then invokes `/build-batch ROK-1331`. The skill reads from disk; no implicit context from this session.

**Lesson for skill:** EVERY /build-batch session should produce a RESUME doc at the end of pre-flight (Step 1c-1f). Future restarts use it. Pattern: `planning-artifacts/specs/<STORY>-RESUME.md` (gitignored, working artifact).

The RESUME doc captures:
- Locked-in operator decisions (no re-interview)
- Computed wave structure (deterministic but worth caching)
- Pre-req operator actions (with wave boundaries)
- Critical gotchas specific to this story
- What to read vs re-derive

This was authored mid-flow specifically for this run, but the pattern should be CODIFIED in Step 1 of the skill.

### 2026-05-19 — operator clarified "i want it to basically mirror the /build pipeline"

After my first SKILL.md draft, operator pushed back: the steps should mirror /build 1:1, not invent new step numbering. Restructured to:
- Step 1 Setup (mirrors /build step-1)
- Step 2 Implement (sub-phases 2a spec wave, 2b TDD wave, 2c dev waves)
- Step 3 Validate (mirrors /build step-3)
- Step 4 Review (mirrors /build step-4)
- Step 5 Ship (mirrors /build step-5)

**Lesson for skill:** parallel multi-milestone builds are a SHAPE on /build, not a different pipeline. Same numbering, same step semantics, same gates — just expanded fan-out within each step.

### 2026-05-19 — operator surfaced three missing nuances

After draft 2, operator asked: (1) can Playwright + Chrome MCP run on fleet too? (2) is architect involved earlier? (3) what does /build actually do that I might have missed?

**Result of re-reading /build's step files:**

1. **Fleet e2e is wired.** `scripts/validate-ci.sh::_resolve_web_url` honors `RL_TARGET=remote` + `RL_SLOT` to construct `https://slot-N.gamernight.net` as BASE_URL. Chrome MCP can target the same URL. Updated build-batch to use FLEET by default for batch builds (CI + deploy + Playwright + Chrome MCP).
2. **Architect should be earlier.** /build's architect runs at step 2c (PRE-DEV, gated to migration/infra). For batch builds, cross-milestone interface drift is inevitable, so PRE-DEV architect should be MANDATORY (not gated). Added Step 2b architect pre-dev pass. Kept Step 4d post-review pass also mandatory. Two architect passes per batch.
3. **/build nuances I'd missed:**
   - Per-dev AC audit (step 2f) — Lead reads each dev's AC trace, spot-checks 2-3 ACs end-to-end. Added to between-wave audit.
   - TDD validation rule: "Confirmed Failing? = YES" per AC. Added to step-2 2c.
   - Chrome MCP verdict structure (PASS / PASS WITH NOTES / FAIL) with tech-debt flow. Added to step-3 3e.
   - Env-lock minimal hold pattern (acquire before deploy, release at operator verdict). Already had it, reinforced.

**Lessons for skill:**
- **Fleet-by-default is the right default for BATCH** (not for single-story /build, where local is faster). The big trade-off (5-15min first build vs 3min local) is dominated by the parallelism benefit when many agents are coordinating.
- **Architect pre-dev MANDATORY for batch** because cross-milestone interface drift between spec agents is the #1 source of mid-wave respawns. Catching at spec-level (re-run a 30-line spec agent) is 100x cheaper than catching at dev-level (revert a wave's commits).
- **Per-dev AC audit** is the gate that catches the "dev sounds confident but missed an AC" failure mode. /build's documented experience: skipping this lets cross-layer bugs through 50%+ of the time. Don't trust the dev's confidence; audit the AC trace.
- **/build's step files are the source pattern for /build-batch's step files.** Always cross-check against /build when adding new flows — borrow structure, add fan-out semantics on top.

---

### 2026-05-19 — operator specified "fix-forward" mode for ROK-1331, deliberately NOT promoted to skill

Operator clarified: for ROK-1331 specifically, every rl-fleet call should be monitored because (a) the story is fixing fleet bugs and (b) multiple agents have gotten hung on the fleet in prior sessions. The operator explicitly said: *"i dont want to build local waits into build batch skill"*.

**Lesson for skill:** the fix-forward / monitor-every-fleet-call pattern is a STORY-SPECIFIC operating mode, not a permanent skill rule. It belongs in the RESUME doc, not in the skill. The rationale:

- Most /build-batch invocations will NOT be modifying the infrastructure they're standing on. ROK-1331 is unusual.
- Adding fleet hang-handling to the skill itself would bake assumptions about fleet behavior into the skill, making it brittle when fleet changes.
- The fix-forward pattern requires operator pre-approval (SSH access, ride-along hotfix commits, in-flight scope changes) — those are case-by-case, not skill-default.

**Where the operating mode lives instead:**
- `planning-artifacts/specs/<STORY>-RESUME.md` — story-specific operator notes for THIS run
- `planning-artifacts/fleet-hotfixes-<STORY>.md` (created during the run) — log of in-flight fixes

The skill itself just trusts the fleet calls to behave per their contracts. If a future story ALSO needs the fix-forward mode, the operator surfaces it via the RESUME doc again. We don't promote on first repetition; we'd want 2-3 examples before deciding it's worth a skill-level affordance (and even then, probably as an opt-in flag like `/build-batch <STORY> --fix-forward-fleet`).

This is the same general principle as `feedback_full_scope_phase_split.md`: defaults stay lean; case-specific knobs live in the RESUME/spec layer, not the skill layer.

---

## TODO before promoting to SKILL.md

- [ ] Validate the wave-planning algorithm against another batch story
- [ ] Decide where build-state.yaml lives for batch builds (per-worktree or per-batch?)
- [ ] Codify the "spec interview → design-Q interview → planner → wave planner → fan-out" pre-flight sequence
- [ ] Define how reviewer + architect runs against a batch (chunked per milestone, or against the combined diff?)
- [ ] Decide how `/build-batch` handles a milestone that FAILS mid-wave (rest of wave waits? abort all? respawn?)
- [ ] Document the agent count budget formula: (N_milestones × 2) + (N_dev_waves × max_parallelism) + reviewer/architect overhead
