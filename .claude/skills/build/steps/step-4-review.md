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

## 4b. Size the Diff, Then Spawn Reviewer(s)

**Run the sizing check BEFORE spawning.** Pre-flight prevents burning tokens on a reviewer that runs out of context mid-run.

```bash
cd <worktree>
git diff origin/main..HEAD --stat | tail -1     # N files changed, +A -D
git diff origin/main..HEAD --stat | grep -v "snapshot\|package-lock" | wc -l
git log --oneline origin/main..HEAD | wc -l
```

| Signals | Strategy |
|---|---|
| ≤500 lines, ≤10 files, 1 workspace | **Single agent** |
| ≤2000 lines, ≤25 files, ≤2 workspaces | **Single agent** (incremental file flush) |
| 2000–5000 lines **OR** contract+api+web **OR** migration + 20+ files | **3-agent parallel split** |
| 5000+ lines **OR** full cross-cutting **OR** 30+ commits | **4+ agent split** (add dedicated "integration + cross-layer" pass) |

### Single agent (default)
Read `templates/reviewer.md`, fill variables, spawn as a team member. Agent writes findings to `planning-artifacts/review-ROK-XXX.md` incrementally.

### Parallel split (for large diffs) — use dev team agents

1. Create a team: `TeamCreate({ name: "review-ROK-XXX", description: "..." })`.
2. Create three tasks via `TaskCreate`, one per slice:
   - **security-correctness** — critical/security + correctness + auto-fix authority → `review-ROK-XXX-security.md`
   - **tests-contract** — tests + contract integrity → `review-ROK-XXX-tests.md`
   - **perf-style** — performance/complexity + style + tech debt → `review-ROK-XXX-style.md`
3. Spawn three `Agent` calls (same single message, parallel) with matching `team_name` and `subagent_type: devedup-rl:reviewer`. Each agent picks up its task via `TaskList` + owner assignment.
4. When all three tasks are `completed`, Lead reads the three findings files and writes the aggregated `review-ROK-XXX.md` with unified verdict + commit-SHA footer.
5. Delete the team: `TeamDelete({ name: "review-ROK-XXX" })`.

Why teams (not loose subagents): shared context means each agent can reference the others' findings, one agent can flag something and hand it to the right specialist via `SendMessage`, and the shared task board gives Lead a single `TaskList` call to monitor progress.

### Verdict handling (applies to single or aggregated)
- **APPROVED / APPROVED WITH FIXES:** `gates.reviewer: PASS`. Auto-fix commits stay local — Step 5 handles the push.
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
