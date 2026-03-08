# Step 3: Validate — Build, Tests, Integration, Optional Smoke

**Lead runs everything directly on the batch branch. No agents spawned.**

All validation runs in the main worktree on the `fix/batch-YYYY-MM-DD` branch.

```bash
# Ensure you're on the batch branch
git checkout fix/batch-YYYY-MM-DD
```

---

## 3a. Verify Regression Tests (Bug stories only)

Before running the test suites, confirm each Bug-labeled story in the batch includes a regression test:

```bash
# Check for Playwright regression tests
grep -n "Regression: ROK-" scripts/verify-ui.spec.ts

# Check for unit/integration regression tests
grep -rn "Regression: ROK-" api/src/ web/src/
```

For each Bug story, verify a matching `Regression: ROK-<num>` test block exists in either the Playwright smoke file or a unit/integration test file. If a Bug story is missing its regression test, flag it — do not proceed until every Bug fix has a corresponding regression test.

Update state: `gates.regression: PASS` (or `FAIL`)

---

## 3b. Build

```bash
npm run build -w packages/contract
npm run build -w api
npm run build -w web
```

If build fails: diagnose which story caused it. Fix directly, commit as `fix: resolve build issue`.

---

## 3c. TypeScript

```bash
npx tsc --noEmit -p api/tsconfig.json
npx tsc --noEmit -p web/tsconfig.json
```

If type errors: fix directly, commit as `fix: resolve type errors`.

---

## 3d. Lint

```bash
npm run lint -w api
npm run lint -w web
```

If lint errors: fix directly, commit as `fix: resolve lint issues`.

---

## 3e. Unit Tests

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

## 3f. Integration Tests

```bash
npm run test:integration -w api
```

If integration tests fail:
- Diagnose which story's changes caused the failure
- Fix directly if possible, otherwise re-spawn dev

Update state: `gates.integration: PASS` (or `FAIL`)

---

## 3g. Playwright Smoke Tests (MANDATORY)

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

Update state: `gates.playwright: PASS` (or `FAIL`)

---

## 3h. Push Batch Branch

```bash
git push -u origin fix/batch-YYYY-MM-DD
```

---

## 3i. Update State

```yaml
pipeline:
  current_step: "ship"
  next_action: |
    All validation passed on batch branch. Read steps/step-4-ship.md.
    Create PR, enable auto-merge, sync Linear, cleanup.
  gates:
    regression: PASS
    ci: PASS
    integration: PASS
    playwright: PASS
    pr: PENDING
```

All story statuses remain `merged_to_batch` — they'll be updated to `done` in Step 4.

Proceed to **Step 4**.
