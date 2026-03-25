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

After worktree creation, verify env files are present:
```
mcp__mcp-env__env_check()
```
If any .env files are missing (common for `tools/test-bot/.env`), copy them:
```
mcp__mcp-env__env_copy({ file: "tools/test-bot/.env" })
```

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

## 2d. E2E Test First — TDD (MANDATORY for standard/full scope)

**This step is NOT optional. Every standard and full scope story MUST have a failing test committed BEFORE the dev agent starts.** No exceptions. No judgment calls. No "this is simple enough to skip."

If the scope is `light` (config, copy, docs — no testable runtime behavior), set `gates.e2e_test_first: N/A` and proceed. For ALL other scopes, this gate MUST be PASS before spawning any dev agent.

### Determine test type from the story's area:

| Area Touched | Test Type | Location |
|-------------|-----------|----------|
| UI (web pages/components) | Playwright smoke test (desktop + mobile) | `scripts/smoke/<feature>.smoke.spec.ts` |
| Discord bot / notifications | Discord companion bot smoke test | `tools/test-bot/src/smoke/tests/<feature>.test.ts` |
| API-only (no UI/Discord) | Integration test (Jest, real DB) | `api/src/<module>/*.integration.spec.ts` |
| Pure logic / utility | Unit test | `api/src/<module>/*.spec.ts` or `web/src/<module>/*.test.ts` |

### Spawn TDD test agent:

Read `templates/test-agent.md`, fill in template variables, and set `<TASK_TYPE>` to `TDD_WRITE_FAILING`:

```
Agent(prompt: <filled test-agent.md>, model: "sonnet")
```

### Validate the test agent's output (Lead MUST check):

1. **Output includes the TDD Test Report table** — if not, re-spawn the test agent
2. **Every AC has "Confirmed Failing? = YES"** — if any say NO or are missing, re-spawn
3. **Failure output is included** — actual test runner output showing failures. If missing, re-spawn
4. **Test file was committed** — verify in the worktree: `cd <worktree> && git log --oneline -1`

### Gate enforcement:

- `gates.e2e_test_first: PASS` — test agent output validated, failing test committed
- `gates.e2e_test_first: N/A` — light scope only
- **Any other value (PENDING, SKIP, FAIL) blocks dev agent spawn**

**HARD RULE: Do NOT spawn a dev agent for any story where `gates.e2e_test_first` is not PASS or N/A.** If the test agent fails to produce a valid TDD report, re-spawn it. If it fails 3 times, escalate to the operator — do NOT skip TDD and proceed to dev.

If the test agent writes a test that **passes** (feature already works), investigate — the story may already be done or the test isn't asserting the right thing. Do NOT set the gate to PASS if the tests pass — TDD means tests must FAIL first.

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

### E2E Test Coverage Audit (Lead MUST check before proceeding to Step 3)

After dev passes, verify the **right type** of E2E test exists. Cross-reference the story's area against the profiling matrix:

| Area Touched | Required Test Type | How to verify |
|-------------|-------------------|---------------|
| UI (web pages/components) | Playwright smoke test | `ls scripts/smoke/` — new or modified `.smoke.spec.ts` file |
| Discord bot / notifications | Discord companion bot smoke test | `ls tools/test-bot/src/smoke/tests/` — new or modified `.test.ts` file |
| API-only (no UI/Discord) | Integration test (Jest) | `git diff main --name-only \| grep integration.spec` |
| Pure logic / utility | Unit test | `git diff main --name-only \| grep -E '\.spec\.ts\|\.test\.ts'` |

**Check:** Does the test agent's output match the required type from the matrix?
- If story AC mentions "smoke test" or "Discord test" but no such test file exists → **GAP.** Re-spawn test agent with explicit instructions.
- If the dev agent wrote only unit tests but the area requires Playwright/Discord smoke → **GAP.** Spawn test agent to write the missing E2E test.
- Record findings in state: `test_coverage: { type: "<type>", file: "<path>", gap: null | "<description>" }`

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
