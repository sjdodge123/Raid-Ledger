# Step 3: Validate — CI, Deploy Locally, FULL STOP

Lead runs everything.

## Light Scope Fast Path (skip 3a-3c.5 if scope=light)

Fast CI already passed in Step 2-light-c. No worktree to deploy. No Playwright.

### 3-light-a. Linear → "In Review"

```
mcp__linear__save_issue({ issueId: "<linear_id>", statusName: "In Review" })
```

### 3-light-b. Present to operator (compact)

```
## Ready for Review (Light Scope)

| Story | Branch | Status |
|-------|--------|--------|
| ROK-XXX: Title | rok-xxx-name | In Review |

Diff: `git diff main..HEAD --stat`
Fast CI: PASS (lint + tsc + tests on <touched-workspace>)
Files: <N>

Light scope — no worktree deploy, no Playwright. Review the diff and update Linear:
- **Code Review** = approved
- **Changes Requested** = needs rework

I'll wait.
```

### 3-light-c. State + FULL STOP

```yaml
stories.ROK-XXX:
  status: "waiting_for_operator"
  gates.operator: WAITING
```

Skip to **Step 4** (light path: operator approval polling only).

---

(Standard / Full scope continues below.)

---

## HARD RULE — NO PUSH IN STEP 3

The branch stays **local-only** through Steps 1–4. Do NOT invoke any of the following in this step:

- `git push` (including `--force`, `--force-with-lease`)
- `gh pr create`
- `gh pr merge --auto`
- the `/push` skill (even with `--skip-pr`)

The first push happens in **Step 5**, after the operator approves AND the reviewer approves. Pushing pre-review risks a PR and auto-merge landing before a human reviews. If you find yourself about to run any push-adjacent command, stop — you are in the wrong step.

"Push to origin" ≠ "deploy locally." In this step, "deploy" means `./scripts/deploy_dev.sh` so the operator can browser-test. Nothing leaves the worktree here. Gate 3a must pass before deploy.

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

## 3b. Rebase onto main (local only — do NOT push)

```bash
cd ../Raid-Ledger--rok-<num>
git fetch origin main
git rebase origin/main
# If rebase brought new commits: re-run 3a before continuing
cd -
```

**Do NOT `git push`.** The branch stays local until step 5 (after code review). Pushing pre-review would risk PRs/auto-merge going out before a human reviews.

---

## 3c. Acquire Env Lock + Deploy Locally

**Env-lock discipline (STRICT):** the env (`:3000`, `:5173`, Docker DB) is a shared resource. Acquire **right before** deploy. Hold through the operator's browser-test window (operator literally needs the env to test). Release when the operator gives their verdict (Step 4a). Reviewer (4b Codex), architect (4c), and most of Lead smoke (4d) do NOT need the env — re-acquire ONLY if 4d's Playwright pass is needed for UI changes.

```
mcp__mcp-env__env_lock_status                                                              # see who holds it
mcp__mcp-env__env_lock_acquire({ purpose: "build ROK-XXX operator-review deploy" })        # acquire or queue
```

If queued, do non-env work (write the dev brief, reconcile spec) until the lock returns.

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
- After fix: re-run, then continue. **Do not push.**

Gate: `gates.playwright: PASS` or `FAIL`.

---

## 3c.6. Chrome MCP e2e Gate (MANDATORY before operator review)

The Lead drives the *changed user flows* via `mcp__claude-in-chrome__*` on the deployed app — captures screenshots / GIFs, audits console + network, and produces an operator-facing summary BEFORE flipping Linear to "In Review". **Must complete before the operator FULL STOP (3e), before the Codex reviewer (4b), and before any push or PR work.**

Full playbook: `.claude/skills/_shared/chrome-mcp-e2e.md`.

**What Lead does here (per-story):**

1. Derive the changed-flow list from `git diff main..HEAD --name-only` in the story worktree + the story's ACs.
2. Pass the flow list + the story ID as inputs to the shared playbook.
3. Execute it. Do NOT skim it; the anti-pattern section catches the failure modes that triggered this gate's creation (ROK-1237).
4. Write the summary to `planning-artifacts/chrome-mcp-summary-ROK-XXX.md`. Save captures under `planning-artifacts/chrome-mcp-screenshots/ROK-XXX/`.
5. **Keep the env lock** — the operator will browser-test on the same deploy in the FULL STOP window. Don't release until 4a (operator verdict).

**Gate outcomes:**

- `VERDICT: PASS` → `stories.ROK-XXX.gates.chrome_mcp_e2e: PASS`. Continue to 3d.
- `VERDICT: PASS WITH NOTES` → `gates.chrome_mcp_e2e: PASS`. Include the notes in the operator-presentation block at 3e so the operator knows what to look at. Append medium/low findings to **`TECH-DEBT-BACKLOG.md`** at the repo root using the dated-section + `- **[sev]**` bullet format (single canonical location parsed by `/readlogs`). Do NOT auto-file Linear tech-debt; do NOT invent runbook "Known Issues" sections. Mirror the appended block in the PR body under `## Tech debt observed (not auto-filed)`. Continue to 3d.
- `VERDICT: FAIL` → `gates.chrome_mcp_e2e: FAIL`. Do NOT flip Linear to "In Review"; do NOT spawn Codex. Lead either fixes inline (1-3 lines, `fix: resolve Chrome MCP finding (ROK-XXX)`) or respawns the dev with the finding. Re-run the gate after the fix.

**Light scope (`scope: light`):** Chrome MCP gate is SKIPPED — there is no worktree deploy and the operator reviews the diff directly. Record `gates.chrome_mcp_e2e: "N/A — light scope"`.

**API-internal stories (rare):** if and only if the story has no in-app surface (no admin page, no settings panel, no Discord embed consumes it), record `gates.chrome_mcp_e2e: "N/A — api-internal-only"` with a one-line justification. Default is to run.

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
  gates:
    ci: PASS
    playwright: PASS
    chrome_mcp_e2e: PASS   # or "N/A — light scope" / "N/A — api-internal-only"
    operator: WAITING
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

### Chrome MCP e2e Pre-Review Summary
| Story | Flows exercised | Console | Network | Captures | Verdict |
|-------|-----------------|---------|---------|----------|---------|
| ROK-XXX | <flow list> | clean | 2xx only | planning-artifacts/chrome-mcp-screenshots/ROK-XXX/ | PASS / PASS WITH NOTES |

Full Chrome MCP report: `planning-artifacts/chrome-mcp-summary-ROK-XXX.md`. Notes for operator attention (if any): <inline bullets from the summary's findings section>.

### Gate Summary
| Gate | ROK-XXX |
|------|---------|
| E2E Test First (TDD) / Dev AC Audit / CI / Test Coverage Audit / Chrome MCP e2e |

The app is deployed (env-lock held — Lead releases when you give a verdict). Test each story and update Linear:
- **Code Review** = approved, ready for code review
- **Changes Requested** = needs rework (add feedback as comment)

I'll wait.
```

If any row shows FAIL, fix it before presenting. If Local CI Proof or Chrome MCP e2e Pre-Review Summary is missing from your output, you skipped 3a or 3c.6 — go back. Do NOT proceed until operator gives direction.
