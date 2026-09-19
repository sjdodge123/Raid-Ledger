# ROK-1110 — Handover

Branch `tech-debt/rok-1110`. **The spec has NOT been executed.** See "What is unproven".

## Delivered

- `api/src/admin/demo-test-ai-suggestions.controller.ts` — `POST /admin/test/ai-suggestions/seed|clear`,
  DEMO_MODE + JWT + AdminGuard. Seeds a `lineup_ai_suggestions` row under the lineup's REAL voter-set
  hash (`resolveVoterScope`) so the read is a *fresh* hit and no pre-gen job is enqueued to race it.
  `clear` deletes ALL rows for the lineup, because the read path falls back to `findLatestForLineup`
  on a hash miss — clearing only the current hash would silently keep serving a sibling row as stale.
- `api/src/admin/demo-test.schemas.ts` — `SeedAiSuggestionsSchema` / `ClearAiSuggestionsSchema`,
  reusing the contract's `AiSuggestionSchema` so a fixture cannot drift from the DTO.
- `api/src/admin/admin.module.ts` — controller registered.
- `scripts/smoke/ai-suggestions-fixtures.ts` — `buildSuggestion` / `seedAiSuggestions` /
  `clearAiSuggestions` / `aiSurfaceAvailable`.
- `scripts/smoke/ai-suggestions.smoke.spec.ts` — 4 cases (chip on CG-present card + AI-only stub;
  reasoning on the ★ line with the removed chip tooltip pinned; minOwners parity for AI-only stubs;
  nominate-from-AI-card polled via the API).

## Key design finding — no LLM is needed

`AiSuggestionsService` is serve-stale-while-revalidate (ROK-1316). It only consults `LlmService` on
the **fully cold** path; a cache row short-circuits ahead of that check. So seeding the row gives a
byte-deterministic payload with **no provider configured, no network, no BullMQ job**. The story's
"stub an LLM provider" infrastructure ask is unnecessary — this is strictly less machinery.

## Deviation from the story text (deliberate)

ROK-1110 asks for "hover the chip → tooltip surfaces the reasoning". **That is stale.** ROK-1297
round 5z deliberately removed the chip's `title` on Common Ground cards (`AiBadge` in
`web/src/components/games/game-badges.tsx`, whose comment explicitly forbids re-adding a fallback —
ROK-1314 caught one) and moved the reasoning to the `★ {reasoning}` line under the tile. The spec
asserts the **as-built** surface and additionally pins "no tooltip on the chip" so a future
re-addition has to be deliberate.

## Concurrency design (desktop + mobile are separate workers on ONE API)

- Lineup created under `smoke-w{workerIndex}-ai-suggestions-` and reset by that prefix (ROK-1147).
- The suggestions row is keyed to **that lineup id** — the workers cannot read each other's fixture.
- The AI-only stub uses an invented game id `900_000 + workerIndex * 1_000`, so no two workers claim
  the same catalogue row, and no real game row is needed (the stub is synthesised from the DTO).
- Nothing global is mutated: no settings writes, no plugin toggling, no catalogue changes.
- `STUB_OWNERS = 6` clears the panel's **default `minOwners` of 2** — otherwise the stub would be
  filtered out before the first assertion ever ran. The filter case then raises the slider to 9.

## What is unproven — READ THIS BEFORE MERGING

**I did not run the spec, and I did not run the deliberate-failure proof.** Seven lanes are running
in parallel and ROK-1109 holds `raid-ledger-db` on :5432; the Playwright harness calls
`truncateAllTables`, so starting an env would have truncated another lane's database. I refused.
I started no env and truncated nothing (my only probes were `curl` against :3000 and :5173, both dead).

What IS verified, statically:
- `npx tsc --noEmit -p api/tsconfig.json` — **clean** (after `npm run build -w packages/contract`).
- `npm run lint -w api` — 0 errors (1406 pre-existing warnings, none in the new files).
- Every API contact point was read at the source and three of my own defects were found and fixed:
  1. `pollForCondition` takes `(check, { description })`, not a string, AND its documented contract
     forbids returning a bare boolean — a `false` polls to timeout and reports a generic timeout
     instead of the missing nomination. Now returns the entry object or `null`.
  2. `GET /lineups/common-ground` takes **no `lineupId`** (`CommonGroundQuerySchema`) — the param was
     being silently dropped. Removed.
  3. The lineup detail's nomination array is `entries`, not `nominations`.

### Static failure reasoning (what each case would fail on, and with what message)

- **chip case** — break it by deleting `{aiSuggested && <AiBadge />}` in `CommonGroundGameCard.tsx`.
  Fails at `expect(blendTile.first().getByText('✨ AI Pick')).toBeVisible()` with a locator-not-found
  on the chip text, NOT a page-load timeout, because `openLineup` has already asserted a
  `common-ground-tile` is visible. That ordering is what makes the failure name the right thing.
- **reasoning case** — break it by making `reasonText` always `tile.whyReason`. Fails on
  `getByText(STUB_REASON)`; the stub has no `whyReason` at all, so it degrades to no ★ line.
- **filter case** — break it by removing the `minOwners` branch from `aiStubMatchesFilters`. Fails on
  `toHaveCount(0)` for the stub tile, which is precisely the parity bug.
- **nominate case** — break it by dropping the mutation. Fails on `pollForCondition` with the
  description naming the lineup id and the expected game id.

### Residual risks a real run must settle (ranked)

1. `page.getByLabel('Min owners')` — the control is an `<input type="range">` inside a wrapping
   `<label>` with a `<span>Min owners</span>`. The accessible name should resolve, but this was not
   executed. If it misses, use `page.locator('label:has-text("Min owners") input[type=range]')`.
2. **`CommonGroundFilters` may only render in the Cycle-4 "search mode"** (`NominatingComposite.tsx`
   line ~277, inside the sticky `JourneyHero`). If the slider is not on screen by default, the filter
   case needs a step that opens search mode first. **This is the single most likely failure.**
3. `test.skip(condition, reason)` inside `beforeAll` to skip the whole group — standard Playwright,
   but unverified against this repo's `base.ts` fixture.
4. `aiSurfaceAvailable` reads `/system/status` → `activePlugins` and `/admin/ai/features` →
   `aiSuggestionsEnabled`. Both routes confirmed at the source; the field names are as the frontend
   consumes them, but the skip path itself is untested.

## Next step

Lead runs a fleet gate — **both projects**, `npx playwright test scripts/smoke/ai-suggestions.smoke.spec.ts`
(never `--project=desktop`). Then do the deliberate-failure pass against committed code using the
four breakages above before merging.
