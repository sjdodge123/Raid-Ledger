# Step 3: Review & Validate — CI, parallel { Chrome MCP | Reviewer }, Push

**Lead runs validation directly on the batch branch.**

Order:
1. Lite static gate in one pass: `validate-ci.sh --static` covers build → ts → lint, plus conditional migration/container checks (3a). Unit + integration are deferred to GitHub CI (sharded + randomized on every PR).
2. **Then fork into two parallel tracks**:
   - **Track A (Lead, env-bound):** acquire env lock (3f) → deploy → diff-gated e2e (3g) → Chrome MCP e2e (3h) → release env lock.
   - **Track B (Reviewer agent, no env):** spawn reviewer in background (3i) reviewing the merged batch diff.
3. Both tracks converge before test gaps (3j) + regression (3k) + push (3l).

The reviewer no longer waits on Chrome MCP — it reviews code-level concerns against the merged diff. If a critical/high reviewer finding requires browser re-verification (e.g. a UI behavior change), Lead reruns the affected flow via Chrome MCP after Track A releases the env lock. See `~/.claude/projects/-Users-sdodge-Documents-Projects-Raid-Ledger/memory/feedback_chrome_mcp_e2e_before_review.md` for the original sequential rationale; the parallelization preserves the *gate* (reviewer + Chrome MCP both block PR) while removing the artificial ordering between them.

```bash
# Ensure you're on the batch branch
git checkout fix/batch-YYYY-MM-DD
```

---

## 3a. Static CI (lite gate — one command)

```bash
./scripts/validate-ci.sh --static
```

`--static` runs build (all workspaces), TypeScript, lint, and conditional migration / container checks (the latter two auto-skip unless the batch touched `drizzle/migrations/**` or infra files). Unit, integration, Playwright, and Discord smoke are **deferred to GitHub CI**, which runs them sharded + randomized on every PR — GitHub is the real gate (auto-merge-squash blocks until green). This is the lite gate by operator policy: catch the cheap deterministic breaks locally, let GitHub catch behavioral regressions.

**Escalate to `./scripts/validate-ci.sh --no-e2e`** (adds local unit + integration) only when the batch is a large/cross-workspace refactor where you'd rather not discover a behavioral break post-push, or when the operator asks.

On failure (script stops at first FAIL — read its summary table):
- **Trivial** (lint, type error, import path): fix directly, commit `fix: resolve <issue>`.
- **Substantive** (logic bug introduced by a story): diagnose which story, fix directly on the batch branch if possible, otherwise create a new worktree from the batch branch and re-spawn the dev with failure context.

Update state: `gates.ci: PASS` (or `FAIL`). Map the validate-ci summary rows onto `gates.ci` (build/tsc/lint). `gates.integration` is `DEFERRED_TO_GITHUB` under the lite gate.

---

## Fork: Track A + Track B start in parallel

After 3a (validate-ci --static) passes, kick off BOTH tracks in the same message — Track A (env-bound, Lead-driven) and Track B (reviewer agent, no env).

**Track A** runs 3f → 3g → 3h sequentially (Lead actions).
**Track B** runs 3i once (reviewer agent invocation).

If reviewer finishes before Chrome MCP, hold reviewer output and continue Track A. If Chrome MCP finishes before reviewer, do non-env work (PR body draft, state file updates) until the reviewer mailbox returns. Both must be complete before 3j.

---

## 3f. [Track A] Acquire Env Lock + Deploy Locally

**Env-lock discipline (STRICT):** hold the lock for the minimum span needed — just deploy (3f) → e2e (3g) → Chrome MCP (3h). Release immediately after 3h. The reviewer (Track B), push, PR, and auto-merge do NOT need the env.

```
mcp__mcp-env__env_lock_status                                                # see who holds it
mcp__mcp-env__env_lock_acquire({ purpose: "fix-batch <id> validation" })     # acquire or queue
```

If queued, do non-env work (PR body draft, spec tidy) until the lock returns. Don't bypass.

```bash
./scripts/deploy_dev.sh --ci --rebuild
curl -s http://localhost:3000/system/status | head -20
```

If deploy fails: stop. Debug the deploy before continuing — there is no point running e2e or Chrome MCP against a broken env. If the fix is purely code (no env state), release the lock while you fix and re-acquire.

---

## 3g. [Track A] Post-Deploy E2E Gate (diff-gated)

Run the e2e portion of validate-ci against the deployed batch. The script auto-skips Playwright if no UI/auth/demo-test files changed in the batch and auto-skips Discord smoke if no bot/notification files changed — pure backend batches pass through in seconds.

```bash
./scripts/validate-ci.sh --only-e2e
```

