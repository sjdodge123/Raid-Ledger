# Step 4: Review — Poll Linear, Rework, Reviewer, Architect, Smoke

## HARD RULE — STILL NO PUSH

The branch remains **local-only** through this step. Do NOT invoke `git push`, `gh pr create`, `gh pr merge --auto`, or the `/push` skill (even with `--skip-pr`) anywhere in Step 4 — including during rework loops. The first push lives in Step 5.

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

## 4b. Codex Review (single shell command — no subagent)

Reviewer is **Codex CLI**, not a Claude subagent. Different model = different blind spots, and one shell call is faster than spawning subagents into a team and aggregating outputs.

**Skip the reviewer entirely if:**
- Diff is `<300 net lines` AND no risk markers (no migration, no Dockerfile, no `packages/contract/`, no auth code, no money/payments code). Operator approval was the gate; Codex is for genuinely risky diffs.
- `codex` CLI is not on PATH (record `gates.reviewer: SKIPPED — codex unavailable`, proceed).

### Run Codex

```bash
cd <worktree>
codex review --base main "Review this Raid-Ledger PR for: (1) security/auth bugs, (2) correctness/regressions, (3) contract integrity (Zod/types/migration consistency), (4) Discord bot listener safety. Skip style nits, naming preferences, doc gaps. For each finding: severity (BLOCKER | HIGH | MEDIUM | LOW), file:line, one-line description, suggested fix. Final line: 'VERDICT: APPROVED' or 'VERDICT: APPROVED WITH FIXES' or 'VERDICT: BLOCKED'." 2>&1 | tee planning-artifacts/review-ROK-XXX.md
cd -
```

The custom prompt is critical — without scope, Codex returns broad style feedback. The format string keeps findings actionable and comparable across stories.

### Verdict handling

Read the last line of `planning-artifacts/review-ROK-XXX.md`:

- **`VERDICT: APPROVED`** → `gates.reviewer: PASS`. Proceed.
- **`VERDICT: APPROVED WITH FIXES`** → Lead reads findings, applies trivial fixes inline (1-3 lines per fix), commits `fix: address Codex review (ROK-XXX)`. `gates.reviewer: PASS`. For non-trivial fixes, respawn the dev with the findings file as context.
- **`VERDICT: BLOCKED`** → present blockers to operator. May need dev respawn or scope discussion.
- **No clear verdict / Codex errored / output garbled** → fall back to a single `devedup-rl:reviewer` Claude subagent run with the same prompt focus. Don't bypass the reviewer gate just because Codex misbehaved.

### Why no team / no parallel split

Codex handles diffs of any size in one shot — it doesn't run out of context the way a Claude subagent does, so the size-bucket sizing (small/medium/large/XL) doesn't apply. Single command, single output file, no aggregation work. If the diff is genuinely massive (>10k lines) and Codex's output is shallow, run a second Codex pass scoped to a specific path: `codex review --base main "Focus only on api/src/auth/** for this pass."`

---

## 4c. Optional: Architect Final (if needs_architect)

Sequential — must finish before smoke. Read `templates/architect.md`, `<TASK_TYPE>` = `POST_REVIEW`, pass `git diff main..HEAD`. Verdicts same as 4b. BLOCKED → resolve before shipping.

---

## 4d. Lead Smoke Tests

**Skip entirely for `scope: light`** — fast CI in step 2-light-c plus operator approval is sufficient. Set `gates.smoke_test: N/A` and proceed to 4e.

For standard / full scope, never skipped. From main worktree:

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
