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

## 2b. Optional: Planner (full scope)

For `needs_planner: true`: read `templates/planner.md`, fill variables, spawn. The returned plan goes into the dev's prompt.

---

## 2c. Optional: Architect Pre-Dev (full scope)

For `needs_architect: true`: read `templates/architect.md`, set `<TASK_TYPE>` = `PRE_DEV`, pass planner output (or spec), spawn. Verdicts:
- **APPROVED / GUIDANCE:** proceed to dev (pass guidance along).
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

### Full scope — sequence phase-bounded dev agents per story

For `full` scope stories, do NOT spawn one monolithic dev. Sequence phase-bounded agents on that story, writing a brief file first so each phase picks up cheaply:

1. **Write `planning-artifacts/dev-brief-ROK-XXX.md`** (Lead owns this file). Capture:
   - Story summary + spec file pointer
   - Architect guidance (the concrete corrections, not the full prose)
   - Planner phase order (what each phase owns)
   - TDD test file path
   - "Commit after every small cluster" rule
2. **Spawn Phase A** (contract + migration) via `templates/dev.md`. Prompt body is 1-2 lines: "Read `planning-artifacts/dev-brief-ROK-XXX.md`. Execute Phase A (contract + migration). Commit each logical cluster. Report when done."
3. Wait for completion. Lead quickly verifies commits landed (e.g. `git log --oneline origin/main..HEAD`).
4. **Spawn Phase B** (backend) with the same brief pointer + "Execute Phase B. Commit each cluster."
5. Same for **Phase C** (frontend) and **Phase D** (smoke + `validate-ci.sh --full` + dev.md output).
6. Collapse phases if the story has no frontend work, no migration, etc. — adjust the brief accordingly.

Parallelism across *different* stories in the batch is unchanged (still max 2-3 concurrent devs). Phase split is sequential *within* one full-scope story.

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
