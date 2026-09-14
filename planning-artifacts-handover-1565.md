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

## Review fixes (2026-09-14, after `planning-artifacts/review-ROK-1565.md` — SHIP WITH FIXES)

All 8 findings addressed on the same branch. Commits:
`chore(fleet): ROK-1565 — review fixes` + `chore(config): ROK-1565 — review-fix doc sweep`.

**BLOCKER 1 (scoped row parsed nowhere)** — fixed in all three places, consistently:
- `scripts/validate-ci.sh` `print_summary`: `printf "%-30s  %s\n"` (TWO spaces) on the
  header, the rule line and the row line. `%-30s` pads nothing for the 45-char scoped
  name, so the separator used to collapse to one space.
- `tools/mcp-rl-fleet/src/gate-summary.ts`: `ROW` is now `/^([A-Za-z][^\n]*?):?\s+(PASS|FAIL|SKIPPED)\b/`
  — `\s+` instead of `\s{2,}`, plus an optional trailing `:` so run_step's own
  `<Name>: PASS` echo yields the SAME row name as the summary row.
- `rl-infra/orchestrator/bin/_parser.sh`: `PATTERN_STEP_RESULT` name class widened to
  `[A-Za-z0-9 +(),:.-]`. Verified non-vacuous: the OLD class rejects
  `Playwright (desktop + mobile, scoped: 2 specs): PASS`.
- New case `test_pattern_scoped_playwright` (plain + ANSI) in
  `rl-infra/orchestrator/test/test_pattern_regex.sh`, registered in the run list.

**BLOCKER 2 (vacuous fixture)** — `static-gate-sentinel.spec.ts` now builds EVERY summary
fixture by extracting `print_summary` from `scripts/validate-ci.sh` and running it in bash
(`realSummary()`), so a printer/parser drift fails the spec. Statuses are the three real
ones (`record_result` never writes a reason into the row). Added an explicit printer↔parser
test asserting the real scoped row parses AND keeps a `\s{2,}` separator.

**MAJOR 3 (mixed output narrowed the run)** — `_scoped_playwright_specs` now escalates on
`printf '%s\n' "$out" | grep -qx ALL`, so a spec list with a trailing `ALL` runs the full
suite. Covered by a new `.mjs` case, plus the missing-script case (MINOR 5).

**MINOR 4** — `--with-e2e` beats `E2E_SCOPE=none`: the step warns and runs the full suite
instead of skipping. **MINOR 6 / NIT 8** — `CLAUDE.md` local-equivalent table row,
`build-batch/steps/step-3-validate.md` verification table, `push/SKILL.md:211`
(`gate_verified` / `gate_tier` + the scoped row), `rl-infra/README.md` `surface_error` row
(tier-neutral) and the "prefix is load-bearing" note (now names all three couplings).
**NIT 7** — `_resolve_e2e_scope` memoizes into `E2E_SCOPE_RESOLVED`; callers use
`_resolve_e2e_scope >/dev/null` then read the global, so the typo warning prints once
(pinned by a new `.mjs` case).

### Verification of the review fixes

- `npx vitest run --root tools/mcp-rl-fleet` → **433 passed / 39 files**
- `npx tsc --noEmit -p tools/mcp-rl-fleet` → clean
- `node --test scripts/validate-ci-e2e-scope.spec.mjs` → **11/11**
- `bash rl-infra/orchestrator/test/run-tests.sh` → **ALL TEST FILES PASSED** (it DOES run
  on the laptop — no VM/SSH needed); `test_pattern_regex.sh` alone → 38 pass / 0 fail
- `bash -n scripts/validate-ci.sh` → clean

### Left for the next agent

- **Pre-existing, NOT fixed:** two real step names still fail `PATTERN_STEP_RESULT` because
  the class has no `*` or `/` — `Shell parse check (scripts/*.sh)` and
  `Script node:test specs (scripts/*.spec.mjs)`. They have never appeared in `steps[]`;
  widening the class further was out of scope for this review pass. The summary-row parser
  (`gate-summary.ts`) reads them fine, so nothing in the sentinel depends on it.
- The CLAUDE.md rebase conflict with PR #1211 called out above still applies.

## Codex P2 fix (2026-09-14) — spec-only diffs stay scoped

`scripts/smoke/scope-specs.sh` printed the matched specs AND then `ALL` when the diff
contained nothing but `scripts/smoke/*.smoke.spec.ts`: the loop echoed each spec and
`continue`d without recording anything, so `tokens` ended empty and the post-loop
`[ -z "$tokens" ] && echo ALL` fired. Harmless until the MAJOR-3 fix taught
`validate-ci.sh` to escalate on a trailing `ALL` — which turned "I edited exactly the
specs I want to run" into a full-suite run.

Fix: `found` is initialised BEFORE the diff loop and set to 1 whenever a spec path is
echoed directly; the empty-tokens branch now prints `ALL` only when nothing was echoed.
Shared-surface `ALL` and unmappable-file `ALL` are untouched.

