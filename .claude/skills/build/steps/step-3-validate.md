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

## 3c. Operator-Review Deploy (mode-branched)

Read `pipeline.test_infra_mode` from `build-state.yaml` (set in Step 1f.5 preflight). Branch on its value.

### If MODE=fleet (preferred — VM is reachable)

The slot was claimed at session start in Step 1f.5 (implicitly by `rl_status` succeeding) or will be on first use of `rl_env_deploy` (idempotent). One MCP call chains claim → build allinone from the worktree's branch → spin per-env stack → sync settings → optional prod clone → return URL:

```
mcp__mcp-rl-fleet__rl_env_deploy({
  slug: "rok-<num>",
  worktree_path: "<absolute path to worktree, e.g. /Users/sdodge/Documents/Projects/Raid-Ledger--rok-<num>>",
  clone_prod: <true if prod-shaped data needed; false for synthetic test data>
})
```

The MCP returns `{ url: "https://rok-<num>test.gamernight.net", internal_url: "http://rok-<num>.rl.lan", ... }`. Use `url` everywhere downstream — it works on LAN (Pi-hole short-circuit) AND off-LAN (Cloudflare → NPM). Subsequent Chrome MCP navigation in 3c.6 points at this URL.

No env lock to acquire. Other agents on other slots are unaffected.

If `rl_env_deploy` returns `ok: false` with `error: "fleet_unreachable"`, the VM died mid-session. STOP. Tell the operator: "Fleet became unreachable mid-build. Set `RL_TARGET=local` and re-invoke Step 3c to fall back to local deploy." Do not silently switch.

### If MODE=local (fallback — VM down / explicit override)

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

If deploy needs `--fresh` (DB wipe), get operator approval (destructive). The operator-review URL is `http://localhost:5173`.

---

## 3c.5. Post-Deploy E2E Gate (diff-gated, mode-aware)

After deploy, run the e2e portion of validate-ci. The script auto-skips Playwright if no UI/auth/demo-test files changed and auto-skips Discord smoke if no bot/notification files changed — so backend-only stories pass through this gate in seconds.

### If MODE=fleet

The runner image already has Playwright browsers (Microsoft Playwright base image). Run e2e inside the runner against the fleet env URL — laptop stays free:

```
mcp__mcp-rl-fleet__rl_validate_ci({
  args: ["--only-e2e"],
  against_env_slug: "rok-<num>",
  worktree_path: "<same as 3c>"
})
```

The MCP tool sets `BASE_URL=http://rl-env-rok-<num>-allinone` (Playwright), `API_URL=http://rl-env-rok-<num>-allinone/api` (companion bot), and `HEALTH_URL=...` inside the runner before invoking validate-ci. The runner is on `rl-net`, so it reaches the env's allinone via Docker DNS — no Cloudflare hop.

**Discord-token collision constraint (read before Discord smoke runs).** The Raid Ledger bot and companion bot can each only have ONE active session per token. If your local dev allinone is ALSO running with the same operator-synced bot token, OR another fleet env is running Discord-active concurrently, Discord will disconnect one of them mid-test. Mitigations:

- Keep the local allinone DOWN (`./scripts/deploy_dev.sh --down`) when running Discord smoke against a fleet env.
- Run Discord-active fleet smokes one-at-a-time across slots until per-slot bot tokens are provisioned (future work).
- If smoke fails with "DiscordAPIError" or sudden disconnects, this is the cause — not flake. Stop, ensure no other Discord-active env / local allinone is running, retry. No `localhost:5173` involvement.

### If MODE=local

```bash
cd ../Raid-Ledger--rok-<num> && ./scripts/validate-ci.sh --only-e2e && cd -
```

What this runs:
- **Playwright** (BOTH desktop + mobile — matches CI) iff diff touches `web/**`, `api/src/auth/**`, `api/src/admin/demo-test*`, `playwright.config.*`, or `scripts/smoke/**`.
- **Discord smoke** iff diff touches `api/src/discord-bot/**`, `api/src/notifications/**`, `api/src/events/signups*`, `api/src/events/event-lifecycle*`, `api/src/admin/demo-test*`, `tools/test-bot/src/smoke/**`, or `tools/test-bot/src/helpers/polling.ts`.

If you suspect the gate's scope is wrong for this story (e.g. you changed a shared layout component that the diff detector won't flag as UI-touching), force-run with `./scripts/validate-ci.sh --only-e2e --with-e2e`.

On failure:
- Selector/flake → fix test or UI, commit `fix: resolve e2e issues (ROK-XXX)`.
- Real regression → diagnose which story broke it, fix or respawn dev.
- After fix: re-run, then continue. **Do not push.**

Gates: `gates.playwright: PASS` / `FAIL` / `SKIPPED`; `gates.discord_smoke: PASS` / `FAIL` / `SKIPPED`. Map them from the validate-ci summary table.

---

## 3c.6. Chrome MCP e2e Gate (MANDATORY before operator review)

The Lead drives the *changed user flows* via `mcp__claude-in-chrome__*` on the deployed app — captures screenshots / GIFs, audits console + network, and produces an operator-facing summary BEFORE flipping Linear to "In Review". **Must complete before the operator FULL STOP (3e), before the Codex reviewer (4b), and before any push or PR work.**

Full playbook: `.claude/skills/_shared/chrome-mcp-e2e.md`.

**What Lead does here (per-story):**

