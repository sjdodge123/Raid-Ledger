# Step 2: Implement — Spec → Architect pre-dev → TDD → Dev Waves

The longest step. Four sub-phases run mostly sequentially: spec wave, architect pre-dev pass, TDD wave, then K dev waves driven by the dependency graph from Step 1's wave plan.

Lead coordinates. Subagents do the work.

---

## 2a. Wave 0 — Spec (N parallel spec agents)

Output: `planning-artifacts/specs/<STORY>-M<N>-spec.md` per milestone — a full implementation spec the dev agent will use.

### Spawn

For each milestone in the plan, spawn ONE spec agent. They run in parallel (all in the same response, multiple tool calls).

Use the spec-agent template:

```
Agent({
  description: "Spec ROK-XXXX M<N>",
  subagent_type: "devedup-rl:spec-writer",
  team_name: "build-batch-<STORY>",
  prompt: <contents of templates/spec-agent.md with the milestone substituted>
})
```

Cap parallelism at the milestone count. For ROK-1331 (8 milestones), spawn 8 spec agents in parallel — they only READ and only write to disjoint output files.

### Wait for completion

Each spec agent SendMessages back when done. Lead collects all returns before proceeding.

### Lead audit

For each milestone:
- Verify `planning-artifacts/specs/<STORY>-M<N>-spec.md` exists and is non-trivial (>30 lines).
- Verify the spec covers the 8 spec-completeness criteria from `/build`'s step-1e: file paths, contract changes, DB schema, API endpoints, edge cases, UI states, testable ACs, data flow.
- If a spec is incomplete, respawn that one agent with feedback. Don't proceed to architect with a half-baked spec.

Update state file: `milestones[*].status: spec_done`, `milestones[*].gates.spec: PASS`.

---

## 2b. Architect Pre-Dev Pass — MANDATORY for batch builds

**Critical for batch builds — cross-milestone interface gaps are the #1 source of mid-wave respawns.** Catches before any dev agent commits, when the cost of fixing is just "re-run a spec agent."

### Why mandatory for batch (not for single-story /build)

Single-story /build's architect pre-dev is GATED (migration/cross-cutting only) because a single dev agent reading a single spec rarely produces interface drift. Batch builds have N milestones evolving in parallel — Zod schemas, type signatures, function shapes, and JSON contracts cross milestone boundaries every time. An architect pre-dev pass catches:

- M2's exported tool schema doesn't match what M5b's caller imports.
- M5a's `release.ts` extends the same file M2 created, but the two specs disagree on the return shape.
- M3's `/api/state` payload shape conflicts with what M5b extends.
- M4's new orchestrator binary's JSON output schema isn't what M5b's dashboard renderer expects.

### Spawn

```
Agent({
  description: "Architect pre-dev <STORY>",
  subagent_type: "general-purpose",
  team_name: "build-batch-<STORY>",
  prompt: <contents of templates/architect.md with TASK_TYPE=PRE_DEV>
})
```

Architect reads ALL milestone specs, the plan, and the spec source. Output: `planning-artifacts/architect-pre-dev-<STORY>.md` with cross-milestone interface gap findings.

### Verdicts

- **APPROVED** → proceed to TDD wave. `gates.architect_pre_dev: PASS`.
- **APPROVED WITH GUIDANCE** → Lead reads the guidance, updates the affected milestone specs (or respawns spec agents for material rewrites), then re-runs architect on the updated set. `gates.architect_pre_dev: PASS` only when architect reports clean.
- **BLOCKED** → architect found a structural gap that can't be fixed at the spec level. Surface to operator before proceeding. Common causes: dependency cycle between milestones, missing operator decision, planner sized something impossibly.

### When architect demands material changes to a spec

If the architect's guidance requires rewriting a spec section (not just clarifying), respawn the spec agent for THAT milestone with the architect's feedback as context. Don't have Lead edit specs directly — keeps the spec-author-vs-reviewer separation clean.

---

## 2c. Wave 1 — TDD (N parallel test agents)

Output: failing integration/unit/e2e tests committed to the worktree branch — ONE file per milestone (in the appropriate test framework — Jest for api, Vitest for web, Playwright for smoke, custom for bash/MCP).

### Spawn

```
Agent({
  description: "TDD tests ROK-XXXX M<N>",
  subagent_type: "devedup-rl:tester",
  team_name: "build-batch-<STORY>",
  prompt: <contents of templates/test-agent.md with the milestone substituted>
})
```

Spawn ALL N test agents in parallel. They write to different test files, so file-level isolation is automatic.

### Lead audit (STRICT — mirrors /build step 2d)

For each milestone, the test agent's report MUST include a TDD Test Report table with one row per AC:

```
| AC | Test path | Confirmed Failing? |
|----|-----------|--------------------|
| 1  | api/.../foo.spec.ts:42 | YES — "Cannot find module './bar'" |
| 2  | api/.../foo.spec.ts:81 | YES — "expected {x:1} but got undefined" |
```

If `Confirmed Failing? = NO` for any AC → respawn that agent. The assertion is too weak (passes without the implementation existing).

If the report is missing the table entirely → respawn.

For each milestone:
- Run the test in isolation: `npm run test -w <workspace> -- <test-path>` (or framework equivalent).
- Confirm the test FAILS for the reason the agent reported (red phase of red-green-refactor).
- Verify the test file was committed via pathspec: `cd <worktree> && git log --oneline -<wave-size>`.

**Hard rule:** do NOT proceed to dev waves unless EVERY milestone's TDD test is `gates.test_first: PASS`. If a test agent fails validation 3x, escalate to operator — never skip TDD.

Update state file: `milestones[*].status: test_done`, `milestones[*].gates.test_first: PASS`.

