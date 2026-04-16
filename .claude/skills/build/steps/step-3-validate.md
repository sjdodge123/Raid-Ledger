# Step 3: Validate — CI, Push, Deploy, FULL STOP

Lead runs everything. Gates 3a and 3b must both pass BEFORE any push — skipping 3a is a pipeline violation.

---

## 3a. Verify Dev CI Proof

Dev agents self-scope CI based on what they touched (see `dev.md` CI Scope table). Lead verifies rather than always re-runs.

### For each story:

1. Read the dev's "CI Scope" output: `ci_scope` value and reason.
2. Cross-check `ci_scope` against the actual diff: `cd <worktree> && git diff main..HEAD --name-only`. Risk signals that demand `full`:
   - Any `packages/contract/**` file
   - Any `Dockerfile*`, `docker-entrypoint.sh`, `nginx/**`
   - New migration file in `api/src/drizzle/migrations/`
   - Both `api/src/**` and `web/src/**` changed
   - Any `tools/**` or `scripts/**` file

3. Decide:
   - **`ci_scope: full` and proof table all PASS** → accept. `gates.ci: PASS`.
   - **`ci_scope: full` but any FAIL** → respawn dev with failure context.
   - **`ci_scope: api | web | tests | docs` and no risk signal** → accept. `gates.ci: PASS`.
   - **Scope under-selected** (risk signal present but dev ran narrow) → run `./scripts/validate-ci.sh --full` yourself in the worktree. Fix failures or respawn.
   - **Scope unclear or dev output malformed** → run `./scripts/validate-ci.sh --full`.

On Lead-driven failure: lint/type errors → fix directly, commit `fix: resolve CI issues (ROK-XXX)`. Test failures → respawn dev. Never push with known failures.

Gate: `gates.ci: PASS` for every story before 3b.

---

## 3b. Push Branch

Step 3a must have passed. Use raw git — not `/push` — since 3a already ran full CI.

```bash
cd ../Raid-Ledger--rok-<num>
git fetch origin main
git rebase origin/main
# If rebase brought new commits: re-run 3a before pushing
git push -u origin $(git branch --show-current)
cd -
```

---

## 3c. Deploy Locally

```bash
cd ../Raid-Ledger--rok-<num>
./scripts/deploy_dev.sh --ci --rebuild
cd -
```

If deploy needs `--fresh` (DB wipe), get operator approval (destructive).

---

## 3c.5. Playwright Smoke Tests

After deploy, run BOTH desktop + mobile projects (CI runs both):

```bash
cd ../Raid-Ledger--rok-<num> && npx playwright test && cd -
```

On failure:
- Selector/flake → fix test or UI, commit `fix: resolve Playwright issues (ROK-XXX)`.
- Real regression → diagnose which story broke it, fix or respawn dev.
- After fix: `git push` from the worktree.

Gate: `gates.playwright: PASS` or `FAIL`.

---

## 3d. Update Linear to "In Review"

```
mcp__linear__save_issue({ issueId: "<linear_id>", statusName: "In Review" })
```

---

## 3e. Update State and FULL STOP

Update `<worktree>/build-state.yaml`:

```yaml
pipeline:
  current_step: "review"
  next_action: "All stories in 'In Review'. Waiting for operator. When they update Linear → read step-4-review.md."
stories.ROK-XXX:
  status: "waiting_for_operator"
  gates.operator: WAITING
```

Present to operator with the full verification table — this is mandatory, not optional:

```
## Ready for Testing

| Story | Branch | Status |
|-------|--------|--------|
| ROK-XXX: Title | rok-xxx-name | In Review |

### Test Verification
| Story | TDD Tests | E2E Type | Test File | Smoke Run |
|-------|-----------|----------|-----------|-----------|
| ROK-XXX | N failing → N passing | Playwright/Discord/Integration/Unit | <path> | PASS/FAIL/N/A |

### Local CI Proof
| Check | ROK-XXX |
|-------|---------|
| Build (all workspaces) / TypeScript / Lint / Tests api / Tests web / Integration / Coverage api / Coverage web / Migration / Container / Playwright (desktop + mobile) |

### Gate Summary
| Gate | ROK-XXX |
|------|---------|
| E2E Test First (TDD) / Dev AC Audit / CI / Test Coverage Audit |

The app is deployed. Test each story and update Linear:
- **Code Review** = approved, ready for code review
- **Changes Requested** = needs rework (add feedback as comment)

I'll wait.
```

If any row shows FAIL, fix it before presenting. If Local CI Proof is missing from your output, you skipped 3a — go back. Do NOT proceed until operator gives direction.