What this runs:
- **Playwright** (BOTH desktop + mobile — matches CI) iff diff touches `web/**`, `api/src/auth/**`, `api/src/admin/demo-test*`, `playwright.config.*`, or `scripts/smoke/**`.
- **Discord smoke** iff diff touches `api/src/discord-bot/**`, `api/src/notifications/**`, `api/src/events/signups*`, `api/src/events/event-lifecycle*`, `api/src/admin/demo-test*`, `tools/test-bot/src/smoke/**`, or `tools/test-bot/src/helpers/polling.ts`.

For batches with shared-component changes that the diff detector won't flag as UI-touching (e.g. shared layout, nav, design tokens), force-run with `./scripts/validate-ci.sh --only-e2e --with-e2e`.

On failure:
- **Selector/flake failures:** fix the test or the UI, commit `fix: resolve e2e issues`.
- **Real regressions:** diagnose which story broke the flow, fix or re-spawn dev.

Never re-run hoping it passes. Never weaken or skip tests to make CI green.

Update state: `gates.playwright: PASS` / `FAIL` / `SKIPPED`; `gates.discord_smoke: PASS` / `FAIL` / `SKIPPED`.

---

## 3h. [Track A] Chrome MCP e2e Gate (MANDATORY — operator-facing browser validation)

Drives the *changed user flows* via `mcp__claude-in-chrome__*` on the deployed batch branch, captures screenshots / GIFs, audits console + network, and produces an operator-facing summary. **Must PASS before the branch is pushed (3l).** Runs in parallel with the reviewer (3i) but both must converge before 3j.

Full playbook: `.claude/skills/_shared/chrome-mcp-e2e.md`.

**What Lead must do here:**

1. Derive the changed-flow list from `git diff origin/main..fix/batch-YYYY-MM-DD --name-only` + each story's ACs.
2. Pass that list + the batch story IDs as inputs to the shared playbook.
3. Execute the playbook step-by-step. Do NOT skim it; the anti-pattern section catches the failure modes that triggered this gate's creation (ROK-1237).
4. Write the summary to `planning-artifacts/chrome-mcp-summary-fix-batch-YYYY-MM-DD.md`. Save captures under `planning-artifacts/chrome-mcp-screenshots/fix-batch-YYYY-MM-DD/`.
5. **Release the env lock IMMEDIATELY after the summary is written** — `mcp__mcp-env__env_lock_release`. Test gap (3j), regression check (3k), push (3l), and Step 4 (PR + auto-merge) do NOT need the env. Re-acquire ONLY if a reviewer finding requires a fix + re-verify against the deployed app.

**Gate outcomes:**

- `VERDICT: PASS` → `gates.chrome_mcp_e2e: PASS`. Continue to 3i (reviewer).
- `VERDICT: PASS WITH NOTES` → `gates.chrome_mcp_e2e: PASS`. Append medium/low findings to **`TECH-DEBT-BACKLOG.md`** at the repo root (single canonical location — `/readlogs` parses it; see playbook "Where candidate tech-debt goes"). Use the dated-section + `- **[sev]**` bullet format. Do NOT auto-file Linear tech-debt stories; do NOT invent runbook "Known Issues" sections. Mirror the appended block in the PR body under `## Tech debt observed (not auto-filed)`. Continue to 3i.
- `VERDICT: FAIL` → `gates.chrome_mcp_e2e: FAIL`. Do NOT spawn the reviewer. Lead either fixes inline (1-3 lines per fix, `fix: resolve Chrome MCP finding`) or respawns the originating dev with the finding. Re-run the gate after the fix.

**N/A path (rare):** If — and only if — the batch is purely API-internal with no in-app surface (no admin page, no settings panel, no Discord embed consumes it), record `gates.chrome_mcp_e2e: "N/A — api-internal-only"` with a one-line justification. Default is to run the gate.

---

## 3i. [Track B] Code Review (MANDATORY — one reviewer per story)

**Spawn at the same moment Track A acquires the env lock (3f).** Reviewers run in parallel with Playwright + Chrome MCP — they review the per-story diff and do not need the deployed env or the browser summary. Use `run_in_background: true` so Lead can drive Track A while the reviewers work.

**Reviewer rule (STRICT):** spawn **one reviewer agent per story merged into the batch** (excluding any story that shipped via a separate PR mid-batch — e.g. Phase A that was squash-merged to main while the batch was running). Each reviewer scopes itself to ONE story's commit range, not the whole batch diff. Rationale: per-story scoping produces sharper, less-noisy findings; cross-story interactions are caught at the test-gap (3j) and Chrome MCP (3h) stages.

For each story `ROK-XXX` in `pipeline.stories` with `status: "merged_to_batch"`, spawn:

```
Agent(subagent_type: "devedup-rl:reviewer", model: "sonnet",
      run_in_background: true,
      description: "Review ROK-XXX",
      name: "reviewer-rok-XXX",
      prompt: """
      Review the changes for ROK-XXX merged into branch fix/batch-YYYY-MM-DD.

      Scope: ONLY the commits authored for ROK-XXX. Use the merge_commit_sha from
      pipeline.stories['ROK-XXX'] to bound your diff:
        git log --format=%H <merge_commit_sha>^..<merge_commit_sha> -- <files>
        git diff <merge_commit_sha>^..<merge_commit_sha>
      (Or simpler: diff the dev_commit_sha against its parent.)

      Story details:
        Title: <story title from Linear>
        Label: <Bug | Tech Debt | Chore | Performance | Spike>
        Linear AC: <bullet list of acceptance criteria from the spec or Linear issue>
        Spec path: planning-artifacts/specs/ROK-XXX.md (if present)

      Run your full review checklist on the per-story diff ONLY:
      1. Correctness — logic bugs, edge cases, error handling, off-by-one, null/undefined deref
      2. Security — injection, auth bypass, data exposure, secret handling
      3. Performance — N+1 queries, unnecessary allocations, missing indexes, blocking I/O
      4. Contract integrity — if shared types changed, are consumers updated?
      5. Standards — ESLint compliance, file/function size limits (CLAUDE.md), naming conventions
      6. Acceptance criteria coverage — did the dev actually deliver each AC?
      7. Regression test quality (Bug label only) — is the test comprehensive, not just happy-path? Does it actually fail without the fix?

      For each finding, classify severity: [critical], [high], [medium], [low], [nit].
      Critical/high findings MUST be fixed before shipping.

      You are running in parallel with N other per-story reviewers and (separately) browser
      validation via Chrome MCP. Focus on YOUR story's diff only — do NOT flag findings about
      sibling stories in the same batch. Cross-story interactions are caught elsewhere.
      """)
```

Spawn ALL per-story reviewers in a single message (parallel). When each completes:

1. **Critical/high findings:** Lead fixes directly on the batch branch, or re-spawns the originating dev if the fix is non-trivial. If a fix touches a changed UI flow, re-run 3h Chrome MCP scoped to that flow (this requires re-acquiring the env lock).
2. **Medium/low/nit findings:** append to **`TECH-DEBT-BACKLOG.md`** at the repo root using the dated-section + `- **[sev]**` bullet format (single canonical location parsed by `/readlogs`). Do NOT auto-file Linear tech-debt; the operator triages the file.
3. **Update state:** `gates.review: PASS` only when ALL per-story reviewers complete with no unfixed critical/high findings. Track per-story state under `pipeline.stories['ROK-XXX'].review_status: PASS | FAIL`.

**`/code-review` substitution rule:** if the operator explicitly invokes `/code-review` (harness-native finder+verifier review) before or during Step 3i, treat it as a SUPPLEMENT to the per-story reviewers, not a replacement. `/code-review` produces broader-scope findings across the whole batch diff; per-story reviewers produce focused, AC-traced findings per story. Both signals are useful.

**Convergence rule:** do not proceed to 3j until BOTH tracks have completed (`gates.chrome_mcp_e2e: PASS` AND `gates.review: PASS` with all per-story reviewers green).

---

## 3j. Test Gap Analysis

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

## 3k. Verify Regression Tests (Bug stories only)

Confirm each Bug-labeled story in the batch includes a regression test:

```bash
# Check for Playwright regression tests
grep -n "Regression: ROK-" scripts/verify-ui.spec.ts

# Check for unit/integration regression tests
grep -rn "Regression: ROK-" api/src/ web/src/
```

For each Bug story, verify a matching `Regression: ROK-<num>` test block exists in either the Playwright smoke file or a unit/integration test file. If a Bug story is missing its regression test, flag it — do not proceed until every Bug fix has a corresponding regression test.

Update state: `gates.regression: PASS` (or `FAIL`)

---

## 3l. Push Batch Branch

**Only after every prior gate is PASS.** Use the `/push` skill — NEVER use raw `git push`. The skill runs full local CI before pushing.

```
/push --skip-pr
```

The `--skip-pr` flag skips PR creation — the PR is created in Step 4.

---

## 3m. Update State

```yaml
pipeline:
  current_step: "ship"
  next_action: |
    All validation passed on batch branch. Read steps/step-4-ship.md.
    Create PR, enable auto-merge, sync Linear, cleanup.
  gates:
    ci: PASS
    integration: PASS
    playwright: PASS
    chrome_mcp_e2e: PASS
    review: PASS
    test_gaps: PASS
    regression: PASS
    pr: PENDING
```

All story statuses remain `merged_to_batch` — they'll be updated to `done` in Step 4.

Proceed to **Step 4**.
