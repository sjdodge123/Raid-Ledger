# ROK-1565 — handover (dev-1565, 2026-09-14)

Branch `chore/rok-1565-static-sentinel-scoped-e2e`, stacked on ROK-1566's branch.
**Not pushed, no PR.** Three commits on top of `84668cdf`:

- `50a08076` chore(fleet): a green `--static` gate writes the pre-push sentinel
- `<B>` chore(fleet): scope the fleet Playwright tier to the touched surfaces
- `<C>` chore(config): document the static-tier sentinel and scoped Playwright

## What is green

- `npx vitest run --root tools/mcp-rl-fleet` → **432 passed / 39 files**
- `npx tsc --noEmit -p tools/mcp-rl-fleet` → clean
- `node --test scripts/validate-ci-e2e-scope.spec.mjs` → 8/8
- `bash -n scripts/validate-ci.sh` → clean

Not run (no fleet/VM per the brief): `validate-ci.sh --static`, `npm run lint`.

## Cluster A — sentinel decision

- New `tools/mcp-rl-fleet/src/gate-summary.ts`: `summaryRows`, `playwrightRowStatus`,
  `staticGateGreen`. Rows are read from the LAST `========== Summary ==========`
  banner in the tail; the Playwright matcher is now
  `/^Playwright \(desktop \+ mobile[^)]*\)$/` so the scoped label still parses.
- `playwright-sentinel.ts`: new `resolveGateTier(status)` — `playwright` when the
  Playwright row PASSed (incl. the ROK-1533 "later tier failed the task" case),
  else `static` when `succeeded` + Build/TypeScript/Lint PASS + no `FAIL` row,
  else `null`. Sentinel body gains `tier`. Annotation gains
  `gate_verified` / `gate_sentinel` / `gate_tier`; `playwright_verified` /
  `playwright_sentinel` are kept as exact aliases.
- Specs: new `src/__tests__/static-gate-sentinel.spec.ts` (11). The existing
  `playwright-sentinel.spec.ts` `toEqual` shapes were EXTENDED (helpers
  `NOT_VERIFIED` / `verified()`), never weakened.

## Cluster B — scoped e2e

- `rl_validate_ci` gains `e2e_scope?: 'auto'|'all'|'none'` (schema in `index.ts`,
  param in `validate-ci.ts`), forwarded as `E2E_SCOPE=` by `resolveInnerEnv`
  (`validate-ci-target.ts`, new `E2eScope` type). It is emitted even without a
  `base_url`, and omitted entirely when the caller passes nothing.
- `scripts/validate-ci.sh`: `_resolve_e2e_scope`, `_scoped_playwright_specs`,
  `_prepare_playwright_scope` (new, above `run_playwright_e2e`) + globals
  `PLAYWRIGHT_STEP_LABEL` / `PLAYWRIGHT_SCOPED_SPECS`. `run_default_gate` calls
  `_prepare_playwright_scope` and passes `"$PLAYWRIGHT_STEP_LABEL"` to `run_step`
  (the label must be known BEFORE `run_step`, which is why the scope is resolved
  eagerly). `none` short-circuits to `skip_step`. Everything uncertain — `ALL`, a
  missing/failing `scope-specs.sh`, a non-`auto` scope — falls back to the FULL
  suite. `--fleet` needs no separate change: it runs through `run_default_gate`.
- Discord smoke untouched. `run_narrowed_gate`'s literal row name is untouched
  (that path only stamps SKIPPED).

### Two things the next agent must know

1. **`scripts/smoke/scope-specs.sh` did not exist on this branch.** It landed on
   `origin/main` in PR #1211 (`5b61ccef5`) AFTER this branch's base (`2886051f`).
   I pulled the file in verbatim with `git checkout origin/main -- scripts/smoke/scope-specs.sh`,
   so it is byte-identical to main and a later rebase/merge is a no-op on it.
2. **PR #1211 also edited `CLAUDE.md`** (the "Scope it by the pages you touched"
   paragraph, the 25-turn lane rules, the spike review tier) and this branch does
   NOT have those edits. My Cluster C edits are to the pre-#1211 text in the same
   "Smoke Test Verification" section — **expect a CLAUDE.md conflict on rebase
   onto current main.** Resolve by keeping BOTH: #1211's scoping paragraph and my
   static-sentinel paragraphs say complementary things (#1211 = how to scope a
   local run, mine = the tool flag + when the tier is needed at all).

## Cluster C — docs changed

- `CLAUDE.md` "Smoke Test Verification": the sentinel paragraph (static tier,
  `gate_*` fields) + a new "the tier is SCOPED" paragraph.
- `rl-infra/README.md`: `gate_verified` / `gate_sentinel` / `gate_tier` rows,
  `playwright_*` marked legacy aliases, plus the ROK-1565 static-tier + `e2e_scope`
  block above the field table.
- `.claude/skills/push/SKILL.md`: a fleet `--static` PASS is the default pre-push
  gate, web branches included.

## Old "Playwright PASS required" wording I did NOT touch

- `CLAUDE.md:400` — the paragraph's opening bold still reads **"A fleet Playwright
  PASS satisfies the pre-push gate (operator ruling 2026-09-12)"**. The body now
  says a `--static` PASS also does. Left as-is because rewriting the operator
  ruling's headline is an operator call; suggest
  "A fleet gate PASS (static or Playwright) satisfies the pre-push gate".
- `rl-infra/README.md:~785-790` — the lead-in prose ("...PASSed makes the MCP
  server write /tmp/.playwright-verified-<surfacehash>") is still Playwright-only.
  The corrective block sits immediately after it; the lead-in itself should be
  re-worded in a follow-up.
- `rl-infra/README.md:823` — `surface_error`'s description says "Playwright
  PASSed but the surface could not be resolved". The code message is now
  tier-neutral ("The gate passed but ..."); the table row lags.
- `.claude/skills/push/SKILL.md:209-225` — the Step-8 flow is still written around
  "Step 7 summary shows Playwright ... PASS" and hand-touching the sentinel after a
  LOCAL Playwright run. Still correct for a local run; it just no longer describes
  the only route to a green gate.
- `.claude/skills/dispatch/steps/task-dashboard.md:52` — "Playwright PASS → UX
  review" gate row, untouched (dispatch-flow wording, different concern).
- **Operator memory** `feedback_agents_push_after_fleet_playwright_pass.md` (not in
  the repo) still says the sentinel comes from a fleet *Playwright* PASS — needs an
  operator edit to add the static tier.

## Suggested next steps

1. Rebase onto current `origin/main` (expect the CLAUDE.md conflict above), then
   run `./scripts/validate-ci.sh --static` / `rl_validate_ci` for lint.
2. Consider a follow-up that reconciles the five stale wordings listed above.
