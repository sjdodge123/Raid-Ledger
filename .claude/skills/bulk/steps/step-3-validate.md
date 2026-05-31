# Step 3: Validate — Test Gaps, Build, Tests, Smoke

Per-story code review happened in Step 2e (parallel, before merge). This step runs batch-level validation on the merged `batch/YYYY-MM-DD` branch.

```bash
git checkout batch/YYYY-MM-DD
```

---

## 3a. Test Gap Analysis

Analyze the batch diff for untested changes:
1. Does a corresponding test file exist? (`foo.service.ts` → `foo.service.spec.ts`)
2. Did the test file update in this batch? If source changed but test didn't, check whether existing tests cover the new behavior.
3. Are new exports tested?

Gaps → Lead writes missing tests directly on batch branch, or spawns a test-writing agent for larger gaps.

State: `gates.test_gaps: PASS` (or `FAIL`).

---

## 3b. Static CI (lite gate — one command)

```bash
./scripts/validate-ci.sh --static
```

`--static` covers build, TypeScript, lint, and conditional migration / container checks across all workspaces (the latter two auto-skip unless the batch touched `drizzle/migrations/**` or infra files). Unit, integration, Playwright, and Discord smoke are **deferred to GitHub CI** (sharded + randomized on every PR; auto-merge-squash blocks until green). This is the lite gate by operator policy.

**Escalate to `./scripts/validate-ci.sh --full`** (adds local unit + integration + auto-scoped e2e) when the batch touches `package.json`/`package-lock.json` (GitHub skips unit + integration for deps-only diffs), `packages/contract/**`, migrations, or container/infra — or is a large/cross-workspace batch where a post-push behavioral break would be costly, or when the operator asks.

Fix failures directly on the batch branch (`fix: resolve <issue>`). If substantive (logic bug from a story), diagnose which story, fix or respawn dev.

State: `gates.ci: PASS` — map from the validate-ci summary table. `gates.integration` is `DEFERRED_TO_GITHUB` under the lite gate.

---

## 3g. Post-Deploy E2E Gate (diff-gated, mandatory for every batch)

Backend changes can break UI/bot flows — always check, but `validate-ci.sh` will auto-skip e2e steps whose surface wasn't touched by the batch diff.

**Env-lock check.** The env (Docker, API :3000, web :5173) is shared. Step 2b deployed locally and should still hold the lock under this batch's worktree — confirm:

```
mcp__mcp-env__env_lock_status        # confirm this batch's worktree still holds it
```

If the lock is gone (released by another agent or expired), re-acquire and re-run `deploy_dev.sh --ci --rebuild` from the batch worktree before e2e. Don't run e2e against a stale or absent env.

```bash
# Docker/API/web already up from Step 2b. Run the diff-gated e2e portion.
./scripts/validate-ci.sh --only-e2e
```

What this runs:
- **Playwright** (BOTH desktop + mobile — matches CI) iff diff touches `web/**`, `api/src/auth/**`, `api/src/admin/demo-test*`, `playwright.config.*`, or `scripts/smoke/**`.
- **Discord smoke** iff diff touches `api/src/discord-bot/**`, `api/src/notifications/**`, `api/src/events/signups*`, `api/src/events/event-lifecycle*`, `api/src/admin/demo-test*`, `tools/test-bot/src/smoke/**`, or `tools/test-bot/src/helpers/polling.ts`.

For batches with shared-component changes the diff detector won't flag (shared layout, nav, design tokens), force-run with `./scripts/validate-ci.sh --only-e2e --with-e2e`.

On failure:
- Selector/flake → fix test or UI (`fix: resolve e2e issues`).
- Regression → diagnose which story, fix or respawn dev.

State: `gates.smoke: PASS` (or `FAIL` / `SKIPPED` — record the per-step verdict from the validate-ci summary).

---

## 3g.5. Chrome MCP e2e Gate (MANDATORY before push + PR)

The new operator-facing pre-ship gate. Lead drives the *changed user flows* on the merged batch branch via `mcp__claude-in-chrome__*` — captures screenshots / GIFs, audits console + network, and produces a summary the operator can scan when reviewing the PR. **Must complete BEFORE the batch is pushed (3h), BEFORE the PR is created, and BEFORE auto-merge is enabled in Step 4.**

