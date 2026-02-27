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
```

If CI fails:
- **Lint/type errors:** Fix directly in the worktree, commit as `fix: resolve CI issues (ROK-XXX)`
- **Test failures:** Assess — if trivial, fix. If complex, re-spawn dev for the failing story.

Update state: `gates.ci: PASS` (or `FAIL`)

---

## 3b. Push Branch

```bash
cd $WORKTREE && git push -u origin rok-<num>-<short-name>
```

---

## 3c. Deploy Locally

```bash
# From the worktree (or main repo) — script is worktree-aware
./scripts/deploy_dev.sh --ci --rebuild
```

The script handles Docker, .env copying, migrations, seeding, and health checks automatically.

If the deploy fails, diagnose and fix. If it needs `--fresh` (DB wipe), get operator approval first (destructive operation).

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

Update `build-state.yaml`:

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
