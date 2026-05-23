# Chrome MCP e2e Gate (shared)

This playbook is the **mandatory pre-review browser validation** referenced by `/fix-batch`, `/build`, and `/bulk`. The agent drives the changed user flows against the deployed review env via `mcp__claude-in-chrome__*` and produces an operator-facing summary BEFORE any reviewer agent / Codex run, PR creation, or auto-merge.

**Source of truth for the rule:** `~/.claude/projects/-Users-sdodge-Documents-Projects-Raid-Ledger/memory/feedback_chrome_mcp_e2e_before_review.md`. Caught 2026-05-12 during fix-batch ROK-1237+1271+1267.

---

## Why this gate exists

Vitest + MSW + jsdom cannot fully simulate real React reconciliation, real network, real DOM, real Sentry hooks, or admin/SSE/Discord-embed flows. Multiple shipped batches passed every Jest/Vitest/Playwright run but bricked the prod UI for guilds (ROK-1237). Chrome MCP exercises the *actually-rendered application* the operator will land on. **Skipping this gate is a pipeline violation, not a discretionary call.**

---

## Inputs

The caller (Lead in fix-batch / build / bulk) must provide:

- **Changed flows:** a list of user-visible flows touched by the batch. Derive from `git diff origin/main..HEAD --name-only` plus the story ACs. Example: `["Event detail page (signup, role-fill)", "Admin dedup audit", "Lineup viewer-filter"]`.
- **Story IDs:** the `ROK-###` set covered by this run, for the summary table and screenshot naming.
- **Per-story AC links:** each story's acceptance criteria as Lead understands them — Chrome MCP must exercise each AC, not just "the page loads."
- **Base URL:** the deployed app URL. Fleet mode uses the `url` returned by `rl_env_deploy`; local mode uses the URL printed by the local deploy script.

If the batch is API-only with NO UI surface, the gate still runs but is scoped to: (1) verify no upstream UI regressions on the affected feature area, and (2) verify the API endpoint via the in-app surface that uses it (admin page, settings panel, etc.). Pure-internal endpoints that no UI consumes can record `gates.chrome_mcp_e2e: N/A — api-internal-only` with a one-line justification.

---

## Procedure

### 0. Review-env discipline

Use the same review env that Step 3 deployed.

**Fleet mode:** do not acquire a local env lock. Use the fleet URL returned by `rl_env_deploy`; keep the env alive for the operator review window.

**Local mode:** the dev env (`:3000`, `:5173`, Docker DB) is a single shared resource. Multiple agents / worktrees / operator sessions queue on it. The caller should already hold the env lock from deploy; keep it through Chrome MCP and operator review.

Local order:

1. **Right before deploy:** `env_lock_acquire`.
2. **After operator verdict:** `env_lock_release`.
3. **Re-acquire** if a later step (rare — e.g. reviewer finding requires fix + re-verify) needs the env again. Don't pre-emptively hold "just in case."

If you're queued and need to wait, do non-env work in the meantime (PR draft, spec reconcile). Don't bypass.

### 1. Acquire env lock (do this IMMEDIATELY before deploy, not earlier)

```
mcp__mcp-env__env_lock_status                                                    # check holder + queue
mcp__mcp-env__env_lock_acquire({ purpose: "chrome-mcp-e2e gate for <batch-id>" })
```

If queued: do non-env work until the lock returns. Don't bypass — the gate runs on a real deploy, not a shortcut.

### 2. Deploy the batch branch locally

Run from the batch worktree (fix-batch / bulk) or the story worktree (build standard/full):

```bash
./scripts/deploy_dev.sh --ci --rebuild
```

Wait for the script to report API + web healthy. If deploy fails, the gate is `FAIL` — debug the deploy first; do NOT proceed to Chrome MCP. If the failure is unrelated to env-state (e.g. a code bug), release the lock while you fix the code, then re-acquire.

### 3. Enumerate Chrome tabs

```
mcp__claude-in-chrome__tabs_context_mcp
```

Use the existing dev tab if one is already pointed at `<BASE_URL>`. Otherwise:

```
mcp__claude-in-chrome__tabs_create_mcp({ url: "<BASE_URL>" })
```

Never reuse a tab ID from a prior session — IDs are session-scoped.

### 4. Drive each changed flow

For every flow in the Inputs list, exercise the full happy path AND at least one failure / edge case the AC mentions. Recommended pattern per flow:

```
mcp__claude-in-chrome__navigate({ url: "<BASE_URL>/<route>" })
mcp__claude-in-chrome__read_page                            # snapshot DOM state
mcp__claude-in-chrome__find({ ... }) / form_input / computer  # interact
mcp__claude-in-chrome__read_console_messages({ pattern: "error|warn|Sentry" })
mcp__claude-in-chrome__read_network_requests                # confirm expected 2xx, no 4xx/5xx
mcp__claude-in-chrome__gif_creator({ filename: "rok-XXX-<flow>.gif" })  # OR upload_image for stills
```

Capture at least one image per story (still or GIF). Save to `planning-artifacts/chrome-mcp-screenshots/<batch-id>/`.

**Things to actively look for (not just "did the page render"):**

- Console errors / warnings / Sentry beacons that appeared during the flow
- Network 4xx / 5xx from `/api/*` calls
- Skeleton / loading states that never resolve
- React reconciliation errors (`<input>` controlled / uncontrolled flips)
- Form submit handlers that fire twice or not at all
- Modal / toast that never closes or never appears
- Auth bypass in DEMO_MODE flows (silently dropping to login)
- Discord-embed-driven flows: round-trip via the test-bot if relevant (cross-ref `tools/test-bot/`)

### 5. Dialog discipline

NEVER trigger a JavaScript `alert` / `confirm` / `prompt` — those block all further extension events. If a UI button might trigger one, route around it OR use `javascript_tool` to override the dialog handler before clicking. If you accidentally trigger one, the gate is `FAIL` and you must ask the operator to dismiss it.

### 6. Emit the gate summary

Write `planning-artifacts/chrome-mcp-summary-<batch-id>.md` (Lead may inline shorter summaries directly into the operator presentation). Format:

```markdown
# Chrome MCP e2e Gate — <batch-id>

**Branch:** <branch-name>
**Deploy:** PASS (api :3000, web :5173, 0 startup errors)

## Flows exercised

| Story | Flow | AC | Result | Console | Network | Capture |
|-------|------|----|--------|---------|---------|---------|
| ROK-XXX | Event detail signup | AC-3 | PASS | clean | 2xx only | rok-xxx-signup.gif |
| ROK-YYY | Admin dedup audit | AC-1, AC-2 | PASS | clean | 2xx only | rok-yyy-audit.png |
| ROK-ZZZ | Lineup viewer-filter | AC-2 | **FAIL** | TypeError on /lineups/active | 500 on GET /api/lineups | rok-zzz-fail.png |

## Findings

- [BLOCKER | HIGH | MEDIUM | LOW] file:line short description, suggested fix

## Verdict

VERDICT: PASS  |  VERDICT: PASS WITH NOTES  |  VERDICT: FAIL
```

### 7. Update state

In the caller's state file (fix-batch-state.yaml / build-state.yaml / batch-state.yaml):

```yaml
gates:
  chrome_mcp_e2e: PASS  # or FAIL, or "N/A — api-internal-only"
```

### 8. Release env lock IMMEDIATELY after the summary is written

Default: release as soon as the gate's summary file is committed to disk. The reviewer agent, test gap analysis, push, PR creation, and auto-merge do NOT need the env — releasing here unblocks queued agents / operator sessions.

```
mcp__mcp-env__env_lock_release
```

**Only keep the lock past this point if** the caller's pipeline explicitly says "operator will browser-test on this deploy" (build standard/full Step 3 → operator FULL STOP). In that case, the lock transfers responsibility to the operator-review window — Lead notes it in the operator-presentation block and releases when the operator signals done.

If a later finding requires a fix + re-verify, re-acquire then. Pre-emptive holding is a pipeline violation.

---

