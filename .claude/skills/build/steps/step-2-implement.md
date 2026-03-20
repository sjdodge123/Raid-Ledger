# Step 2: Implement — Worktrees, Planner, Architect, Dev, Test

**Lead creates worktrees and spawns subagents. Max 2-3 dev subagents in parallel.**

---

## 2a. Create Worktrees

For each story in the batch:

```bash
# Create branch from main
git branch rok-<num>-<short-name> origin/main

# Create worktree
git worktree add ../Raid-Ledger--rok-<num> rok-<num>-<short-name>

# Setup worktree — copies .env files, installs deps, builds contract
# The deploy script is worktree-aware and handles everything automatically
cd ../Raid-Ledger--rok-<num> && ./scripts/deploy_dev.sh --ci --rebuild && cd -
```

**DO NOT manually copy .env files, run npm install, or npm audit fix.** The deploy script handles all of this. See CLAUDE.md "Local Dev Environment" for details.

Update state for each story: `status: "worktree_ready"`

---

## 2b. Optional: Planner (full scope only)

For stories with `needs_planner: true`:

1. Read `templates/planner.md`
2. Fill in the template variables
3. Spawn as a subagent:

```
Agent(prompt: <filled planner.md>)
```

4. The planner's implementation plan is returned directly in the agent output
5. Save the plan — it gets passed to the dev subagent

---

## 2c. Optional: Architect Pre-Dev (full scope only)

For stories with `needs_architect: true`:

1. Read `templates/architect.md`
2. Set `<TASK_TYPE>` to `PRE_DEV`
3. Pass the planner's output (or story spec if no planner)
4. Spawn as a subagent:

```
Agent(prompt: <filled architect.md>)
```

5. Check the returned verdict:
   - **APPROVED / GUIDANCE:** Proceed to dev (pass guidance along)
   - **BLOCKED:** Present to operator for resolution before spawning dev

---

## 2d. E2E Test First — TDD (BEFORE dev starts)

**For standard/full scope stories**, spawn a test agent to write the **failing** end-to-end test BEFORE the dev agent starts. This is TDD — the test defines "done" and the dev builds to make it pass.

**Skip for light scope** (config, copy, docs — no testable behavior).

### Determine test type from the story's area:

| Area Touched | Test Type | Location |
|-------------|-----------|----------|
| UI (web pages/components) | Playwright smoke test (desktop + mobile) | `scripts/smoke/<feature>.smoke.spec.ts` |
| Discord bot / notifications | Discord companion bot smoke test | `tools/test-bot/src/smoke/tests/<feature>.test.ts` |
| API-only (no UI/Discord) | Integration test (Jest, real DB) | `api/src/<module>/*.integration.spec.ts` |

### Spawn E2E test agent:

Read `templates/test-agent.md`, fill in template variables, and set `<TASK_TYPE>` to `TDD_WRITE_FAILING`:

```
Agent(prompt: <filled test-agent.md>, model: "sonnet")
```

The test agent must:
1. Read the story spec and acceptance criteria
2. Write the appropriate test type (Playwright/Discord smoke/integration)
3. Run the test and **confirm it FAILS** (the feature doesn't exist yet)
4. Commit the failing test: `test: add failing e2e test for ROK-XXX`
5. Report which test file was created and what assertions it makes

Update state: `gates.e2e_test_first: PASS`, `status: "test_written"`

If the test agent writes a test that **passes** (feature already works), investigate — the story may already be done or the test isn't asserting the right thing.

---

## 2e. Spawn Dev Subagents (parallel, max 2-3)

For each story with a failing test ready:

1. Read `templates/dev.md`
2. Fill in template variables:
   - `<WORKTREE_PATH>`: the story's worktree
   - `<ROK-XXX>`, `<TITLE>`: from state file
   - `<NEW | REWORK>`: based on story origin
   - **`<TEST_FILE>`**: path to the failing test from step 2d
   - Planner output and architect guidance if applicable
3. **Include in the dev prompt:** "A failing test exists at `<TEST_FILE>`. Your job is to make it pass. Run the test after implementing to confirm."
4. Spawn (use parallel `Agent` calls for multiple stories):

```
Agent(prompt: <filled dev.md>)
```

Update state: `status: "dev_active"`, `gates.dev: PENDING`

Update `next_action` fields:
```yaml
pipeline.next_action: |
  Dev subagents active for: ROK-XXX, ROK-YYY.
  When each dev completes: Lead AC audit.
  When all stories reach "ready_for_validate": read steps/step-3-validate.md.
stories.ROK-XXX.next_action: |
  Dev subagent active. Must make failing test pass.
```

---

## 2f. When Dev Completes → Lead AC Audit (MANDATORY)

When a dev subagent returns its output, the Lead **MUST** audit the AC trace table before proceeding. Do NOT blindly trust the dev agent's output.

### Lead AC Audit Checklist

1. **Read the dev's AC trace table.** If the dev didn't produce one, treat this as a FAIL — re-spawn the dev.
2. **Spot-check 2-3 ACs end-to-end** by reading the actual files in the worktree:
   - Pick the most complex AC (multi-layer features, combined filters, conditional behavior)
   - Read the controller → service → query helper chain and confirm the param flows through every layer
   - Read the rendered component tree and confirm each UI element from the spec exists
3. **Check default/edge semantics:**
   - What happens when a filter is "not set"? Does the default match what the UI shows?
   - If filters combine (e.g., gameId + role), does the query path handle BOTH params together?
   - Are there any hard-coded constant lists (like HEART_SOURCES) that might not match the UI's options?
4. **Verdict:**
   - **All ACs verified → `gates.dev: PASS`** — proceed to test subagent
   - **Any AC broken → `gates.dev: FAIL`** — fix directly in the worktree (if simple) or re-spawn dev with specific feedback

### After AC Audit passes:

1. **Verify the TDD test passes.** Run the test that was written in step 2d:
   - Playwright: `npx playwright test <test_file>`
   - Discord smoke: `cd tools/test-bot && npm run smoke`
   - Integration: `npm run test -w api -- --testPathPattern=<test_file>`
2. **If the test passes** → `gates.dev: PASS`, `status: "ready_for_validate"`
3. **If the test still fails** → re-spawn dev with the specific failure output, or fix directly

---

## Post-Compaction Recovery

If you've just recovered from compaction and state shows stories in `dev_active` or `testing`:

1. Check the worktree for commits:
   ```bash
   cd <worktree_path> && git log --oneline -5
   ```
2. If dev committed but test subagent wasn't spawned yet → spawn test subagent
3. If dev didn't commit → re-spawn dev subagent (the worktree has their partial work)

---

## Proceed

When ALL stories in the batch reach `ready_for_validate`, proceed to **Step 3**.