Verified by dry run (`SCOPE_FILES=…`, repo root):

| input | output |
|-------|--------|
| `scripts/smoke/lfg-group-page.smoke.spec.ts` | that spec only (was: spec **+ ALL**) |
| that spec + `web/src/pages/index.tsx` | spec + `ALL` (escalates, unchanged) |
| `web/src/pages/lfg/lfg-group-page.tsx` | the 3 lfg specs (unchanged) |
| `web/src/App.tsx` | `ALL` (unchanged) |
| `README.md` | `ALL` (unchanged) |

Two `.mjs` cases added that drive the REAL script (not the stub) through its
`SCOPE_FILES` hook. Non-vacuous: `git show origin/main:scripts/smoke/scope-specs.sh`
run on the same input still prints `spec` then `ALL`.

`node --test scripts/validate-ci-e2e-scope.spec.mjs` → **13/13**.

**Note for the rebase:** this branch's `scope-specs.sh` is no longer byte-identical to
`origin/main` — it now carries this fix on top of PR #1211's original. main has not
touched the file since, so a rebase is still clean, but do not "restore" it from main.

## Rebase onto origin/main (2026-09-14, after PR #1213 / ROK-1566 merged)

**Replay base corrected.** The brief said to rebase `--onto origin/main 03df84f4`, but
`03df84f4` is NOT this branch's fork point — `git log --oneline 03df84f4..HEAD` showed
1566's own review-fix commits (`2afd6e33`, `84668cdf`) sitting *below* my first commit, and
replaying those would have re-applied work that PR #1213 already squashed into main. The
true fork point is **`84668cdf`**, so the command run was:

```
git rebase --onto origin/main 84668cdf chore/rok-1565-static-sentinel-scoped-e2e
```

(`d31cb320` — the 1566 fix that landed after I branched — exists only in main's squash;
nothing of mine depends on it.) A `rok1565-prerebase-backup` tag marks the pre-rebase HEAD.

**Zero conflicts.** All 7 commits replayed clean; `git diff --check origin/main..HEAD` is
empty and no conflict marker exists in any changed file. Spot-checked the hotspots the
brief listed:

- `CLAUDE.md` — all three paragraphs coexist: #1211's "Scope it by the pages you touched",
  1566's `surface-hash.sh` paragraph, and my static-tier (`gate_tier: static`) + "the
  fleet/local Playwright tier is SCOPED" paragraphs.
- `tools/mcp-rl-fleet/src/playwright-sentinel.ts` — main's fail-closed unresolved-surface
  branch, `surface_hash` / `surface_error` and the JSON body are intact; my tier logic sits
  on top (the diff vs main is purely additive plus the parser extraction).
- `scripts/smoke/push-gate.sh`, `scripts/smoke/surface-hash.sh`, `.claude/settings.json`,
  `TECH-DEBT-BACKLOG.md` — **not touched by this branch at all** (empty diff vs main), so
  main's versions stand.
- `scripts/smoke/scope-specs.sh` — MY version (main still carries #1211's pre-fix copy);
  the two real-script `.mjs` cases would fail against main's.

**Defect surfaced by the rebase (fixed, commit `b7bac77a`).**
`scripts/validate-ci-e2e-scope.spec.mjs` was **untracked for four commits**: `.gitignore:31`
ignores `scripts/*` wholesale and every tracked script there has an explicit `!` negation.
It ran green locally and would simply not have existed in CI. Added the negation (with a
comment naming the trap) and `git add`-ed the file. Worth knowing for any future
`scripts/` addition — `git add -A` will not catch it and `git status` stays clean.

### Final state

```
b7bac77a chore(fleet): ROK-1565 — track the scoped-e2e node:test spec
03a689d4 chore(fleet): ROK-1565 — codex fix: spec-only diffs stay scoped
419dd198 chore(config): ROK-1565 — review-fix doc sweep
ccf94481 chore(fleet): ROK-1565 — review fixes
525229bf chore(fleet): ROK-1565 — handover notes
3f7fc723 chore(config): ROK-1565 — document the static-tier sentinel and scoped Playwright
1e7df520 chore(fleet): ROK-1565 — scope the fleet Playwright tier to the touched surfaces
826974d8 chore(fleet): ROK-1565 — a green --static gate writes the pre-push sentinel
```

| Suite | Result |
|-------|--------|
| `cd tools/mcp-rl-fleet && npx tsc --noEmit` | clean |
| `cd tools/mcp-rl-fleet && npx vitest run` | **463 passed** (41 files) |
| `node --test scripts/validate-ci-e2e-scope.spec.mjs scripts/surface-hash.spec.mjs scripts/push-gate.spec.mjs` | **30 pass / 0 fail** |
| `bash rl-infra/orchestrator/test/run-tests.sh` | **ALL TEST FILES PASSED** |
| `bash -n scripts/validate-ci.sh scripts/smoke/*.sh` | clean |

Not pushed.