1. Derive the changed-flow list from `git diff main..HEAD --name-only` in the story worktree + the story's ACs.
2. Pass the flow list + the story ID as inputs to the shared playbook.
3. **Pass the right base URL** based on `pipeline.test_infra_mode`:
   - MODE=fleet → `https://rok-<num>test.gamernight.net` (the `url` returned by 3c's `rl_env_deploy`)
   - MODE=local → `http://localhost:5173`
   Chrome MCP (driven on the operator's local Chrome) navigates to whichever URL applies. The Chrome MCP tool itself stays local regardless of mode — only its TARGET changes.
4. Execute the playbook. Do NOT skim it; the anti-pattern section catches the failure modes that triggered this gate's creation (ROK-1237).
5. Write the summary to `planning-artifacts/chrome-mcp-summary-ROK-XXX.md`. Save captures under `planning-artifacts/chrome-mcp-screenshots/ROK-XXX/`.
6. **Mode-aware hold behavior:**
   - MODE=fleet → no env lock exists; the spun env stays up automatically until you destroy it or TTL reaps. Operator can browser-test against the same URL in the FULL STOP window. No action needed here.
   - MODE=local → **keep the env lock** — the operator will browser-test on the same deploy in the FULL STOP window. Don't release until 4a (operator verdict).

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

The app is deployed at <**MODE=fleet:** `https://rok-<num>test.gamernight.net` | **MODE=local:** `http://localhost:5173` (env-lock held — Lead releases when you give a verdict)>. Test each story and update Linear:
- **Code Review** = approved, ready for code review
- **Changes Requested** = needs rework (add feedback as comment)

I'll wait.
```

### 3e.5. Post the operator-tester checklist (MANDATORY in fleet mode)

When MODE=fleet, AFTER posting the operator-presentation block above, **always post a test plan** so the operator (and any external testers they share the URL with) have a clear walk-through with pass/fail/skip + ↗ deep-link + ↻ reset buttons per step on `fleet.gamernight.net`. This is the default — only skip for pure-API stories with no in-app surface at all.

```
mcp__mcp-rl-fleet__rl_test_plan_create({
  slug: "rok-<num>",
  worktree_path: "<same as 3c>",
  title: "ROK-<num>: <short story title>",
  steps: [
    {
      description: "Open Common Ground tab in /lineups",
      expected: "≥3 themed rows render",
      test_url: "<env.url>/lineups#common-ground",   // env.url is the slot URL — works for OAuth too
      reset_hint: "Refresh seed data via POST /api/admin/seed-lineups",
    },
    {
      description: "Vote 'why' on the top-row lineup",
      expected: "Vote count increments by 1, why-modal closes",
      test_url: "<env.url>/lineups#common-ground",   // env.url is the slot URL — works for OAuth too
      reset_hint: "Reset votes for this tester via POST /api/admin/votes/reset?tester=<name>",
    },
    ...
  ]
})
```

**How to write good steps (read this before composing):**

- **Small & actionable** — each step should take a tester ≤30 seconds to perform. Bad: "Verify the lineups page works." Good: "Open /lineups → Common Ground tab, expect ≥3 themed rows."
- **One assertion per step** — if a step has two "and"s, split it.
- **`test_url` on every step** — deep-link to the screen the tester needs. Construct from the `env_url` you got back from `rl_env_deploy` plus the relevant route/anchor. Without it the tester has to navigate manually and may end up on the wrong screen.
- **`reset_hint` on stateful steps only** — include when the step mutates server-side data the tester might want re-set for a re-test (writes, votes, mutations). The hint serves two purposes: (a) tester-side tooltip on the ↻ button, (b) reminds YOU what to do when the tester taps reset. For read-only / navigation-only steps, omit it (the ↻ button won't render).
- **Order matters** — dashboard enforces sequential completion. Step 5 stays locked until step 4 has a verdict.
- **≤10 steps** — longer plans usually mean the story should split. Group related sub-assertions under one step ("Open the modal — header reads 'Why?', cancel button works").

**React to submissions + reset requests:**

The dashboard buffers tester verdicts locally; only **Submit test results** (per testing round) sends to you in one batch. The ↻ reset button is the exception — it pings immediately. So you have two signals to watch for:

1. **A new `submissions[]` entry** — tester completed a round. `plan.submissions[-1]` carries `{ tester, ts, count, verdicts: {pass: N, fail: M, skip: K} }`. Detailed per-step results in `plan.steps[].results[]` (latest entry has the verdict + tester + ts).
2. **`summary.pending_resets > 0`** — tester tapped ↻ on at least one step. Find via `plan.steps[].reset_requests[].status === 'pending'`. The step's `reset_hint` is the action you wrote for yourself (e.g. "Refresh seed data via POST /api/admin/seed-lineups") — execute it.

After posting the initial plan, enter a wait loop:

```
loop:
  result = rl_test_plan_wait({ slug: "rok-<num>", worktree_path: "...", timeout_seconds: 600 })
  if result.timed_out: continue

  # Reset signal — happens mid-test, react fast
  if result.summary.pending_resets > 0:
    # Execute the reset action(s) per pending reset_request — the step's
    # reset_hint tells you what to do. After resetting, post a NEW plan
    # (replace=true) with the same step list so the tester sees the
    # reset banner clear + can continue.

  # Submission signal — full testing round complete
  new_subs = result.plan.submissions.length - last_seen_subs_count
  if new_subs > 0:
    review the latest submission's per-step verdicts
    if any 'fail': make the fix, redeploy via rl_env_deploy (idempotent),
                   post a NEW plan (replace=true) targeting the fix area
    if all 'pass' or 'skip': testing pass complete — exit loop, continue to Step 4
```

`rl_test_plan_status({ slug })` is the cheap one-shot if you don't want long-poll.

The plan auto-deletes when `rl_env_destroy` fires at session end. **SKIP this whole step when MODE=local** — the dashboard isn't part of local-mode infra.

If any row shows FAIL, fix it before presenting. If Local CI Proof or Chrome MCP e2e Pre-Review Summary is missing from your output, you skipped 3a or 3c.6 — go back. Do NOT proceed until operator gives direction.
