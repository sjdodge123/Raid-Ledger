# Step 3: Validate — Fleet CI + Fleet Deploy + Playwright + Chrome MCP

Lead runs everything. **Fleet-by-default for batch builds** — both CI AND e2e target the rl-infra fleet so the operator's laptop stays free for parallel work.

---

## HARD RULE — NO PUSH IN STEP 3 (same as /build)

The branch stays local-only through Steps 1-4. No `git push`, no `gh pr create`, no `gh pr merge --auto`. First push is in Step 5 after operator + reviewer approval.

---

## 3a. Spec ↔ implementation reconciliation (per `feedback_spec_reconcile_before_review.md`)

For each milestone, walk through `planning-artifacts/specs/<STORY>-M<N>-spec.md` vs what was actually built:
- Any AC NOT delivered → flag in build-state.yaml, append note to the spec
- Any scope ADDED beyond the spec → fold into the spec as "added scope" with rationale
- Any spec deviation → update spec

Reviewers in Step 4 read the UPDATED spec, so this reconciliation has to happen BEFORE spawning them.

---

## 3b. CI run — FLEET by default (local fallback)

**Default for batch builds: target the rl-infra fleet.** Local fallback only if fleet unreachable.

```bash
# Acquire env lock — STILL needed; the fleet path uses it to coordinate against parallel fleet users
mcp__mcp-env__env_lock_acquire({ purpose: "build-batch <STORY> CI" })

# Try fleet first
if RL_PROXMOX_HOST resolves AND ./rl-infra/cli/rl is executable; then
  RL_TARGET=remote ./rl-infra/cli/rl validate-ci --full
else
  echo "Fleet unreachable — falling back to local validate-ci.sh"
  ./scripts/validate-ci.sh --full
fi
```

**STOP and fix any failures before continuing.** Never dismiss as "pre-existing" without confirming on `origin/main` first per CLAUDE.md "Document pre-existing failures" STRICT rule.

If a failure IS pre-existing → append to `TECH-DEBT-BACKLOG.md` with the format from CLAUDE.md, commit as part of this batch (`chore(tech-debt): document pre-existing failures from <STORY> validate`).

---

## 3c. Deploy — FLEET by default (local fallback)

For batch builds, the worktree env deploys to a fleet slot:

```bash
# Claim a fleet slot for the worktree's branch
RL_TARGET=remote ./rl-infra/cli/rl claim --branch <branch>   # may enqueue with queue_position=N when contended
# If the CLI prints `enqueued queue_position=N`, every slot is held — either
# `rl_claim_wait` (MCP) / `rl claim-wait --timeout 600` (CLI) to block on
# queue head, OR pick non-env work and retry later. inherited_envs[] tells
# you which child envs survive from the prior holder when the slot is granted.

# Build + deploy the allinone image to the slot
RL_TARGET=remote ./rl-infra/cli/rl env-deploy --slug <STORY>-validate --branch <branch>
```

(For stories that touch `tools/mcp-rl-fleet/` itself — like ROK-1331 — the operator may want to test the NEW MCP tools against the deployed env. Coordinate: spawn validate-ci via the new MCP, watch the dashboard render the active task. This is the "eat our own dog food" path.)

Verify the slot env is healthy:
```bash
SLOT_URL="https://slot-${RL_SLOT}.gamernight.net"
curl -fsS --max-time 5 "$SLOT_URL/api/health" | jq    # expect db.connected: true, redis.connected: true
```

**Fallback (fleet down):** local deploy with `./scripts/deploy_dev.sh --ci --rebuild`. Note the fallback in state file + operator-facing summary.

---

## 3d. Playwright — FLEET target

```bash
export BASE_URL="https://slot-${RL_SLOT}.gamernight.net"
export PLAYWRIGHT_BASE_URL="$BASE_URL"
export HEALTH_URL="$BASE_URL/api/health"

cd <worktree> && ./scripts/validate-ci.sh --only-e2e
```

The script auto-skips Playwright if no UI/auth/demo-test files changed across the milestones, and auto-skips Discord smoke if no bot/notification files changed. Per CLAUDE.md "Smoke Test Verification" STRICT rule: BOTH desktop + mobile projects run; never narrow with `--project=desktop`.

If a test fails:
- Selector/flake → fix test or UI, commit `fix: resolve e2e issues (<STORY>)`.
- Real regression → diagnose which milestone broke it, fix or respawn dev (return to Step 2d).
- After fix, re-run. **Do NOT push.**

Gates per milestone: `gates.playwright: PASS / FAIL / SKIPPED`, `gates.discord_smoke: PASS / FAIL / SKIPPED`. Map from the validate-ci summary.

**Local fallback (fleet deploy was the fallback path):** use `http://localhost:5173` as BASE_URL; same script, different target.

---

## 3e. Chrome MCP e2e — FLEET target, MANDATORY before operator review

Drive each changed user-flow via `mcp__claude-in-chrome__*` against the fleet slot URL.

