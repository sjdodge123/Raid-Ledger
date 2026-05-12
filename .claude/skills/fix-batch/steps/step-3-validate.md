# Step 3: Review & Validate — CI, Chrome MCP, Reviewer, Push

**Lead runs validation directly on the batch branch.**

Order matters: cheap static gates first → deploy + Playwright + **Chrome MCP e2e** (operator-facing browser validation) → reviewer agent → push. The Chrome MCP gate must complete BEFORE the reviewer agent spawns, BEFORE the PR is created, and BEFORE auto-merge is enabled. See `~/.claude/projects/-Users-sdodge-Documents-Projects-Raid-Ledger/memory/feedback_chrome_mcp_e2e_before_review.md` for the rationale.

```bash
# Ensure you're on the batch branch
git checkout fix/batch-YYYY-MM-DD
```

---

## 3a. Build

```bash
npm run build -w packages/contract
npm run build -w api
npm run build -w web
```

If build fails: diagnose which story caused it. Fix directly, commit as `fix: resolve build issue`.

---

## 3b. TypeScript

```bash
npx tsc --noEmit -p api/tsconfig.json
npx tsc --noEmit -p web/tsconfig.json
```

If type errors: fix directly, commit as `fix: resolve type errors`.

---

## 3c. Lint

```bash
npm run lint -w api
npm run lint -w web
```

If lint errors: fix directly, commit as `fix: resolve lint issues`.

---

## 3d. Unit Tests

```bash
npm run test -w api
npm run test -w web
```

If tests fail:
- **Trivial failure** (import path, test setup): fix directly
- **Substantive failure** (logic bug introduced by a story): diagnose which story caused it
  - If fixable: fix directly on the batch branch
  - If complex: create a new worktree from the batch branch, re-spawn dev with failure context

Update state: `gates.ci: PASS` (or `FAIL`)

---

## 3e. Integration Tests

```bash
npm run test:integration -w api
```

If integration tests fail:
- Diagnose which story's changes caused the failure
- Fix directly if possible, otherwise re-spawn dev

Update state: `gates.integration: PASS` (or `FAIL`)

---

## 3f. Acquire Env Lock + Deploy Locally

**Env-lock discipline (STRICT):** hold the lock for the minimum span needed — just deploy (3f) → Playwright (3g) → Chrome MCP (3h). Release immediately after 3h. The reviewer, push, PR, and auto-merge do NOT need the env.

```
mcp__mcp-env__env_lock_status                                                # see who holds it
mcp__mcp-env__env_lock_acquire({ purpose: "fix-batch <id> validation" })     # acquire or queue
```

If queued, do non-env work (PR body draft, spec tidy) until the lock returns. Don't bypass.

```bash
./scripts/deploy_dev.sh --ci --rebuild
curl -s http://localhost:3000/system/status | head -20
```

If deploy fails: stop. Debug the deploy before continuing — there is no point running Playwright or Chrome MCP against a broken env. If the fix is purely code (no env state), release the lock while you fix and re-acquire.

---

## 3g. Playwright Smoke (regression sweep)

Automated regression check across all flows. Runs BOTH desktop and mobile projects (CI runs both — local must match).

```bash
npx playwright test
```

If Playwright fails:
- **Selector/flake failures:** fix the test or the UI, commit `fix: resolve Playwright issues`
- **Real regressions:** diagnose which story broke the flow, fix or re-spawn dev

Never re-run hoping it passes. Never weaken or skip tests to make CI green.

Update state: `gates.playwright: PASS` (or `FAIL`)

---

## 3h. Chrome MCP e2e Gate (MANDATORY — operator-facing browser validation)

This is the new pre-review gate. Drives the *changed user flows* via `mcp__claude-in-chrome__*` on the deployed batch branch, captures screenshots / GIFs, audits console + network, and produces an operator-facing summary. **Must complete BEFORE the reviewer agent runs (3i) and BEFORE the branch is pushed (3j).**

Full playbook: `.claude/skills/_shared/chrome-mcp-e2e.md`.

**What Lead must do here:**

1. Derive the changed-flow list from `git diff origin/main..fix/batch-YYYY-MM-DD --name-only` + each story's ACs.
2. Pass that list + the batch story IDs as inputs to the shared playbook.
3. Execute the playbook step-by-step. Do NOT skim it; the anti-pattern section catches the failure modes that triggered this gate's creation (ROK-1237).
4. Write the summary to `planning-artifacts/chrome-mcp-summary-fix-batch-YYYY-MM-DD.md`. Save captures under `planning-artifacts/chrome-mcp-screenshots/fix-batch-YYYY-MM-DD/`.
5. **Release the env lock IMMEDIATELY after the summary is written** — `mcp__mcp-env__env_lock_release`. Reviewer (3i), test gap (3j), regression check (3k), push (3l), and Step 4 (PR + auto-merge) do NOT need the env. Re-acquire ONLY if a reviewer finding requires a fix + re-verify against the deployed app.

