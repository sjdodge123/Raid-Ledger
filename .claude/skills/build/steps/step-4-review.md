# Step 4: Review — Poll Linear, Rework, Reviewer, Architect, Smoke

---

## 4a. Check Story Status in Linear

When operator signals ready, poll each story: `mcp__linear__get_issue({ issueId: "<linear_id>" })`.

### Changes Requested → Rework Loop

1. Read operator's feedback (Linear comments or direct message).
2. **Commit any operator testing changes first** (mandatory):
   ```bash
   cd <worktree>
   git add -A && git status
   git commit -m "test: operator testing changes (ROK-XXX)"  # if changes exist
   ```
3. Respawn dev with `<TASK_TYPE>` = `REWORK` and the feedback. Dev will emit `rework_scope` in its output.
4. When dev returns, **verify `rework_scope` before trusting it:**

   **Auto-force `material` if:**
   - Operator feedback mentions "Playwright", "smoke", "test", "failing test", or any test-file path
   - Operator feedback mentions contract, migration, or cross-module behavior
   - `git diff main..HEAD --stat` shows changes in >1 non-test source file
   - Any `packages/contract/`, `api/src/drizzle/migrations/`, `Dockerfile*`, `nginx/**`, `tools/**`, or `scripts/**` in diff

   Otherwise accept dev's classification.

5. Branch on final `rework_scope`:

   **trivial** — fast path (skip full revalidation):
   - Verify Local CI Proof is clean (trust the dev's scoped run)
   - Push from the worktree:
     ```bash
     cd <worktree>
     git fetch origin main && git rebase origin/main
     git push
     cd -
     ```
   - Skip full deploy/Playwright/smoke — operator will re-test
   - Loop back to 4a (operator tests the fix)

   **material** — full path:
   - Spawn test agent if new behavior added (standard/full scope)
   - Loop back to Step 3 (full CI, push, deploy, Playwright)

6. State: `status: "rework"`, `gates.operator: REJECT`, record `rework_scope` (and whether Lead forced material) for audit trail.

### Code Review → Proceed

1. Commit operator testing changes if any (same as above).
2. Push from the worktree (inline — no `/push` skill nesting):
   ```bash
   cd <worktree>
   git fetch origin main && git rebase origin/main
   # If rebase pulled new commits: re-run CI scope appropriate to the story
   git push
   cd -
   ```
3. State: `gates.operator: PASS`, `status: "reviewing"`.
4. Linear → "Code Review":
   ```
   mcp__linear__save_issue({ issueId: "<linear_id>", statusName: "Code Review" })
   ```
5. Continue to 4b.

---

## 4b. Spawn Reviewer

Read `templates/reviewer.md`, fill, spawn. Verdicts:
- **APPROVED / APPROVED WITH FIXES:** `gates.reviewer: PASS`. If with fixes, push auto-fix commits before proceeding.
- **BLOCKED:** present blockers to operator. May need dev respawn.

---

## 4c. Optional: Architect Final (if needs_architect)

Sequential — must finish before smoke. Read `templates/architect.md`, `<TASK_TYPE>` = `POST_REVIEW`, pass `git diff main..HEAD`. Verdicts same as 4b. BLOCKED → resolve before shipping.

---

## 4d. Lead Smoke Tests

Never skipped, even for light scope. From main worktree:

```bash
git pull --rebase origin main
npm run build -w packages/contract && npm run build -w api && npm run build -w web
npm run test -w api && npm run test -w web
npx tsc --noEmit -p api/tsconfig.json && npx tsc --noEmit -p web/tsconfig.json
```

If UI changes: `npx playwright test`.

Gate: `gates.smoke_test: PASS` or `FAIL`. On failure: diagnose (timing? `sleep()`?). Regression → fix or respawn dev. Test infra issue (flaky, missing wait) → fix the test, don't skip. **Never dismiss as "pre-existing"** — investigate and fix, or create a Linear story with root cause.

---

## 4e. Update State

```yaml
stories.ROK-XXX:
  status: "ready_to_ship"
  next_action: "All gates passed. Read step-5-ship.md."
```

When ALL stories reach `ready_to_ship`, proceed to **Step 5**.
