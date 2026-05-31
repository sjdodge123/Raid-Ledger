---
name: push
description: "Pre-push checklist: full local CI, sync with main, push, and create PR"
argument-hint: "[--skip-pr]"
---

# Push — Full Local CI + Push + PR

**Goal:** Run the FULL CI pipeline locally, sync with main, push, and create/update PR. Nothing reaches origin without passing every check first.

**This skill should be used by ALL other skills (/build, /bulk, /fix-batch) when pushing to origin.** Never use raw `git push` — always invoke `/push`.

**References:** Read `CLAUDE.md` for project conventions and `TESTING.md` for test failure rules before proceeding. Test failures are NEVER dismissed as "pre-existing."

Execute every step in order. If any step fails, STOP and fix before continuing.

---

## Step 1: Verify Branch

```bash
BRANCH=$(git branch --show-current)
echo "Branch: $BRANCH"
```

**STOP** if on `main`. Never push directly to main.

---

## Step 1.5: Scope Detection — Determine Which Checks to Run

Analyze the diff against main to decide which CI steps are relevant:

```bash
git diff --name-only origin/main
```

Evaluate the changed files and classify the changeset:

| Files Changed | Checks Needed |
|---------------|---------------|
| **Only** `.claude/`, `CLAUDE.md`, `.mcp.json`, `.md` files, `docs/` | **None** — skip to Step 9 (push). Still run Step 2a to make sure operator config is staged. |
| **Only** `web/src/` (no api, no contract) | Web only: build contract + web, typecheck web, lint web, test web, Playwright |
| **Only** `api/src/` (no web, no contract) | API only: build contract + api, typecheck api, lint api, test api |
| **Only** `packages/contract/` | Contract + both: build all, typecheck all, lint all, test all |
| **Only** test files (`*.spec.ts`, `*.test.tsx`) | Tests only: run tests for affected workspace(s), skip build/lint |
| **Only** config/tooling (`.eslintrc`, `tsconfig`, `package.json`, CI workflows) | Full CI — config changes can break anything |
| `api/src/drizzle/migrations/**` | Full CI + migration validation (`validate-migrations.sh`) |
| `Dockerfile*`, `docker-entrypoint*`, `nginx/` | Full CI + container startup validation |
| **Mixed** (api + web, or contract + anything) | Full CI |

**Present your assessment** before running checks:

```
## Scope Assessment
Changed files: 3
- api/src/events/signups.service.ts
- api/src/events/signups.service.spec.ts
- web/src/pages/event-detail/EventDetailRoster.tsx

Classification: Mixed (api + web)
Checks to run: Full CI (build all, typecheck all, lint all, test all, Playwright)
```

**Rules:**
- When in doubt, run MORE checks, not fewer
- Contract changes always trigger full CI
- If a `.spec.ts` file changed, always run that workspace's tests even if only tests changed
- Never skip checks for files you're unsure about

---

## Step 2: Check for Uncommitted Changes

```bash
git status --short
```

