# Step 2: Implement — Worktrees, Planner, Architect, Test, Dev

Lead creates worktrees, spawns subagents. Max 2-3 devs in parallel.

---

## 2a. Bring Up Environment (once per batch) and Create Worktrees

**Lead owns Docker. Devs never touch it.** This step has two parts.

### Once per batch — start the environment (Lead runs in main repo):

```bash
./scripts/deploy_dev.sh --ci --rebuild
```

Docker, API, web are now running and shared by all worktrees (Docker is process-level, not directory-level).

Verify env files: `mcp__mcp-env__env_check()`. If `tools/test-bot/.env` is missing: `mcp__mcp-env__env_copy({ file: "tools/test-bot/.env" })`.

### Per story — lightweight worktree setup (Lead runs, not dev):

```bash
git branch rok-<num>-<short-name> origin/main
git worktree add ../Raid-Ledger--rok-<num> rok-<num>-<short-name>
cd ../Raid-Ledger--rok-<num>
npm install
npm run build -w packages/contract
cd -
```

Then verify env files copied into the worktree (the deploy_dev script does this for main repo but worktrees need their own):
```
mcp__mcp-env__env_check()
```
If missing `.env`, `api/.env`, or `tools/test-bot/.env`, call `mcp__mcp-env__env_copy({ file: "<path>" })` for each.

No Docker restart, no DB reset. Devs inherit a working env.

Update state: `status: "worktree_ready"`.

---

## 2b. Planner — STRICT gating

**Skip the planner unless:**
- DB migration, OR
- ≥4 modules with non-trivial logic in each, OR
- Operator explicitly asked for planner.

A new Zod schema + matching backend + matching UI does NOT need a planner. The dev reads the spec directly.

If you do spawn it: `templates/planner.md` — pass only `<WORKTREE_PATH>`, `<ROK-XXX>`, `<TITLE>`, and the file path to the spec. The planner reads everything else from disk. Planner writes its plan to `planning-artifacts/plan-ROK-XXX.md` and sends Lead a ≤300-word summary.

---

## 2c. Architect Pre-Dev — STRICT gating

**Skip the architect unless:**
- Migration with non-trivial schema change, OR
- Cross-cutting infrastructure change (Dockerfile, supervisor, nginx, auth core), OR
- Operator explicitly asked for architect.

For most stories the dev follows existing patterns and an architect adds zero value.

If you do spawn it: `templates/architect.md`, `<TASK_TYPE>` = `PRE_DEV`. Architect reads spec + plan from disk. Verdicts (≤300-word summary; full findings on disk):
- **APPROVED / GUIDANCE:** proceed to dev.
- **BLOCKED:** present to operator before spawning dev.

---

## 2d. E2E Test First — TDD

Every standard/full story MUST have a failing test committed BEFORE the dev starts. Light scope only: set `gates.e2e_test_first: N/A` and skip.

Read `templates/test-agent.md`, set `<TASK_TYPE>` = `TDD_WRITE_FAILING`, spawn.

### Lead validates test agent output:

1. Output includes TDD Test Report table → else respawn.
2. Every AC has "Confirmed Failing? = YES" → else respawn.
3. Failure output is actual test runner output → else respawn.
4. Test file committed in worktree: `cd <worktree> && git log --oneline -1`.

Gate: `PASS` (validated + committed) or `N/A` (light only). Any other value blocks dev spawn.

**Hard rule:** do NOT spawn dev unless `gates.e2e_test_first` is PASS or N/A. If the test agent fails validation 3x, escalate to operator — never skip TDD.

If the test passes (feature already works), investigate. The story may be done or the assertion is wrong. Do NOT set the gate PASS — TDD tests must FAIL first.

---

## 2e. Spawn Dev Subagents (parallel across stories, max 2-3)

### Standard / light scope — one dev per story

For each `standard` or `light` story with a failing test ready:

1. Read `templates/dev.md`.
2. Fill variables: `<WORKTREE_PATH>`, `<ROK-XXX>`, `<TITLE>`, `<NEW | REWORK>`, `<TEST_FILE>`, plus planner/architect output if applicable.
3. Spawn in parallel (single message, multiple `Agent` calls).

### Full scope — phase-split is RARE

Phase-split is sequential and expensive (each new dev re-loads context). **Only split when:**
- The story has a DB migration (Phase A = migration alone, then Phase B+ for code), OR
- ≥30 files will change, OR
- The dev's first attempt actually ran out of context mid-story.

For most `full`-scope stories: spawn ONE dev with the full brief and let it commit incrementally as it goes. Lead writes `planning-artifacts/dev-brief-ROK-XXX.md` once, the dev reads it once, and works the whole story end-to-end.

When you do split: write the brief, spawn Phase A, wait for the ≤300-word completion report, spawn Phase B, etc. Each phase prompt body is 1-2 lines pointing at the brief. Collapse phases (e.g. fold smoke into Phase B) when the work doesn't justify a separate agent.

Parallelism across *different* stories in the batch is unchanged (still max 2-3 concurrent devs).

Update state: `status: "dev_active"`, `gates.dev: PENDING`, `pipeline.next_action: "Devs active: ROK-XXX [phase], ROK-YYY. On completion: Lead AC audit. When all ready_for_validate → read step-3-validate.md."`.

---

## 2f. When Dev Completes → Lead AC Audit

Do NOT blindly trust the dev's output.

### AC Audit Checklist

1. Read the dev's AC trace table. Missing → FAIL, respawn.
2. Spot-check 2-3 ACs end-to-end in the worktree:
   - Pick the most complex AC (multi-layer features, combined filters, conditional behavior).
   - Read controller → service → query helper; confirm the param flows at every layer.
   - Read the rendered component tree; confirm each UI element from the spec exists.
3. Check default/edge semantics:
   - What happens when a filter isn't set? Does the default match the UI?
   - If filters combine (e.g. gameId + role), does the query handle BOTH together?
   - Any hard-coded constant lists (like HEART_SOURCES) that don't match the UI's options?
4. Verdict: all verified → `gates.dev: PASS` → test runner check. Any AC broken → `gates.dev: FAIL`, fix directly (if simple) or respawn dev with specific feedback.

### Verify TDD test passes

Run the test from 2d:
- Playwright: `npx playwright test <file>`
- Discord smoke: `cd tools/test-bot && npm run smoke`
- Integration: `npm run test -w api -- --testPathPattern=<file>`

Pass → `status: "ready_for_validate"`. Still fails → respawn dev with the failure output.

### E2E coverage audit

Verify the right type of E2E test exists (cross-reference area against SKILL.md's matrix). If the story touches UI but no Playwright file exists, or Discord but no smoke test — spawn test agent to fill the gap. Record in state: `test_coverage: { type, file, gap }`.

---

## Post-Compaction Recovery

State shows `dev_active` or `testing` → check the worktree: `cd <worktree> && git log --oneline -5`. If dev committed but test subagent never spawned → spawn it. If dev didn't commit → respawn dev (worktree has partial work).

---

When ALL stories reach `ready_for_validate`, proceed to **Step 3**.