**Gate outcomes:**

- `VERDICT: PASS` → `gates.chrome_mcp_e2e: PASS`. Continue to 3i (reviewer).
- `VERDICT: PASS WITH NOTES` → `gates.chrome_mcp_e2e: PASS`. Log medium/low findings inline in the batch summary; operator decides what becomes a Linear story (do NOT auto-file tech-debt). Continue to 3i.
- `VERDICT: FAIL` → `gates.chrome_mcp_e2e: FAIL`. Do NOT spawn the reviewer. Lead either fixes inline (1-3 lines per fix, `fix: resolve Chrome MCP finding`) or respawns the originating dev with the finding. Re-run the gate after the fix.

**N/A path (rare):** If — and only if — the batch is purely API-internal with no in-app surface (no admin page, no settings panel, no Discord embed consumes it), record `gates.chrome_mcp_e2e: "N/A — api-internal-only"` with a one-line justification. Default is to run the gate.

---

## 3i. Code Review (Reviewer Agent)

Only after Chrome MCP e2e is `PASS` (or `N/A`). Spawn a reviewer agent (sonnet) to review the full batch diff against `origin/main`. The reviewer checks correctness, security, performance, and contract integrity.

```
Agent(subagent_type: "devedup-rl:reviewer", model: "sonnet",
      description: "Review batch diff",
      prompt: """
      Review the changes on branch fix/batch-YYYY-MM-DD compared to origin/main.

      This is a fix-batch containing the following stories:
      <list each ROK-### with title and label>

      Browser validation already complete — see planning-artifacts/chrome-mcp-summary-fix-batch-YYYY-MM-DD.md
      for the changed-flow walkthrough, screenshots, console + network audit, and verdict. Do not duplicate
      that work; focus your review on code-level correctness.

      Run your full review checklist:
      1. Correctness — logic bugs, edge cases, error handling
      2. Security — injection, auth bypass, data exposure
      3. Performance — N+1 queries, unnecessary allocations, missing indexes
      4. Contract integrity — if any shared types changed, are consumers updated?
      5. Standards — ESLint compliance, file/function size limits, naming conventions

      For each finding, classify severity: [critical], [high], [medium], [low].
      Critical/high findings MUST be fixed before shipping.
      """)
```

When the reviewer completes:

1. **Critical/high findings:** Lead fixes directly on the batch branch, or re-spawns a dev if the fix is non-trivial. If a fix touches a changed UI flow, re-run 3h Chrome MCP scoped to that flow.
2. **Medium/low findings:** log them but proceed — operator triages whether to file a Linear tech-debt story (do not auto-file).
3. **Update state:** `gates.review: PASS` (or `FAIL` if critical/high findings remain unfixed)

---

## 3j. Test Gap Analysis

After the reviewer completes, analyze the batch diff for **untested changes** — code paths added or modified by the batch that lack corresponding test coverage.

For each changed source file, check:
1. **Does a corresponding test file exist?** (e.g., `foo.service.ts` → `foo.service.spec.ts`)
2. **Did the test file get updated in this batch?** If the source changed but the test didn't, investigate whether existing tests cover the new/changed behavior.
3. **Are new functions/methods tested?** Check that any new exports have test coverage.

**Actions:**
- If gaps are found: Lead writes the missing tests directly on the batch branch, or spawns a test-writing agent for larger gaps.
- If no gaps: Proceed.

Update state: `gates.test_gaps: PASS` (or `FAIL` if gaps remain)

---

## 3k. Verify Regression Tests (Bug stories only)

Confirm each Bug-labeled story in the batch includes a regression test:

```bash
# Check for Playwright regression tests
grep -n "Regression: ROK-" scripts/verify-ui.spec.ts

# Check for unit/integration regression tests
grep -rn "Regression: ROK-" api/src/ web/src/
```

For each Bug story, verify a matching `Regression: ROK-<num>` test block exists in either the Playwright smoke file or a unit/integration test file. If a Bug story is missing its regression test, flag it — do not proceed until every Bug fix has a corresponding regression test.

Update state: `gates.regression: PASS` (or `FAIL`)

---

## 3l. Push Batch Branch

**Only after every prior gate is PASS.** Use the `/push` skill — NEVER use raw `git push`. The skill runs full local CI before pushing.

```
/push --skip-pr
```

The `--skip-pr` flag skips PR creation — the PR is created in Step 4.

---

## 3m. Update State

```yaml
pipeline:
  current_step: "ship"
  next_action: |
    All validation passed on batch branch. Read steps/step-4-ship.md.
    Create PR, enable auto-merge, sync Linear, cleanup.
  gates:
    ci: PASS
    integration: PASS
    playwright: PASS
    chrome_mcp_e2e: PASS
    review: PASS
    test_gaps: PASS
    regression: PASS
    pr: PENDING
```

All story statuses remain `merged_to_batch` — they'll be updated to `done` in Step 4.

Proceed to **Step 4**.
