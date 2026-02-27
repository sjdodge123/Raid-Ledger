# Step 3: Validate — Build, Tests, Integration, Optional Smoke

**Lead runs everything directly on the batch branch. No agents spawned.**

All validation runs in the main worktree on the `fix/batch-YYYY-MM-DD` branch.

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

## 3f. Smoke Tests (if any story has UI changes)

Check if any story in the batch touches `web/src/` files. If yes:

1. Deploy locally:
   ```bash
   ./scripts/deploy_dev.sh
   ```

2. Verify health:
   ```bash
   curl -s http://localhost:3000/api/health | head -20
   ```

3. Run smoke tests:
   ```bash
   npx playwright test
   ```

If no stories touch UI files, mark smoke as SKIP.

Update state: `gates.smoke: PASS` (or `FAIL` or `SKIP`)

---

## 3g. Push Batch Branch

```bash
git push -u origin fix/batch-YYYY-MM-DD
```

---

## 3h. Update State

```yaml
pipeline:
  current_step: "ship"
  next_action: |
    All validation passed on batch branch. Read steps/step-4-ship.md.
    Create PR, enable auto-merge, sync Linear, cleanup.
  gates:
    ci: PASS
    integration: PASS
    smoke: PASS | SKIP
    pr: PENDING
```

All story statuses remain `merged_to_batch` — they'll be updated to `done` in Step 4.

Proceed to **Step 4**.