Full playbook: `.claude/skills/_shared/chrome-mcp-e2e.md`.

**What Lead does here:**

1. Derive the changed-flow list from `git diff origin/main..batch/YYYY-MM-DD --name-only` + each story's ACs.
2. Pass that list + the batch story IDs as inputs to the shared playbook.
3. Execute it. Do NOT skim it — the anti-pattern section catches the failure modes that triggered this gate's creation (ROK-1237).
4. Write the summary to `planning-artifacts/chrome-mcp-summary-batch-YYYY-MM-DD.md`. Save captures under `planning-artifacts/chrome-mcp-screenshots/batch-YYYY-MM-DD/`.
5. **Release the env lock IMMEDIATELY after the summary is written.** Push (3h), PR creation, and auto-merge do NOT need the env. Re-acquire ONLY if a post-review fix requires re-verifying against a fresh deploy.

**Gate outcomes:**

- `VERDICT: PASS` → `gates.chrome_mcp_e2e: PASS`. Continue to 3h.
- `VERDICT: PASS WITH NOTES` → `gates.chrome_mcp_e2e: PASS`. Append medium/low findings to **`TECH-DEBT-BACKLOG.md`** at the repo root using the dated-section + `- **[sev]**` bullet format (single canonical location parsed by `/readlogs`). Mirror the appended block in the PR body under `## Tech debt observed (not auto-filed)`. Do NOT auto-file Linear tech-debt; do NOT invent runbook "Known Issues" sections.
- `VERDICT: FAIL` → `gates.chrome_mcp_e2e: FAIL`. Do NOT push. Lead either fixes inline (1-3 lines, `fix: resolve Chrome MCP finding`) or respawns the originating dev. Re-run the gate after the fix.

**N/A path (rare):** if the entire batch is API-internal with no in-app surface (no admin page, no settings panel, no Discord embed consumes the changes), record `gates.chrome_mcp_e2e: "N/A — api-internal-only"` with a one-line justification. Default is to run.

State: `gates.chrome_mcp_e2e: PASS` (or `FAIL`, or `N/A — ...`).

---

## 3h. Push Batch Branch and Create PR (inline — no skill nesting)

Lead pushes directly. Step 2 already ran per-story reviewers; this step already ran full batch validation. No need for `/push` to re-validate.

```bash
# Rebase if main has moved
git fetch origin main
git rebase origin/main
# If rebase brought new commits, re-run 3b–3g

git push -u origin batch/YYYY-MM-DD

# Count stories and tech debt findings for PR body
gh pr create --base main --head batch/YYYY-MM-DD \
  --title "chore: batch YYYY-MM-DD" \
  --body "$(cat <<'EOF'
## Summary
Batch of <N> stories: <list ROK-### with labels>.

## Validation
- Per-story code review: PASS
- Test gap analysis: PASS
- Build / TypeScript / Lint: PASS (local lite gate)
- Unit tests: DEFERRED → GitHub CI (or PASS if `--full` was run locally)
- Integration tests: DEFERRED → GitHub CI (or PASS if `--full` was run locally)
- Playwright smoke (desktop + mobile): DEFERRED → GitHub CI (Chrome MCP e2e is the local browser gate below)
- Chrome MCP e2e: PASS — see `planning-artifacts/chrome-mcp-summary-batch-YYYY-MM-DD.md`

## Stories
| Story | Label | Reviewer |
|-------|-------|----------|
| ROK-XXX | Tech Debt | APPROVED |
EOF
)"
```

---

## 3i. Update State

```yaml
pipeline:
  current_step: "ship"
  next_action: "PR created. Read step-4-ship.md."
  gates:
    test_gaps: PASS
    ci: PASS                      # build/tsc/lint (lite --static gate)
    integration: DEFERRED_TO_GITHUB   # or PASS if --full was run locally
    smoke: DEFERRED_TO_GITHUB         # Playwright/Discord; Chrome MCP is the local browser gate
    chrome_mcp_e2e: PASS   # or "N/A — api-internal-only"
    pr: PENDING
```

(`review` gate is per-story now, captured in `stories.ROK-XXX.gates.reviewer`.)

Proceed to **Step 4**.
