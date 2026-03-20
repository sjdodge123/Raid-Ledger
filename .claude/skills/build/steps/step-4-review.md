# Step 4: Review — Poll Linear, Rework, Reviewer, Architect, Smoke

**Lead checks Linear directly, handles rework loops, and runs final gates.**

---

## 4a. Check Story Status in Linear

When the operator signals they're ready, poll each story:

```
mcp__linear__get_issue({ issueId: "<linear_id>" })
```

Check the status and route accordingly:

### Changes Requested → Rework Loop
1. Read the operator's feedback (Linear comments or direct message)
2. **Commit any operator testing changes first** (MANDATORY):
   ```bash
   cd <worktree_path>
   git add -A
   git status
   # If there are changes:
   git commit -m "test: operator testing changes (ROK-XXX)"
   ```
3. Re-spawn dev agent with `<TASK_TYPE>` = `REWORK` and the feedback
4. When dev completes → spawn test agent (if standard/full)
5. **Loop back to Step 3** (re-validate, re-push, re-deploy)
6. Update state: `status: "rework"`, `gates.operator: REJECT`

### Code Review → Proceed to Review Gates
1. **Commit any operator testing changes first** (MANDATORY):
   ```bash
   cd <worktree_path>
   git add -A
   git status
   # If there are changes:
   git commit -m "test: operator testing changes (ROK-XXX)"
   git push origin rok-<num>-<short-name>
   ```
2. Update state: `gates.operator: PASS`, `status: "reviewing"`
3. Update Linear to "Code Review":
   ```
   mcp__linear__save_issue({
     issueId: "<linear_id>",
     statusName: "Code Review"
   })
   ```
4. Continue to 4b

---

## 4b. Spawn Reviewer

Read `templates/reviewer.md`, fill in the template, and spawn:

```
Agent(prompt: <filled reviewer.md>)
```

Check the reviewer's returned verdict:
- **APPROVED / APPROVED WITH FIXES:** Update `gates.reviewer: PASS`. Continue.
  - If APPROVED WITH FIXES: push the reviewer's commits before proceeding
- **BLOCKED:** Present blocking issues to operator. May need dev re-spawn.

---

## 4c. Optional: Architect Final Check (if needs_architect)

**SEQUENTIAL — must complete before smoke tests.**

Read `templates/architect.md`, set `<TASK_TYPE>` to `POST_REVIEW`, pass the full diff:

```
Agent(prompt: <filled architect.md with git diff main..HEAD>)
```

Check the returned verdict:
- **APPROVED / GUIDANCE:** Update `gates.architect_final: PASS`. Continue.
- **BLOCKED:** Present to operator. Must resolve before shipping.

---

## 4d. Lead Runs Smoke Tests

**NEVER skipped, even for light scope stories.**

Lead runs the full test + build suite from the main worktree:

```bash
# Ensure main is up to date
git pull --rebase origin main

# Full build
npm run build -w packages/contract
npm run build -w api
npm run build -w web

# Full test suite
npm run test -w api
npm run test -w web

# Type check
npx tsc --noEmit -p api/tsconfig.json
npx tsc --noEmit -p web/tsconfig.json
```

If Playwright tests are relevant (UI changes):
```bash
npx playwright test
```

Update state: `gates.smoke_test: PASS` (or `FAIL`)

If smoke tests fail:
- Diagnose the failure — read the error, check if it's timing-related (`sleep()` usage)
- If it's a regression from this story → fix or re-spawn dev
- If it's a test infrastructure issue (flaky timing, missing wait) → fix the test, don't skip it
- **NEVER dismiss as "pre-existing" and proceed** — investigate and fix, or create a Linear story with root cause

---

## 4e. Update State

```yaml
stories:
  ROK-XXX:
    status: "ready_to_ship"
    next_action: "All gates passed. Read steps/step-5-ship.md."
```

When ALL stories reach `ready_to_ship`, proceed to **Step 5**.