- If there are unstaged changes that should be included → stage and commit them
- If there are untracked files that should be included → add and commit them
- If changes are intentionally uncommitted → proceed (they won't be pushed)

### Step 2a: Operator config files MUST ride along (STRICT)

Before continuing, explicitly check for **operator-authored config** that must never be left behind:

```bash
git status --short -- .claude/skills .claude/agents .claude/settings.json .claude/settings.local.json CLAUDE.md .mcp.json 2>/dev/null
```

If anything appears (modified, staged, or untracked):

1. Stage all of it: `git add .claude/skills .claude/agents .claude/settings.json .claude/settings.local.json CLAUDE.md .mcp.json` (only paths that exist)
2. Commit with a `chore(config): ...` prefix — do NOT tag the active story ID, these are independent operator config updates riding along.
3. Example: `git commit -m "chore(config): update /opt skill, deploy etiquette memory, MCP fix story refs"`

This rule is in CLAUDE.md ("Operator Config Files"). The reason: parallel agents would otherwise assume these aren't theirs, cherry-pick around them, and leave them behind.

---

## Step 3: Sync with Latest Main

```bash
git fetch origin main && git rebase origin/main
```

**If there are rebase conflicts:**
1. Resolve them
2. `git rebase --continue`
3. **Re-run ALL checks** (steps 4-8) after resolving — the rebase may have introduced issues

---

## Steps 4–7: CI Checks (unified via validate-ci.sh)

If Step 1.5 determined "docs-only" → skip steps 4–8, jump to Step 9.

### Steps 4–7: Build, Typecheck, Lint, Tests, Migration & Container Validation

#### Pick the gate tier first (STRICT — default is the lite `--static` gate)

GitHub CI runs the full suite (build, tsc, lint, unit, integration sharded 3×3 + randomized, Playwright 5-shard desktop+mobile, Discord smoke) on **every** PR, and auto-merge-squash blocks the merge until it's green. GitHub *is* the real gate. The local run exists only to catch the cheap, deterministic failures that would otherwise waste a whole GitHub cycle and leave a red PR to babysit.

So for **most stories**, run the **lite gate** — `--static`: build + typecheck + lint, plus the conditional migration/container checks (which auto-skip when no migration/infra files changed). It defers unit/integration/Playwright/Discord smoke to GitHub. ~3–4 min vs ~20+ for `--full`.

Use `--static` by default. Escalate to `--full` only when:
- The diff touches **`drizzle/migrations/**`** or **container/infra** (`Dockerfile*`, `nginx/**`, `docker-entrypoint*`) — note `--static` already runs the migration + allinone validation for these; `--full` additionally adds local unit/integration/e2e, worth it for these high-blast-radius changes.
- The diff touches **`package.json` / `package-lock.json`** (any workspace, or root). GitHub's path filter classifies dependency files as `code` (lint runs) but NOT `api`/`web`, so GitHub **skips both unit and integration suites** for a deps-only change — `--static` would defer behavioral coverage to a job that never runs, and auto-merge could land a dependency regression untested. `--full` runs unit + integration locally to close that gap.
- It's a **large/cross-workspace refactor** where you'd rather not discover a behavioral break on GitHub after the fact.
- The operator explicitly asks for a full local run.

```bash
# Auto-detect the deps/migration/infra/contract risk signals against origin/main.
CHANGED="$(git diff --name-only origin/main...HEAD)"
if echo "$CHANGED" | grep -qE '(^|/)package(-lock)?\.json$|drizzle/migrations/|Dockerfile|nginx/|docker-entrypoint|^packages/contract/'; then
  GATE_DEFAULT="--full"
else
  GATE_DEFAULT="--static"
fi
# An explicit GATE env always wins (operator forces --full, or --static on a
# large refactor they accept). Otherwise use the auto-detected tier.
GATE="${GATE:-$GATE_DEFAULT}"
TIER="${GATE#--}"   # "static" | "full"
```

#### Cache check — skip if validate-ci passed in the last 5 min on this commit AT THIS TIER OR HIGHER

```bash
HEAD_SHA=$(git rev-parse HEAD)
MARKER="/tmp/.validate-ci-pass-${HEAD_SHA}-${TIER}"        # tier-specific marker we'll write on success
FULL_MARKER="/tmp/.validate-ci-pass-${HEAD_SHA}-full"      # a --full pass is a superset of --static

_fresh() { [ -f "$1" ] && [ $(( $(date +%s) - $(stat -f %m "$1" 2>/dev/null || stat -c %Y "$1") )) -lt 300 ]; }

# A --full pass satisfies BOTH a later --full and --static request (it's a superset).
# A --static pass satisfies ONLY a later --static request — it must NOT short-circuit
# a --full request, or unit/integration/e2e would never run. (Codex P2 fix.)
if _fresh "$FULL_MARKER" || { [ "$TIER" = "static" ] && _fresh "$MARKER"; }; then
  echo "✓ validate-ci.sh (≥${TIER}) passed <5min ago for HEAD=${HEAD_SHA:0:7}; skipping re-run"
  SKIP_VALIDATE_CI=1
else
  SKIP_VALIDATE_CI=0
fi
```

The marker is invalidated automatically by HEAD changing — any new commit produces a different SHA and forces a re-run. Skip is time-based AND tier-aware: a prior `--static` pass never satisfies a `--full` request.

#### Run validate-ci on the FLEET (or skip)

**STRICT — fleet by default.** The whole purpose of the rl-infra fleet is to offload CI runs from the operator's laptop. Local CI pins CPU + memory for minutes and blocks the operator from doing anything else. Run validate-ci on the fleet runner instead:

```bash
if [ "$SKIP_VALIDATE_CI" = "0" ]; then
  # Fleet path — runs in the runner container on the rl-infra VM,
  # zero CPU/memory pressure on the laptop.
  if [ -x "./rl-infra/cli/rl" ] && ssh -o BatchMode=yes -o ConnectTimeout=3 \
       "${RL_PROXMOX_HOST:-rl-infra}" 'true' 2>/dev/null; then
    RL_TARGET=remote ./rl-infra/cli/rl validate-ci "$GATE" \
      > /tmp/vci-$(git rev-parse --short HEAD).log 2>&1 \
      && touch "$MARKER"
  else
    # Fallback: fleet unreachable (laptop offline, slot full, infra down).
    # Run locally so the push isn't blocked. Note in Step 12 report.
    echo "[push] fleet unreachable — falling back to local validate-ci.sh"
    ./scripts/validate-ci.sh "$GATE" && touch "$MARKER"
  fi
fi
```

**STOP** and fix any failures before continuing. **NEVER dismiss failures as "pre-existing"** — investigate and fix them, or create a Linear story with root cause. On failure, do NOT touch the marker.

The script auto-detects scope (migration files, Dockerfile changes) and runs the appropriate conditional checks. You do NOT need to manually decide which checks to run — the script handles it. The fleet path uses the same `validate-ci.sh` invocation, just inside the runner. With `--static`, unit/integration/e2e are deferred to GitHub by design — that is not a skipped check to "fix," it's the lite gate working as intended.

**Fleet-only quirks to be aware of (ROK-1331 follow-ups):**
- The web vitest step may trip on `/workspace/web/coverage/.tmp` getting deleted mid-run (Mutagen-vs-vitest race). Doesn't reproduce locally. If you hit it on a backend-only diff, the fleet api result is still authoritative.
- inotifywait + inotify-tools must be installed on the VM (one-time `apt-get`); script fails loudly if missing.
- `rl-infra.lan` DNS doesn't resolve from every agent context; the CLI honors `RL_PROXMOX_HOST=192.168.0.132` override.

---

### Step 8: E2E Verification (diff-gated, env-gated)

**Lite gate (`--static`, the default):** Playwright + Discord smoke are NOT run locally — they're deferred to GitHub CI, which runs them sharded on every PR. For most stories you skip this step entirely and let GitHub cover behavioral/e2e. This is the intended behavior, not a gap.

**When you DID run `--full` (Step 7):** it auto-runs Playwright + Discord smoke when the diff touches their surface AND the dev env is up (`:3000/health` + `:5173`). What you do then depends on what Step 7 produced:

1. **Step 7 summary shows `Playwright (desktop + mobile): PASS`** — e2e is already covered. Touch the sentinel and continue:
   ```bash
   touch "/tmp/.playwright-verified-$(git rev-parse --short HEAD)"
   ```

2. **Step 7 summary shows `Playwright: SKIPPED — No Playwright-relevant files changed`** — the diff is backend-only. Just continue.

3. **Step 7 summary shows `Playwright: SKIPPED — Dev env not responding`** — the script couldn't reach `:3000/health` or `:5173`. Decide:
   - **If `web/src/` files changed:** bring the env up and re-run e2e:
     ```bash
     ./scripts/deploy_dev.sh --ci         # acquire env lock first if needed
     ./scripts/validate-ci.sh --only-e2e --with-e2e
     touch "/tmp/.playwright-verified-$(git rev-parse --short HEAD)"
     ```
   - **If branch is API-only:** continue without the sentinel.

The same logic applies to the `Discord smoke` row — if it FAILED, fix; if SKIPPED-no-relevant, continue; if SKIPPED-env-down on a bot/notification branch, deploy and re-run.

**Optional local e2e on the lite gate:** if you *want* to drive a risky UI flow locally before pushing even though you're on `--static`, you can still run `./scripts/validate-ci.sh --only-e2e` against a deployed env on demand. It's no longer mandatory — GitHub is the gate.

**Failure handling — never circumvent:**
- "Strict mode" = your new DOM elements collided with selectors in OTHER test files
- New components on shared pages (Games, Events, Layout) affect tests in other files — run the FULL suite (default — do NOT add `--project=desktop`)
- Fix the code or the test
- **NEVER skip and proceed**
- **NEVER re-push and re-run CI hoping it passes** — fix locally first

---

## Step 8.5: Codex Pre-Push Review (second opinion)

**Skip if:** scope is `docs-only` (from Step 1.5), OR `--no-codex` flag was passed, OR no `codex` CLI on PATH.

Run Codex as a second-opinion reviewer against `main`. Different model = catches issues Claude's reviewer misses (and vice versa). Synchronous because we want blockers BEFORE push.

```bash
which codex >/dev/null 2>&1 && [ -z "$NO_CODEX" ] && [ "$SCOPE" != "docs-only" ] && {
  echo "Running Codex pre-push review (this takes ~30-90s)..."
  codex review --base main "Pre-push sanity review. Flag CRITICAL bugs only — security, correctness, regressions, contract violations. Skip style nits, naming, doc gaps. Output format: BLOCKERS list (or 'No blockers') + 1-line rationale per finding." 2>&1 | tee /tmp/codex-review-$(git rev-parse --short HEAD).txt
}
```

**Verdict handling:**

- Output starts with "No blockers" or equivalent → proceed to Step 9.
- Output lists BLOCKERS → **STOP**, present them to the operator with the question: "Codex flagged N blockers — fix before pushing, or override and continue?" Wait for operator decision.
- Codex CLI errors out (network, auth) → log and proceed (don't block push on tooling failure). Note in Step 12 report.

The custom prompt is critical: without it Codex returns broad style feedback that adds noise. Keeping it scoped to "critical only" makes the second opinion actionable.

---

## Step 9: Push

```bash
git push -u origin $(git branch --show-current)
```

If the push is rejected (remote has newer commits), pull and rebase:
```bash
git pull --rebase origin $(git branch --show-current)
git push origin $(git branch --show-current)
```

---

## Step 10: Create or Update PR

**Skip this step** if `--skip-pr` was passed as an argument.

Check if a PR already exists:

```bash
gh pr list --head $(git branch --show-current) --json number,url
```

### If no PR exists — create one:

```bash
gh pr create \
  --base main \
  --head $(git branch --show-current) \
  --title "ROK-<num>: <short description>" \
  --body "$(cat <<'PREOF'
## Summary
<1-3 bullet points>

## Linear
ROK-<num>

## Test plan
<!-- Fill from the ACTUAL gate you ran ($GATE). Do NOT check off what you didn't run. -->
<!-- Lite gate (--static): only build/tsc/lint ran locally; behavioral coverage is GitHub's job. -->
- [x] `validate-ci.sh <GATE>` passes locally (build, typecheck, lint)
- [ ] Unit + integration: run via `--full` locally, else **deferred to GitHub CI** (check the box only if `--full` was run)
- [x] Migration validation passes (if applicable)
- [x] Container startup passes (if applicable)
- [ ] Playwright smoke: run via `--full` locally, else **deferred to GitHub CI**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PREOF
)"
```

**Title format:** `ROK-<num>: <description>` — matches our Linear story convention.

### If a PR already exists:

The push in Step 9 updated it. No action needed unless the PR description needs updating.

---

## Step 11: Enable Auto-Merge

**Always enable auto-merge (squash) after creating or pushing to a PR** — this is a project convention from CLAUDE.md.

```bash
gh pr merge $(git branch --show-current) --auto --squash
```

This is safe to run whether the PR was just created or already existed — it's a no-op if already enabled.

---

## Step 12: Report

Print a summary showing which checks ran and which were skipped (with reason):

```
## Push Complete

| Check | Result | Reason |
|-------|--------|--------|
| Scope | docs-only / api-only / web-only / full | <file count> files changed |
| Build | ✓ / skipped | <reason if skipped> |
| TypeScript | ✓ / skipped | <reason if skipped> |
| Lint | ✓ / skipped | <reason if skipped> |
| Tests (api) | ✓ <count> passed / skipped | <reason if skipped> |
| Tests (web) | ✓ <count> passed / skipped | <reason if skipped> |
| Integration tests (api) | ✓ <count> passed / skipped | <reason if skipped> |
| Coverage (api) | ✓ N% / skipped | <reason if skipped> |
| Coverage (web) | ✓ N% / skipped | <reason if skipped> |
| Migration validation | ✓ / skipped | no migration files changed |
| Container startup | ✓ / skipped | no Dockerfile changes |
| Playwright | ✓ / skipped | <reason if skipped> |
| Push | ✓ origin/<branch> | |
| PR | #<number> / existing / skipped | |
```
