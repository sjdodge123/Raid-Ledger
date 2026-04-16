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

## 3b–3f. Build, TypeScript, Lint, Unit Tests, Integration

Run each in sequence. Fix failures directly on batch branch (`fix: resolve <issue>`). If substantive (logic bug from a story), diagnose which story, fix or respawn dev.

```bash
npm run build -w packages/contract && npm run build -w api && npm run build -w web
npx tsc --noEmit -p api/tsconfig.json && npx tsc --noEmit -p web/tsconfig.json
npm run lint -w api && npm run lint -w web
npm run test -w api && npm run test -w web
npm run test:integration -w api
```

State: `gates.ci: PASS`, `gates.integration: PASS` (or FAIL).

---

## 3g. Playwright Smoke (mandatory for every batch)

Backend changes can break UI flows — always run.

```bash
# Docker/API/web already up from Step 2b. Just verify.
curl -s http://localhost:3000/system/status | head -20
npx playwright test
```

On failure:
- Selector/flake → fix test or UI (`fix: resolve Playwright issues`).
- Regression → diagnose which story, fix or respawn dev.

State: `gates.smoke: PASS` (or `FAIL`).

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
- Build / TypeScript / Lint: PASS
- Unit tests: PASS
- Integration tests: PASS
- Playwright smoke: PASS

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
    ci: PASS
    integration: PASS
    smoke: PASS
    pr: PENDING
```

(`review` gate is per-story now, captured in `stories.ROK-XXX.gates.reviewer`.)

Proceed to **Step 4**.
