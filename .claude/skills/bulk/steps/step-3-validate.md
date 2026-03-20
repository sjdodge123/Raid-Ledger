# Step 3: Review & Validate — Code Review, Test Gaps, Build, Tests, Smoke

**Lead runs validation directly on the batch branch. Reviewer agent spawned for code review.**

All validation runs in the main worktree on the `batch/YYYY-MM-DD` branch.

```bash
# Ensure you're on the batch branch
git checkout batch/YYYY-MM-DD
```

---

## 3a. Code Review (Reviewer Agent)

Spawn a reviewer agent (sonnet) to review the full batch diff against `origin/main`. The reviewer checks correctness, security, performance, and contract integrity.

```
Agent(subagent_type: "devedup-rl:reviewer", model: "sonnet",
      description: "Review batch diff",
      prompt: """
      Review the changes on branch batch/YYYY-MM-DD compared to origin/main.

      This is a batch containing the following stories:
      <list each ROK-### with title and label>

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

1. **Critical/high findings:** Lead fixes directly on the batch branch, or re-spawns a dev if the fix is non-trivial.
2. **Medium/low findings:** Log them but proceed — create Linear tech-debt stories for medium findings if they warrant follow-up.
3. **Update state:** `gates.review: PASS` (or `FAIL` if critical/high findings remain unfixed)

---

## 3b. Test Gap Analysis

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

## 3c. Build

```bash
npm run build -w packages/contract
npm run build -w api
npm run build -w web
```

If build fails: diagnose which story caused it. Fix directly, commit as `fix: resolve build issue`.

---

## 3d. TypeScript

```bash
npx tsc --noEmit -p api/tsconfig.json
npx tsc --noEmit -p web/tsconfig.json
```

If type errors: fix directly, commit as `fix: resolve type errors`.

---

## 3e. Lint

```bash
npm run lint -w api
npm run lint -w web
```

If lint errors: fix directly, commit as `fix: resolve lint issues`.

---

## 3f. Unit Tests

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

## 3g. Integration Tests

```bash
npm run test:integration -w api
```

If integration tests fail:
- Diagnose which story's changes caused the failure
- Fix directly if possible, otherwise re-spawn dev

Update state: `gates.integration: PASS` (or `FAIL`)

---

## 3h. Playwright Smoke Tests (MANDATORY)

Run the Playwright smoke suite against the deployed app. This is required for every batch — not just UI changes — because backend changes can break UI flows.

1. Deploy locally:
   ```bash
   ./scripts/deploy_dev.sh
   ```

2. Verify health:
   ```bash
   curl -s http://localhost:3000/system/status | head -20
   ```

3. Run smoke tests:
   ```bash
   npx playwright test
   ```

If Playwright fails:
- **Selector/flake failures:** Fix the test or the UI, commit as `fix: resolve Playwright issues`
- **Real regressions:** Diagnose which story broke the flow, fix or re-spawn dev.

Update state: `gates.smoke: PASS` (or `FAIL`)

---

## 3i. Push Batch Branch

**Use the `/push` skill** — NEVER use raw `git push`. The skill runs full local CI before pushing.

```
/push --skip-pr
```

The `--skip-pr` flag skips PR creation — the PR is created in Step 4.

---

## 3j. Update State

```yaml
pipeline:
  current_step: "ship"
  next_action: |
    All validation passed on batch branch. Read steps/step-4-ship.md.
    Create PR, enable auto-merge, sync Linear, cleanup.
  gates:
    review: PASS
    test_gaps: PASS
    ci: PASS
    integration: PASS
    smoke: PASS
    pr: PENDING
```

All story statuses remain `merged_to_batch` — they'll be updated to `done` in Step 4.

Proceed to **Step 4**.
