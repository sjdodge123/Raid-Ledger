# Step 3: Validate — CI, Push, Deploy, FULL STOP

**Lead runs everything directly. No agents spawned.**

---

## 3a. Run CI for Each Story

For each story at `ready_for_validate`, run the full CI suite in its worktree:

```bash
WORKTREE="../Raid-Ledger--rok-<num>"

# Build order: contract → api → web
npm run build -w packages/contract --prefix $WORKTREE
npm run build -w api --prefix $WORKTREE
npm run build -w web --prefix $WORKTREE

# Type check
npx tsc --noEmit -p $WORKTREE/api/tsconfig.json
npx tsc --noEmit -p $WORKTREE/web/tsconfig.json

# Lint
npm run lint -w api --prefix $WORKTREE
npm run lint -w web --prefix $WORKTREE

# Tests
npm run test -w api --prefix $WORKTREE
npm run test -w web --prefix $WORKTREE

# Smoke tests — BOTH desktop AND mobile (matches CI exactly)
# MANDATORY for any story with UI changes. Do NOT use --project=desktop.
cd $WORKTREE && npx playwright test && cd -
```

**Smoke test verification is MANDATORY before pushing.** CI runs both desktop and mobile
Playwright projects. If you only verify desktop locally, mobile failures will fail CI and
waste GitHub Actions minutes. See CLAUDE.md "Smoke Test Verification" for details.

If CI fails:
- **Lint/type errors:** Fix directly in the worktree, commit as `fix: resolve CI issues (ROK-XXX)`
- **Test failures:** Assess — if trivial, fix. If complex, re-spawn dev for the failing story.
- **Smoke test failures:** Run `npx playwright test` (both projects) locally, fix ALL failures before re-pushing. Do NOT re-run CI hoping for a different result.

Update state: `gates.ci: PASS` (or `FAIL`)

---

## 3b. Push Branch

**Use the `/push` skill** — it runs full local CI (build, typecheck, lint, tests) before pushing. NEVER use raw `git push`.

```
/push --skip-pr
```

The `--skip-pr` flag skips PR creation — the PR is created later in Step 5. The `/push` skill handles rebase onto main, all checks, and the actual push.

---

## 3c. Deploy Locally

```bash
# From the worktree (or main repo) — script is worktree-aware
./scripts/deploy_dev.sh --ci --rebuild
```

The script handles Docker, .env copying, migrations, seeding, and health checks automatically.

If the deploy fails, diagnose and fix. If it needs `--fresh` (DB wipe), get operator approval first (destructive operation).

---

## 3c.5. Playwright Smoke Tests (MANDATORY)

After deploying locally (step 3c), run the full Playwright smoke suite:

```bash
cd $WORKTREE && npx playwright test
```

The smoke tests verify auth flows, calendar, events, notifications, and navigation against live seed data. They require the API and web server to be running (deploy_dev.sh handles this).

If Playwright fails:
- **Selector/flake failures:** Fix the test or the UI, commit as `fix: resolve Playwright issues (ROK-XXX)`
- **Real regressions:** Diagnose which story broke the flow, fix or re-spawn dev.

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

**FULL STOP.** Tell the operator:

```
## Ready for Testing

| Story | Branch | Status |
|-------|--------|--------|
| ROK-XXX: Title | rok-xxx-name | In Review — ready for your testing |

The app is deployed locally. Test each story and update Linear:
- **Code Review** = approved, ready for code review
- **Changes Requested** = needs rework (add feedback as comment)

I'll wait here until you're ready to proceed.
```

**Do NOT proceed until the operator gives direction.** This is a mandatory gate.
