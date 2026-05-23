# Step 4: Review — Poll Linear, Rework, Reviewer, Architect, Smoke

## HARD RULE — STILL NO PUSH

The branch remains **local-only** through this step. Do NOT invoke `git push`, `gh pr create`, `gh pr merge --auto`, or the `/push` skill (even with `--skip-pr`) anywhere in Step 4 — including during rework loops. The first push lives in Step 5.

---

## 4a. Check Story Status in Linear

When operator signals ready, poll each story: `mcp__linear__get_issue({ id: "<linear_id>" })`.

**Review-env release point (STRICT).** As soon as the operator gives any verdict (approve OR rework), release only the resource for the active `pipeline.test_infra_mode`:

**MODE=local:** release the env lock. The rest of Step 4 (Codex 4b, architect 4c, Lead smoke 4d) does not need the env in most cases:

```
mcp__mcp-env__env_lock_release
```

**MODE=fleet:** keep the fleet env and slot alive through reviewer / architect / Lead smoke; cleanup happens in Step 5 after ship. If operator requests rework, reuse the same env slug when possible so testers keep one URL.

Local exception: if rework is `material` and re-running the deploy + e2e on the worktree is needed before push, re-acquire then. If Lead smoke in 4d needs to run `./scripts/validate-ci.sh --only-e2e --with-e2e` (UI / bot changes against the rebased state), re-acquire just for that pass and release after. The default in local mode is **release-as-soon-as-possible**; re-acquire on demand. Don't pre-emptively hold.

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
   mcp__linear__save_issue({ id: "<linear_id>", state: "Code Review" })
   ```
5. Continue to 4b.

---

## 4a.5. Reconcile Spec With Implementation (mandatory before reviewers spawn)

Before any reviewer teammate is spawned, Lead updates `planning-artifacts/specs/ROK-XXX.md` so the spec reflects what actually shipped. Prevents reviewers from raising false-positive "spec violation" flags on deliberate mid-build decisions.

**What to reconcile:**
- **Deferred ACs:** items the spec listed but didn't ship. Mark "Deferred to follow-up" with reason.
- **Replaced components:** spec named `ComponentX`, impl shipped `ComponentY` — update to the as-built name.
- **Changed semantics:** operator clarifications from browser testing that differ from original spec wording (e.g. "viewer-filtering on /lineups/active" → "no filter; private is read-open").
- **Added scope:** mid-review enhancements bundled in (e.g. Steam store link, badges, ITAD authoritative).
- **Test plan drift:** if the original Test-plan checklist is out of sync with what's actually covered (e.g. smoke tests pivoted to a different assertion), update the plan.

**Process:**
```bash
cd <worktree>
git log --oneline origin/main..HEAD   # identify commits that suggest drift
```

Scan commit subjects + recent operator-testing exchanges. Edit `planning-artifacts/specs/ROK-XXX.md` in place. Commit separately: `docs: reconcile spec with as-built implementation (ROK-XXX)`.

Reviewer prompts in 4b point at the updated spec.

---

## 4b. Reviewer Phase — Codex + devedup-rl + Security (PARALLEL)

Three review channels run in parallel during this phase. They have different blind spots; you need ALL THREE for non-trivial diffs:

| Channel | What it catches | How to invoke |
|---------|-----------------|---------------|
| Codex (general) | broad correctness/security/style across the whole diff | `codex review` two-pass (below) |
| Security review | auth bypasses, injection, leaked secrets, infra escalation | `/security-review` skill |
| devedup-rl chunked review | workspace-aware correctness, contract integrity, RL conventions | fan out `Agent({ subagent_type: "devedup-rl:reviewer" })` per chunk |

**Run all three concurrently** — security-review + the devedup-rl fan-out can launch in the same message as the Codex pass. They produce separate artifacts; aggregate after.

Reminder: per `feedback_security_review_vs_code_review.md`, `/security-review` (Codex-driven security focus) is NOT a substitute for `/rl-review` (devedup-rl). Both run. The Codex pass below is the GENERAL reviewer; the security pass is the SECURITY-focused reviewer; the devedup-rl fan-out is the WORKSPACE-AWARE reviewer.

**Skip the reviewer entirely if:**
- Diff is `<300 net lines` AND no risk markers (no migration, no Dockerfile, no `packages/contract/`, no auth code, no money/payments code). Operator approval was the gate; reviewers are for genuinely risky diffs.
- `codex` CLI is not on PATH AND no devedup-rl plugin available (record `gates.reviewer: SKIPPED — tools unavailable`, proceed).
- If `codex` is on PATH, ALWAYS run the security pass even if you skip the general Codex pass — `/security-review` is the smallest and most-critical channel.

### Run Codex

`codex review` in v0.121.0 makes `--base <BRANCH>` and `[PROMPT]` mutually exclusive (the older syntax that combined them errors out: "the argument '--base <BRANCH>' cannot be used with '[PROMPT]'"). Run two passes — one for the diff against main, one for the custom-prompt focus — then concatenate. Drop reasoning effort to `medium` to avoid hangs on large diffs (high-effort runs on >1500 lines have stalled past 30 min in the wild; ROK-1070 confirmed).

```bash
cd <worktree>
{
  echo "## Pass 1: default review against main"
  codex -c model_reasoning_effort=medium review --base main 2>&1
  echo
  echo "## Pass 2: scoped focus prompt"
  codex -c model_reasoning_effort=medium review "Review the staged + uncommitted changes (or the most recent commit) for: (1) security/auth bugs, (2) correctness/regressions, (3) contract integrity (Zod/types/migration consistency), (4) Discord bot listener safety. Skip style nits, naming preferences, doc gaps. Browser-level validation (changed user flows, console, network, screenshots) is already covered by the Chrome MCP e2e gate at planning-artifacts/chrome-mcp-summary-ROK-XXX.md — do not re-cover that ground; focus on code-level findings. For each finding: severity (BLOCKER | HIGH | MEDIUM | LOW), file:line, one-line description, suggested fix. Final line: 'VERDICT: APPROVED' or 'VERDICT: APPROVED WITH FIXES' or 'VERDICT: BLOCKED'." 2>&1
} | tee planning-artifacts/review-ROK-XXX.md
cd -
```

The custom prompt is critical for pass 2 — without scope, Codex returns broad style feedback. The format string keeps findings actionable and comparable across stories. If pass 1's default review already produced a clear verdict and the diff is small (<500 lines), pass 2 is optional.

**Hang watchdog:** If Codex produces only the session-header banner and no further output for >5 minutes, treat as hung — `pkill -f "codex review"` and fall back to the Claude reviewer (see "Verdict handling" below). Hangs correlate with: `model_reasoning_effort = "high"` in `~/.codex/config.toml`, large diffs (>1500 lines), and MCP tool servers configured with `approval_mode = "approve"` (an auto-loaded tool can wait forever for human approval). The `-c model_reasoning_effort=medium` override above protects against the first two; if the third bites, run codex with `-c features.experimental_use_rmcp_client=false` to disable MCP loading for the review pass.

### Verdict handling

Read the last line of `planning-artifacts/review-ROK-XXX.md`:

- **`VERDICT: APPROVED`** → `gates.reviewer: PASS`. Proceed.
- **`VERDICT: APPROVED WITH FIXES`** → Lead reads findings. BLOCKER / HIGH fixes apply inline (1-3 lines per fix) and commit `fix: address Codex review (ROK-XXX)` — non-trivial ones respawn the dev with the findings file as context. **MEDIUM / LOW findings DO NOT get fixed inline** — append them to `TECH-DEBT-BACKLOG.md` at the repo root using the dated-section + `- **[sev]**` bullet format (single canonical location parsed by `/readlogs`). Mirror the appended block in the PR body under `## Tech debt observed (not auto-filed)`. Do NOT auto-file Linear tech-debt; do NOT invent runbook "Known Issues" sections. `gates.reviewer: PASS`.
- **`VERDICT: BLOCKED`** → present blockers to operator. May need dev respawn or scope discussion.
- **No clear verdict / Codex errored / output garbled** → fall back to a single `devedup-rl:reviewer` Claude subagent run with the same prompt focus. Don't bypass the reviewer gate just because Codex misbehaved.

