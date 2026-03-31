# Step 3: Validate — CI, Push, Deploy, FULL STOP

**Lead runs everything directly. No agents spawned.**

**CRITICAL: Steps 3a and 3b MUST both pass BEFORE any push to origin. If you skip 3a and go straight to `/push`, you are violating the pipeline. The 34% PR CI failure rate over the last 2 weeks was caused by skipping local validation. Every failed CI run on GitHub wastes Actions minutes and blocks merges.**

---

## 3a. Run FULL CI Locally (MANDATORY — NEVER SKIP)

**This is the primary CI gate. Run ALL checks, not just the ones `/push` scope detection would select.** The `/push` skill's scope detection is a convenience for standalone pushes — inside `/build`, you MUST run the full suite because dev agents may have introduced cross-workspace regressions.

For each story at `ready_for_validate`, run the **complete** CI suite in its worktree:

```bash
WORKTREE="../Raid-Ledger--rok-<num>"
cd $WORKTREE

# 1. Build ALL workspaces (order matters)
npm run build -w packages/contract
npm run build -w api
npm run build -w web

# 2. Type check ALL workspaces
npx tsc --noEmit -p api/tsconfig.json
npx tsc --noEmit -p web/tsconfig.json

# 3. Lint ALL workspaces
npm run lint -w api
npm run lint -w web

# 4. Test ALL workspaces
npm run test -w api -- --passWithNoTests
npm run test -w web

cd -
```

**DO NOT scope-reduce these checks.** Even if the story only touched `web/`, run API tests too — contract changes, shared types, and transitive dependencies can break either workspace.

If CI fails:
- **Lint/type errors:** Fix directly in the worktree, commit as `fix: resolve CI issues (ROK-XXX)`
- **Test failures:** Assess — if trivial, fix. If complex, re-spawn dev for the failing story.
- **NEVER push with known failures hoping CI will pass** — fix locally first.

Update state: `gates.ci: PASS` (or `FAIL`)

**Do NOT proceed to 3b until gates.ci = PASS for every story in the batch.**

---

## 3b. Push Branch

**PREREQUISITE: Step 3a MUST have passed. If you skipped 3a or it failed, STOP.**

Use raw git push here — step 3a already ran full CI. Do NOT use `/push` (it would redundantly re-run checks and its scope detection might skip checks that 3a already caught).

```bash
cd ../Raid-Ledger--rok-<num>
git fetch origin main
git rebase origin/main

# If rebase conflicts: resolve them, then RE-RUN step 3a (rebase can introduce breakage)

git push -u origin $(git branch --show-current)
cd -
```

**If the rebase brought in new commits, you MUST re-run step 3a before pushing.** The merge may introduce breakage that wasn't present before.

---

## 3c. Deploy Locally

```bash
# From the worktree (or main repo) — script is worktree-aware
cd ../Raid-Ledger--rok-<num>
./scripts/deploy_dev.sh --ci --rebuild
cd -
```

The script handles Docker, .env copying, migrations, seeding, and health checks automatically.

If the deploy fails, diagnose and fix. If it needs `--fresh` (DB wipe), get operator approval first (destructive operation).

---

## 3c.5. Playwright Smoke Tests (MANDATORY)

After deploying locally (step 3c), run the full Playwright smoke suite:

```bash
cd ../Raid-Ledger--rok-<num> && npx playwright test && cd -
```

The smoke tests verify auth flows, calendar, events, notifications, and navigation against live seed data. They require the API and web server to be running (deploy_dev.sh handles this).

**Run BOTH desktop AND mobile projects.** CI runs both. Do NOT use `--project=desktop`.

If Playwright fails:
- **Selector/flake failures:** Fix the test or the UI, commit as `fix: resolve Playwright issues (ROK-XXX)`
- **Real regressions:** Diagnose which story broke the flow, fix or re-spawn dev.
- After fixing, re-push: `cd ../Raid-Ledger--rok-<num> && git push && cd -`

Update state: `gates.playwright: PASS` (or `FAIL`)

---

## 3d. Update Linear to "In Review"

```
mcp__linear__save_issue({
  issueId: "<linear_id>",
  statusName: "In Review"
})
```

---

## 3e. Update State and FULL STOP

Update `<worktree>/build-state.yaml`:

```yaml
pipeline:
  current_step: "review"
  next_action: |
    ALL stories deployed and in "In Review". WAITING for operator to test.
    When operator updates Linear, read steps/step-4-review.md.

stories:
  ROK-XXX:
    status: "waiting_for_operator"
    gates:
      operator: WAITING
    next_action: |
      Deployed and in "In Review". Waiting for operator to test and update Linear.
```

**FULL STOP.** Tell the operator. The summary MUST include the test verification table — this is not optional.

```
## Ready for Testing

| Story | Branch | Status |
|-------|--------|--------|
| ROK-XXX: Title | rok-xxx-name | In Review — ready for your testing |

### Test Verification

| Story | TDD Tests | E2E Type Required | E2E Test File | Smoke Run |
|-------|-----------|-------------------|---------------|-----------|
| ROK-XXX | N failing → N passing | Playwright / Discord / Integration / Unit | `path/to/test/file` | PASS / FAIL / N/A |

### Local CI Proof (MANDATORY)

| Check | ROK-XXX |
|-------|---------|
| Build (all workspaces) | PASS |
| TypeScript (all) | PASS |
| Lint (all) | PASS |
| Tests — api | PASS (N suites, M tests) |
| Tests — web | PASS (N suites, M tests) |
| Playwright (desktop + mobile) | PASS (N tests) / N/A |

### Gate Summary

| Gate | ROK-XXX |
|------|---------|
| E2E Test First (TDD) | PASS / N/A |
| Dev AC Audit | PASS |
| CI (build/lint/test) | PASS |
| Test Coverage Audit | PASS / GAP: <detail> |

The app is deployed locally. Test each story and update Linear:
- **Code Review** = approved, ready for code review
- **Changes Requested** = needs rework (add feedback as comment)

I'll wait here until you're ready to proceed.
```

**If any row in the Local CI Proof or Gate Summary shows FAIL, fix it BEFORE presenting to the operator.** The operator should never see unresolved test gaps.

**If the Local CI Proof section is missing from your output, you skipped step 3a. Go back and run it.**

**Do NOT proceed until the operator gives direction.** This is a mandatory gate.