Full playbook: `.claude/skills/_shared/chrome-mcp-e2e.md`. Source-of-truth memory: `feedback_chrome_mcp_e2e_before_review.md`.

### What Lead does (per batch — covers cross-milestone integration)

1. Derive the changed-flow list from `git diff origin/main..HEAD --name-only` + each milestone's ACs.
2. For batch builds: **explicitly cover cross-milestone integration flows**, not just per-milestone golden paths. For ROK-1331 these are:
   - Spawn `rl_validate_ci` via the new async MCP (M2) → watch dashboard render the active task (M3 + M5b) → verify lease-queue updates as a second agent claims (M5a). End-to-end exercise of the new surface.
3. Navigate via Chrome MCP to `https://slot-${RL_SLOT}.gamernight.net` and execute each flow.
4. Capture screenshots / GIFs to `planning-artifacts/chrome-mcp-screenshots/<STORY>/`.
5. Audit console + network for new errors.
6. Write the summary to `planning-artifacts/chrome-mcp-summary-<STORY>.md`.

### Verdict structure (matches /build step 3c.6)

- `VERDICT: PASS` → `gates.chrome_mcp_e2e: PASS`. Continue to 3f.
- `VERDICT: PASS WITH NOTES` → `gates.chrome_mcp_e2e: PASS`. Include notes in the operator-presentation block at 3g so the operator knows what to look at. Append medium/low findings to `TECH-DEBT-BACKLOG.md` (single canonical location parsed by `/readlogs`). Mirror the appended block in the PR body under `## Tech debt observed (not auto-filed)`.
- `VERDICT: FAIL` → `gates.chrome_mcp_e2e: FAIL`. Do NOT flip Linear to "In Review". Do NOT spawn reviewer. Lead fixes inline (1-3 lines, `fix: resolve Chrome MCP finding (<STORY>)`) OR respawns the relevant milestone's dev. Re-run the gate.

---

## 3f. Flip Linear to "In Review"

```
mcp__linear__save_issue({ issueId: "<linear_id>", statusName: "In Review" })
```

Add a Linear comment summarizing:
- All milestones shipped + their commit ranges
- CI / Playwright / Chrome MCP / Discord smoke results
- Any tech-debt entries added to TECH-DEBT-BACKLOG.md
- Slot URL the operator will browser-test against: `https://slot-${RL_SLOT}.gamernight.net`

---

## 3g. Update state, present to operator, FULL STOP

Update `<worktree>/build-state.yaml`:

```yaml
pipeline:
  current_step: "review"
  next_action: "All milestones in 'In Review'. Operator browser-tests at https://slot-N.gamernight.net. When verdict given via Linear → read step-4-review.md."
global_gates:
  ci: PASS
  playwright: PASS                # or SKIPPED if no UI changes
  discord_smoke: PASS             # or SKIPPED if no bot changes
  chrome_mcp_e2e: PASS            # or PASS WITH NOTES
  operator_review: WAITING
```

Present the operator-presentation table (mandatory, not optional):

```
## /build-batch <STORY> — Ready for Operator Review

Branch: `<branch>`
Slot URL: `https://slot-N.gamernight.net` (fleet — your laptop env is FREE)

### Milestones shipped (commit ranges in this batch)
| Milestone | Title | Commit range | Files | Tests passing |
|-----------|-------|--------------|-------|---------------|
| M1 | ... | <hash>..<hash> | N | N/N |
| ... |

### Verification table
| Gate | Result |
|------|--------|
| Architect pre-dev | PASS |
| TDD tests (per-milestone) | N/N PASS |
| Dev AC audits (per-milestone) | N/N PASS |
| Fleet CI (`rl validate-ci --full`) | PASS |
| Playwright (desktop + mobile) | PASS / SKIPPED |
| Discord smoke | PASS / SKIPPED |
| Chrome MCP e2e | PASS / PASS WITH NOTES |

### Chrome MCP e2e summary
| Flow exercised | Console | Network | Captures |
|----------------|---------|---------|----------|
| <flow 1> | clean | 2xx only | path/ |
| <flow 2> | clean | 2xx only | path/ |
...

Full report: `planning-artifacts/chrome-mcp-summary-<STORY>.md`
Notes for operator attention: <inline bullets from findings>

### Tech-debt added during this batch (if any)
<paste the new TECH-DEBT-BACKLOG.md section>

### Pre-req operator actions completed
- <list any from the plan that were done>
- <list any still pending — surface explicitly>

Test the slot URL and update Linear:
- **Code Review** = approved, ready for code review
- **Changes Requested** = needs rework (add feedback as comment)

I'll wait.
```

### Release env-lock now (per `feedback_env_lock_minimal_hold.md`)

Reviewer (Step 4) and architect (Step 4d) do NOT need the env. Release now:

```
mcp__mcp-env__env_lock_release
```

For fleet builds the slot lease stays active — the operator is browser-testing against the slot and the slot's lease lives independently of the local env-lock. Don't release the slot until Step 5 ship cleanup.

Proceed to **Step 4 — Review** when the operator gives a verdict via Linear.