---

## 2d. Wave 2..K — Dev Waves

Drive off `<worktree>/build-state.yaml::waves[]`. For each wave with `phase: dev`:

### Per-wave loop

1. **Read the wave's `members` array** (e.g. `[M2, M3, M4]`).
2. **Verify dependencies clear:** every wave member's `depends_on` milestones must be `status: completed`. If not, STOP and surface the gap.
3. **Spawn dev agents in parallel** — one per wave member, in the SAME response (multiple Agent() tool calls).
4. **Wait for all to return.**
5. **Lead audit** — per-dev AC audit + between-wave audit (see below).
6. **Update state**, advance `current_wave`, persist `<worktree>/build-state.yaml`.
7. **Loop to next wave.**

### Spawning each dev agent

```
Agent({
  description: "Dev ROK-XXXX M<N>",
  subagent_type: "devedup-rl:implementer",
  team_name: "build-batch-<STORY>",
  prompt: <contents of templates/dev-agent.md with the milestone substituted>
})
```

### Per-milestone dev brief

Before spawning, Lead writes `planning-artifacts/dev-brief-<STORY>-M<N>.md` ONCE per milestone with:
- Reference to spec + plan files (DO NOT inline)
- Hard pathspec list (the file_set from the plan)
- "Files you may NOT touch" list (other waves' file_sets + any operator config paths)
- Any wave-specific coordination notes (e.g. "M5a depends on M2's `release.ts` shape — read that file before extending")
- Architect pre-dev guidance for this milestone (if any was produced in 2b)

The agent prompt is 3 lines: "Read `planning-artifacts/specs/<STORY>-M<N>-spec.md` and `planning-artifacts/dev-brief-<STORY>-M<N>.md`. Implement against the failing tests written in Wave 1. Commit with `git commit -o <paths>` only. Report back ≤500 words with the AC trace table from templates/dev-agent.md."

### Per-dev AC audit (STRICT — mirrors /build step 2f)

Do NOT blindly trust the dev's output. After each dev agent returns:

1. **Read the dev's AC trace table.** Missing → FAIL, respawn.
2. **Spot-check 2-3 ACs end-to-end in the worktree:**
   - Pick the most complex AC (multi-layer features, combined filters, conditional behavior).
   - For backend: read controller → service → query helper; confirm params flow at every layer.
   - For frontend: read the rendered component tree; confirm each UI element from the spec exists.
   - For orchestrator binaries: read the script + state writes + audit log entries.
3. **Check default/edge semantics:**
   - What happens when a param isn't set? Does the default match the spec?
   - Concurrency — does the implementation use `flock` where required by the spec?
   - Pre-existing tech-debt entries — did the dev document new failures per CLAUDE.md STRICT rule?
4. **Run the wave's tests in isolation** — confirm they now PASS (green phase):
   ```bash
   for milestone_id in <wave members>; do
     npm run test -w <ws> -- <test-path>
   done
   ```
5. **Verdict per milestone:**
   - All verified + tests pass → `gates.dev: PASS`.
   - AC broken → `gates.dev: FAIL`, fix directly (≤3 lines) or respawn dev with specific feedback.

This is the gate /build's experience shows catches cross-layer bugs that escape devs ~50% of the time. Don't skip it because the dev "sounds confident."

### Between-wave audit (after ALL dev agents in the wave have passed per-dev audit)

```bash
cd <worktree>

# 1. See what each agent committed
git log --oneline HEAD~<wave-size>..HEAD

# 2. Pathspec discipline — no agent touched files outside its declared file_set
for milestone_id in <wave members>; do
  declared_files=$(yq ".milestones.$milestone_id.file_set[]" build-state.yaml)
  committed_files=$(git show --name-only --format= <milestone's commits>)
  # Compare — any committed file not in declared = scope creep, flag it
done

# 3. Sanity check the combined diff
npx tsc --noEmit -p api/tsconfig.json    # if api touched
npx tsc --noEmit -p web/tsconfig.json    # if web touched
npm run lint -w <touched workspace>

# 4. wait:true backcompat check (if story touches MCP/CLI surface used by /push)
./rl-infra/cli/rl --help   # synthetic check; full check happens in Step 3
```

On audit failure:
- Lint/type errors → Lead fixes directly (≤3 lines), commits `fix: resolve <wave-N> lint/type (<STORY>)`.
- Test failures from a PREVIOUS wave's tests now failing → respawn the milestone that broke them.
- Pathspec violation → respawn the offending agent; revert off-bounds files via `git checkout HEAD~<wave-size> -- <off-bounds-files>`.

Mark the wave `status: completed` only when audit passes.

### Cost discipline (STRICT)

- Lead does NOT capture full stdout from agents. Each agent's SendMessage report is ≤500 words; that's the source of truth.
- Lead does NOT paste agent reports between waves. Read state file to know status.
- Lead spot-checks 1-2 files per agent for shape during AC audit, doesn't read every committed file.

### Recovery from agent dropout

If an agent socket-drops mid-task: use SendMessage with the agent's UUID/name to resume. Do NOT spawn a new agent for the same milestone — the partially-committed work would conflict.

If an agent is genuinely dead (>15min no response, no UUID resumable): check what they committed via git log, then spawn a NEW agent with the prompt "Resume implementation of M<N>. The prior agent committed <list>. Continue from there to AC <N+1>."

---

## When step 2 is "done"

All milestones have `status: completed`, all gates `dev: PASS`. Every dev wave's per-dev AC audit + between-wave audit passed. The combined branch has all milestones merged via their pathspec-isolated commits.

Update `pipeline.current_step: validate`, `pipeline.next_action: "Read step-3-validate.md."`. Proceed to **Step 3 — Validate.**