## Pass / Fail criteria

- **PASS:** every flow executed, every AC exercised, no BLOCKER/HIGH findings, console + network clean (or known-pre-existing noise documented).
- **PASS WITH NOTES:** medium / low findings logged for follow-up — see "Where candidate tech-debt goes" below. Proceed to reviewer.
- **FAIL:** any BLOCKER or HIGH finding (functional regression, security gap, console TypeError, 5xx on AC path). Do NOT spawn the reviewer; do NOT push. Lead either fixes inline (1-3 lines) or respawns dev with the finding. Re-run the gate after the fix.

---

## Where candidate tech-debt goes (STRICT — single canonical location)

Medium / low findings surfaced by this gate are **candidate tech-debt**, not Linear stories. **Append them to `TECH-DEBT-BACKLOG.md` at the repo root.** This is the single canonical location:

- `/readlogs` parses it (`<!-- agents append below this line -->` marker, dated sections).
- `/build`, `/dispatch`, `/fix-batch`, `/bulk` all append here.
- The operator triages this file and decides what becomes a Linear story — agents **never** auto-file `tech-debt:` Linear issues. See `feedback_no_auto_tech_debt.md`.

**Do NOT** invent ad-hoc landing zones — no "Known Issues" sections in runbooks, no scratch files in `planning-artifacts/`, no separate `chrome-mcp-findings.md`. ROK-1068 dropped candidates into a runbook's "Known Issues" section instead of `TECH-DEBT-BACKLOG.md` and the next /build agent couldn't find them. The gate's own summary file (`chrome-mcp-summary-<batch-id>.md`) is for the operator to glance at during the immediate review — it's NOT a backlog.

**Append format** (matches the file's own "Format for skills that parse this file" section):

```markdown
### YYYY-MM-DD — <branch-name> (PR #<num if known, else "pending">)

- **[med]** `path/to/file.ts:LN` — short description.
  Suggested: one-line fix idea (optional).
- **[low]** `path/to/other.tsx:LN` — description.
```

Severities are `high` / `med` / `low` / `nit`. Critical/BLOCKER findings never land in the backlog — they're fixed during the gate or sent back to the dev.

Commit the backlog append as part of the batch's commits with the `chore(config):` prefix (per `feedback_operator_config_rides_along`). The PR description should mirror the appended block under a `## Tech debt observed (not auto-filed)` section so the operator sees it without opening the file.

---

## Anti-patterns (caught in prior batches — do NOT repeat)

- "I read the spec and the deploy came up healthy, so the gate is PASS." No. The gate requires *driving the changed flows*. Reading specs ≠ exercising UI.
- "I ran Playwright and it passed, so Chrome MCP is redundant." No. Playwright covers regression; Chrome MCP validates the *new behavior* added by this batch. They are not substitutes.
- "Pure backend change, skipping." Allowed only if NO in-app surface uses the change. If an admin page / settings panel / Discord embed consumes it, the gate runs and exercises that surface.
- "I'll run the gate after the reviewer approves." No. The gate runs BEFORE the reviewer. Reviewers waste tokens reviewing code that the gate would have caught as broken-in-browser.
- "The env was held, so I skipped." No. Either queue + come back, or operator-priority preempt — never skip.

---

## Callers

| Skill | Where the gate runs | State key |
|-------|---------------------|-----------|
| `/fix-batch` | Step 3, after unit + integration tests, BEFORE reviewer agent | `gates.chrome_mcp_e2e` |
| `/build` (standard / full) | Step 3, after Playwright smoke, BEFORE Linear → "In Review" + operator FULL STOP | `gates.chrome_mcp_e2e` per story |
| `/build` (light) | Skipped — no worktree deploy. Operator reviews directly. | `gates.chrome_mcp_e2e: N/A — light scope` |
| `/bulk` | Step 3, after Playwright smoke, BEFORE batch push + PR creation | `gates.chrome_mcp_e2e` |

Related memory: [[feedback_chrome_mcp_e2e_before_review]], [[feedback_smoke_tests]], [[feedback_no_push_before_review]].