### Why no team / no parallel split

Codex handles diffs of any size in one shot — it doesn't run out of context the way a Claude subagent does, so the size-bucket sizing (small/medium/large/XL) doesn't apply. Single command, single output file, no aggregation work. If the diff is genuinely massive (>10k lines) and Codex's output is shallow, run a second pass scoped to a specific path: `codex -c model_reasoning_effort=medium review --base main api/src/auth/`. Path scoping uses positional args; combining `--base` with the focus prompt is not supported in v0.121.0.

### Claude reviewer fallback

If Codex hangs / errors / produces no verdict, do NOT spawn a Claude subagent of type `devedup-rl:reviewer` and ask it to write the review file — that subagent has only `Read, Grep, Glob, Bash` and cannot persist findings to disk, so its work disappears at end-of-call. Instead, do the review as Lead with direct grep + read commands against the diff (this catches the constraints that matter: DEMO_MODE gating, `test.skip` count, helper-signature compatibility, production-source diff scope, `sleep()` audit). Record findings inline in `planning-artifacts/review-ROK-XXX.md` and proceed to the verdict line. Lead-driven review is the documented fallback when Codex is unavailable.

---

## 4c. Optional: Architect Final (if needs_architect)

Sequential — must finish before smoke. Read `templates/architect.md`, `<TASK_TYPE>` = `POST_REVIEW`, pass `git diff main..HEAD`. Verdicts same as 4b. BLOCKED → resolve before shipping.

---

## 4d. Lead Smoke Tests

**Skip entirely for `scope: light`** — fast CI in step 2-light-c plus operator approval is sufficient. Set `gates.smoke_test: N/A` and proceed to 4e.

For standard / full scope, never skipped. From main worktree:

```bash
git pull --rebase origin main
./scripts/validate-ci.sh --no-e2e
```

`validate-ci.sh --no-e2e` covers build/typecheck/lint/unit/integration across all workspaces in one pass and skips the e2e steps (which need a deployed env and got covered in 3c.5 against the worktree).

If UI / bot changes need post-rebase re-verification:

- **MODE=fleet:** re-run `rl_validate_ci` with `args: ["--only-e2e", "--with-e2e"]` and `against_env_slug: "rok-<num>"`.
- **MODE=local:** re-acquire the env lock, deploy the main worktree (`./scripts/deploy_dev.sh --ci --rebuild`), then run `./scripts/validate-ci.sh --only-e2e --with-e2e`. Release the env lock immediately after. Don't hold the lock through 4e or Step 5 — push and PR creation don't need the env.

Gate: `gates.smoke_test: PASS` or `FAIL`. On failure: diagnose (timing? `sleep()`?). Regression → fix or respawn dev. Test infra issue (flaky, missing wait) → fix the test, don't skip. **Never dismiss as "pre-existing"** — investigate and fix, or create a Linear story with root cause.

---

## 4e. Update State

```yaml
stories.ROK-XXX:
  status: "ready_to_ship"
  next_action: "All gates passed. Read step-5-ship.md."
```

When ALL stories reach `ready_to_ship`, proceed to **Step 5**.
