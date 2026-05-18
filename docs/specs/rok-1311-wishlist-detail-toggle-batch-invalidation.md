# Spec: ROK-1311 — Wishlist Toggle from Detail Page Invalidates Batch Cache

**Plan:** No `docs/plans/` plan exists. The authoritative source is the Linear story body (https://linear.app/roknua-projects/issue/ROK-1311). The story is a small, surgical, single-line cache-invalidation fix; the body already specifies the exact change in the Notes section. This spec formalises the change, its tests, and the acceptance trace so a dev agent can implement without re-deriving the diagnosis.
**Date:** 2026-05-17
**Status:** draft

## Overview

The wishlist (a.k.a. "want-to-play") feature on `/games/{id}` and `/games` is backed by two TanStack Query cache keys that hold the same logical data:

- **Per-game key** `['games', 'interest', gameId]` — read by the detail page button (`web/src/pages/game-detail-page.tsx`).
- **Batch key** `['games', 'interest', 'batch', sortedIds]` — read by every card-list (`/games` carousels, `HeartedGameCard` on profile pages) via the `WantToPlayProvider` context.

The card-list mutation hook (`useToggleInterestMutation` in `use-want-to-play-batch.tsx`) invalidates BOTH keys after a toggle, so its updates propagate symmetrically. The detail-page mutation hook (`useInterestToggleMutation` in `use-want-to-play.ts`) only invalidates the per-game key + `userHeartedGames`. **As a result, toggling wishlist from the detail page leaves every card-list stale until a hard refresh or a `staleTime` (5 min) expiry.**

The stale state is doubly dangerous: the card heart visibly disagrees with server state, AND clicking it fires the *opposite* mutation. The card's optimistic update flips from its stale belief — so a stale "filled heart" → click → optimistic un-fill → `DELETE` request, even though the user clearly meant to *add*. The detail-page wishlist toggle is now a footgun for the card UI it leaves behind.

The fix is one line: add `queryClient.invalidateQueries({ queryKey: ['games', 'interest', 'batch'] })` to `useInterestToggleMutation.onSettled`. TanStack Query's default `queryKey` match is prefix-based, so passing the 3-element prefix invalidates every batch query regardless of the `sortedIds` 4th element. This brings the two hooks back into symmetric behavior. No other surfaces change.

## Contract Layer (`packages/contract`)

No contract change required. `GameInterestResponseDto` already exposes the shape both hooks consume; the bug is purely client-side cache-invalidation. No `npm run build -w packages/contract` step needed.

## NestJS Module Spec (`api`)

No API change required.

The Linear story Out of Scope section explicitly excludes touching `/api/games/{id}/want-to-play` and `/api/games/interest/batch`. The endpoints behave correctly today — the server returns the right state after every toggle. Only the client-side cache invalidation is wrong.

### Migrations

None.

## React Component Spec (`web`)

### Files modified

| File | Change |
|------|--------|
| `web/src/hooks/use-want-to-play.ts` | Add a 3rd `invalidateQueries` call inside `useInterestToggleMutation.onSettled` (lines 75–78) to also invalidate the batch prefix `['games', 'interest', 'batch']`. |
| `web/src/hooks/use-want-to-play.test.ts` *(new)* | Unit test asserting `useInterestToggleMutation` invalidates all three keys (per-game, batch prefix, `userHeartedGames`) on successful toggle, and on rollback after `mutationFn` rejects. |

### Diff sketch

```ts
// web/src/hooks/use-want-to-play.ts — useInterestToggleMutation.onSettled
onSettled: () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['userHeartedGames'] });
    // ROK-1311: also invalidate the batch cache consumed by /games card lists.
    // Prefix match invalidates every ['games', 'interest', 'batch', sortedIds] entry.
    queryClient.invalidateQueries({ queryKey: ['games', 'interest', 'batch'] });
},
```

No other functions in `use-want-to-play.ts` change. The optimistic-update path (`onMutate`) and rollback (`onError`) stay as-is — they already cover the optimistic UX on the detail-page button itself.

### Files explicitly NOT touched

- `web/src/hooks/use-want-to-play-batch.tsx` — its `handleToggleSettled` already invalidates both keys (this is the reference implementation we are bringing the detail-page hook into parity with).
- `web/src/pages/game-detail-page.tsx`, `web/src/pages/games-page.tsx`, `web/src/components/games/unified-game-card.tsx`, `web/src/pages/user-profile-page.tsx` — consumer components are correct; they read the right keys. Only the invalidation list in the mutation hook is at fault.
- `web/src/dev/wireframes/**` — Linear Out of Scope; wireframes use stub data and are unaffected.
- `web/src/hooks/want-to-play-context.ts` — context shape unchanged.

### State management notes

- **Server state:** TanStack Query — three keys in play, all already used elsewhere. No new keys.
- **Client state:** none introduced.
- **Form state:** none.
- The `staleTime: 1000 * 60 * 5` on both queries is preserved — the bug is not staleness configuration, it's missing invalidation triggers.

## Behavior Specifications

### Scenario: Toggle ON from detail page, back-navigate to `/games` — card heart refreshes

- **Given** the user is on `/games/19837` (`Chained Together`, not currently wishlisted) and has just arrived from `/games` (so the batch query for the carousel is cached).
- **When** the user clicks "Want to Play" on the detail page (`POST /api/games/19837/want-to-play` 200) and presses the browser back button to return to `/games`.
- **Then** the `Chained Together` card heart renders FILLED with the count badge `1`, matching server state. The card is rendered from a freshly-refetched batch query (the previous batch query was invalidated by the detail-page mutation's `onSettled`).

### Scenario: Toggle OFF from detail page, back-navigate to `/games` — card heart un-fills

- **Given** the user is on `/games/19837` with `Chained Together` already wishlisted, and `/games` is in the navigation back stack with the cached batch query showing the filled card.
- **When** the user clicks "Remove from List" (`DELETE` 200) and presses browser back to return to `/games`.
- **Then** the `Chained Together` card heart renders EMPTY immediately on back-navigation (Step 5 of the Linear repro). The accessible name updates from "Remove from want to play" to "Add to want to play". **Repro Step 6 is no longer reachable** because the card never displays the pre-toggle stale state.

### Scenario: Card-list toggle still updates detail page (regression guard)

- **Given** the user is on `/games`, `Chained Together` not wishlisted.
- **When** the user clicks the card heart (uses `useToggleInterestMutation` in `use-want-to-play-batch.tsx`) and then navigates to `/games/19837`.
- **Then** the detail page button reads "Remove from List" (the existing batch-hook behavior continues unchanged — `handleToggleSettled` still invalidates the per-game key).

### Scenario: Concurrent batch queries with different `sortedIds` all refresh

- **Given** `/games` has two carousels each wrapped in their own `WantToPlayProvider` with different `gameIds` arrays (e.g. "Trending" and "Hearted by you"), producing two distinct batch keys `['games', 'interest', 'batch', [...A]]` and `['games', 'interest', 'batch', [...B]]`.
- **When** the user toggles wishlist for one game from `/games/{id}`.
- **Then** BOTH batch queries are invalidated (prefix match `['games', 'interest', 'batch']` catches every suffix). On next render, each carousel refetches and reflects the new state if the toggled game is in its `gameIds` array.

### Scenario: Optimistic UX on the detail page itself is unaffected

- **Given** the user is on `/games/19837` not wishlisted.
- **When** the user clicks "Want to Play".
- **Then** the button text flips immediately (optimistic via `onMutate` setting per-game cache), the `POST` resolves, and `onSettled` triggers three invalidations. The detail button does not flicker — `onSettled` invalidations don't reset the optimistic state the request has just confirmed. Existing UX is preserved.

### Scenario: Network error during toggle — rollback path preserves correct behavior

- **Given** the user is on `/games/19837`, network drops during the toggle.
- **When** `mutationFn` rejects.
- **Then** `onError` rolls back the per-game optimistic update (existing behavior). `onSettled` still fires AFTER `onError`, invalidating per-game, `userHeartedGames`, AND the batch prefix. The batch query refetches and reads the still-correct server state (server never saw a successful mutation). No stale card heart on subsequent `/games` visits.

## Error Handling Matrix

| Error Condition | Behavior |
|-----------------|----------|
| `POST/DELETE /api/games/{id}/want-to-play` returns non-2xx | Existing: `onError` rolls back per-game cache + shows `toast.error('Failed to update game interest')`. `onSettled` also fires and invalidates the batch prefix — but since the server state didn't change, the refetched batch query returns the pre-toggle value, which matches the rolled-back per-game state. No drift. |
| Batch refetch fails after invalidation (e.g. token expired) | TanStack Query keeps the previously cached value and re-runs on next mount. Worst case = the same stale state the bug currently produces, but only on a refetch failure (rare). No regression vs. today's behavior. |
| User toggles, then immediately navigates away before `onSettled` fires | TanStack Query still runs `onSettled` because the mutation lifecycle is independent of component unmount. Batch invalidation happens; next `/games` visit refetches fresh. |
| Multiple rapid toggles on the same game | Each settles in order; each invalidates the batch prefix. Last successful state wins. Same as today's per-game behavior, just extended to the batch key. |

## Testing

Per `TESTING.md` and the STRICT test-failure rules, the change ships with a unit test and a manual smoke. No API/integration test changes are needed because the server-side surface is untouched.

### Web unit (Vitest, NEW)

**New file:** `web/src/hooks/use-want-to-play.test.ts`

Pattern: copy the shape from `web/src/hooks/use-roster-invalidation.test.ts` (existing reference for "assert this mutation invalidates these query keys"). Key elements:

- `createTestHarness()` builds a `QueryClient` with `retry: false`, seeds the three relevant keys (`['games', 'interest', 19837]`, `['games', 'interest', 'batch', [19837]]`, `['userHeartedGames']`) with stub data, and spies on `queryClient.invalidateQueries`.
- Mock `global.fetch` to resolve `{ wantToPlay: true, count: 1 }` for the `POST` test and reject for the rollback test.
- Render `useWantToPlay(19837)` inside a `QueryClientProvider` wrapper. NOT wrapped in a `WantToPlayProvider`, so the hook falls through to the individual code path (`useWantToPlayIndividual`) — which is the buggy path under test. Verified via `web/src/hooks/use-want-to-play.ts:23` (`inBatch = ctx !== NO_PROVIDER`).
- Call `result.current.toggle(true)` inside `await act(...)`.

**Assertions** (all three must pass):

1. `invalidateSpy` was called with `{ queryKey: ['games', 'interest', 19837] }` (per-game key).
2. `invalidateSpy` was called with `{ queryKey: ['userHeartedGames'] }`.
3. `invalidateSpy` was called with `{ queryKey: ['games', 'interest', 'batch'] }` — **the new behavior**. Use `JSON.stringify` matching as in `use-roster-invalidation.test.ts:73–78` to compare the queryKey arrays.

**Rollback test:** mock `fetch` to reject, call `toggle(true)`. Assert all three invalidations still happen (because `onSettled` runs regardless of mutation outcome), and assert the per-game cache was rolled back to the seeded `previous` value via `queryClient.getQueryData([...])`.

### Manual smoke (Chrome MCP, MANDATORY per CLAUDE.md "Chrome MCP e2e before code review/ship")

Run the 6-step Linear repro end-to-end against `http://localhost:5173` after `./scripts/deploy_dev.sh --ci --rebuild`. **The new acceptance** is that Step 5 (back-navigate to `/games`) shows the empty heart on `Chained Together` immediately — no hard refresh, no 5-min wait. Step 6 (stale-state opposite-mutation hazard) is now unreachable because Step 5's precondition (stale filled heart) is gone.

Companion bot / Discord / smoke tests do NOT apply — purely client-side cache fix.

### Playwright smoke (OPTIONAL, recommended)

If time permits, extend (or add) a Playwright test that:

1. Visits `/games`, asserts a chosen card's heart is empty.
2. Clicks into the card → `/games/{id}` → clicks "Want to Play".
3. `page.goBack()`.
4. Asserts the card's heart on `/games` is now filled WITHOUT a manual reload (`waitFor` an assertion on the badge text, not a fixed sleep).

Run with BOTH projects (`npx playwright test`, not `--project=desktop`) per the STRICT smoke-test rule. If this test surfaces other stale-data flakes unrelated to this story, document them in `TECH-DEBT-BACKLOG.md` per the pre-existing-failures rule and proceed.

### Local CI

Run `./scripts/validate-ci.sh --full` before pushing. Specifically required to surface:

- `web` Vitest with coverage (`npx vitest run --coverage` from `web/`) — catches missing coverage on `use-want-to-play.ts` if the new test doesn't import the right export.
- `web` lint (`npm run lint -w web`) — catches accidental file-size or function-size regressions (file is 109 lines today; adding 3–5 lines stays well under the 300-line cap).

## Dependencies

- **Contract:** none.
- **API internal:** none.
- **Web internal:**
  - `web/src/hooks/use-want-to-play.ts` — fix site.
  - `web/src/hooks/use-want-to-play-batch.tsx` — reference implementation (read-only; unchanged).
  - `web/src/hooks/want-to-play-context.ts` — unchanged.
  - Consumers (`game-detail-page.tsx`, `games-page.tsx`, `unified-game-card.tsx`, `user-profile-page.tsx`) — unchanged.
- **External:** TanStack Query — relies on default prefix-match behavior for `invalidateQueries({ queryKey })`. This is library-default and stable across v4/v5; no version bump required.

## Out of Scope (explicitly deferred)

- **Refactor to a single normalized cache.** The dual-key design (per-game + batch) is a smell, but consolidating it touches every card-list consumer and `WantToPlayProvider`. File separately if the dual-key shape keeps causing drift. Capture as `tech-debt:` in `TECH-DEBT-BACKLOG.md` if not already there.
- **Two near-duplicate mutation hooks** (`useInterestToggleMutation` in `use-want-to-play.ts` vs. `useToggleInterestMutation` in `use-want-to-play-batch.tsx`). Same toggle behavior, slightly different invocation shapes. Worth merging in a follow-up; leave alone in this fix to keep the diff minimal and reviewable.
- **Changes to API endpoints.** Explicitly excluded by the Linear story.
- **Wireframe routes under `web/src/dev/wireframes/**`.** Stub data; no real cache.
- **`userHeartedGames` cache key behavior.** Already correctly invalidated by both hooks; not touching.

## Acceptance Criteria Trace

| ROK-1311 AC | Spec section | Validation |
|-------------|--------------|------------|
| Toggling wishlist from `/games/{id}` invalidates the batch query key so any subsequent visit to `/games` renders the correct heart state without a hard refresh. | React Component Spec → Diff sketch; Scenarios 1, 2 | Vitest assertion that `invalidateSpy` was called with `['games', 'interest', 'batch']`; Chrome MCP repro Step 5. |
| Toggling wishlist from `/games` card continues to update the detail page (existing behavior preserved). | Behavior Spec → Scenario 3 (regression guard) | No code change to `use-want-to-play-batch.tsx`; existing unit/integration coverage of that hook continues to pass; Chrome MCP card → detail navigation. |
| The "stale state fires opposite mutation" secondary hazard no longer occurs in either direction. | Behavior Spec → Scenario 2 final sentence | Chrome MCP repro confirms Step 6 unreachable because Step 5 no longer leaves the card stale. |
| Unit test (Vitest, `web/`) covering `useInterestToggleMutation.onSettled`: assert the batch key is among the invalidated keys. | Testing → Web unit | `web/src/hooks/use-want-to-play.test.ts` new file; assertion #3. |
| Manual smoke: repeat the 6-step repro end-to-end against `localhost:5173` after the fix and confirm Step 5 shows the empty heart immediately on back-navigation. | Testing → Manual smoke (Chrome MCP) | Operator/dev-agent runs Chrome MCP flow before review per `feedback_chrome_mcp_e2e_before_review.md`. |
