# Step 4: Review — Poll Linear, Rework, Architect, Smoke

**Lead checks Linear directly, handles rework loops, and runs final gates.**

**Note:** Code review is handled automatically by the CI-based Claude Code reviewer
(see `.github/workflows/ci.yml` → `claude-review` job). The lead no longer needs to
spawn a reviewer agent or route verdicts. Non-blocking findings are captured as GitHub
issues for triage into Linear.

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
3. Continue to 4b

---

## 4b. CI Code Review (Automated)

Code review runs automatically via the `claude-review` CI job when the branch is pushed.
No manual action required — the CI reviewer posts its verdict as a GitHub PR review.

Check the CI status:
```bash
gh pr checks <pr_number>
```

- **claude-review PASS:** Update `gates.reviewer: PASS`. Continue.
- **claude-review FAIL (request changes):** Present blocking issues to operator. May need dev re-spawn.

Non-blocking findings are created as GitHub issues tagged `reviewer-finding` for later triage.

---

## 4c. Optional: Architect Final Check (if needs_architect)

**SEQUENTIAL — must complete before smoke tests.**

Read `templates/architect.md`, set `<TASK_TYPE>` to `POST_REVIEW`, pass the full diff:

```
Task(subagent_type: "general-purpose", team_name: "<team_name>",
     name: "architect-final-rok-<num>", model: "sonnet", mode: "bypassPermissions",
     prompt: <filled architect.md with git diff main..HEAD>)
```

Wait for verdict:
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
- Diagnose the failure
- If it's a regression from this story → fix or re-spawn dev
- If it's a pre-existing issue → note it, proceed if unrelated

---

## 4e. Update State

```yaml
stories:
  ROK-XXX:
    status: "ready_to_ship"
    next_action: "All gates passed. Read steps/step-5-ship.md."
```

When ALL stories reach `ready_to_ship`, proceed to **Step 5**.
