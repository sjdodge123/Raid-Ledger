# Spec: ROK-1297 — S1 Nominating page composite + Common Ground multi-row hero

**Plan / Design doc:** `planning-artifacts/specs/cycle-4-unify-lineup.md` (canonical), also tracked at `web/src/dev/simplify-wireframes/README.md`
**Linear:** [ROK-1297](https://linear.app/roknua-projects/issue/ROK-1297)
**Wireframe (DEMO_MODE):** `http://localhost:5173/dev/wireframes/simplify#s1`
**Date:** 2026-05-16
**Status:** draft

## Overview

S1 rebuilds the Nominating phase of `LineupDetailPage` as a single composite that imports the Cycle 4 foundation components (U1 JourneyHero, U2 GameResearchDrawer, U4 SubmitBar) instead of the current header + inline Nominate button + `CommonGroundPanel` carousel. The Common Ground section graduates from a single horizontal carousel to **three themed rows × four tiles** (12 featured suggestions total) — "Owned by your group", "Matches your taste", "Trending or on sale" — each tile carrying a `★ why` annotation that surfaces the score signal that put it there. Plain free-text search is demoted to a 5-up secondary row below.

The composite collapses the page's chrome from **5 chrome rows + 3 separate Nominate CTAs** down to **1 JourneyHero + 1 per-tile Nominate CTA** (per-tile only — banner-level and header-level Nominates are removed per the Cycle 4 STRICT rule). It depends on ROK-1294 (U1+U3), ROK-1295 (U2), and ROK-1296 (U4) shipping first.

## Contract Layer (`packages/contract`)

S1 is **mostly a presentational refactor** of an existing API surface. The Common Ground response schema (`CommonGroundResponseSchema` in `packages/contract/src/lineup.schema.ts`) already carries every signal needed to assemble the three themed rows on the client — `ownerCount`, `scoreBreakdown` (`tasteScore`, `socialScore`, `intensityScore`, `baseScore`), `itadCurrentCut`, `wishlistCount`, `earlyAccess`, `itadTags`. No new server fields are required for Wave 2.

**One additive change** (small, backward-compatible) — expose the themed-row classification to clients so the same tile sort is reproducible across renders and reviewers can read the "why" string deterministically:

```ts
// packages/contract/src/lineup.schema.ts (extend CommonGroundGameSchema)
export const CommonGroundThemeSchema = z.enum(['owned', 'taste', 'trending']);
export type CommonGroundTheme = z.infer<typeof CommonGroundThemeSchema>;

export const CommonGroundGameSchema = z.object({
  // ...all existing fields...
  /**
   * S1 (ROK-1297) — which themed row this tile belongs in on the
   * Nominating composite. Optional for backward compatibility; absent
   * on legacy clients (panel still renders as a single carousel).
   */
  theme: CommonGroundThemeSchema.optional(),
  /**
   * S1 (ROK-1297) — short human-readable rationale for why this tile
   * was surfaced ("12 of you own this", "Matches your sci-fi/co-op cluster",
   * "Trending in your guild"). Optional. Server computes once; client never
   * concocts its own.
   */
  whyReason: z.string().max(80).optional(),
});
```

`theme` is derived from the highest contributing factor in `scoreBreakdown` (max of `socialScore` → `owned`, `tasteScore` → `taste`, `baseScore`+sale signals → `trending`). `whyReason` is a templated string the server fills (see "Why-reason templates" below). Both are optional so the V1 client can fall back gracefully if the server is one deploy behind.

## NestJS Module Spec (`api`)

### Module Structure

S1 lives in the existing `LineupsModule`. No new files required for routing/controller — the additive Common Ground enrichment lives in the helpers next to the existing scoring code.

- **Controller:** `LineupsController.getCommonGround` (existing) — unchanged signature, response schema gains two optional fields.
- **Service:** `LineupsService.getCommonGround` (existing) — unchanged, delegates to helpers.
- **New helper:** `api/src/lineups/common-ground-theme.helpers.ts` (~80 lines) — pure functions:
  - `classifyTheme(breakdown: CommonGroundScoreBreakdownDto): CommonGroundTheme`
  - `buildWhyReason(game: CommonGroundGameDto, theme: CommonGroundTheme, context: ParticipantContext): string`
- **Wiring:** `common-ground-query.helpers.ts::buildCommonGroundResponse` (existing) calls `classifyTheme` + `buildWhyReason` once per game in the final mapping pass.

### API Endpoints

#### `GET /api/lineups/common-ground`

- **Description:** Returns scored, ranked games for the active building lineup. S1 adds `theme` + `whyReason` per game; response shape otherwise unchanged.
- **Auth:** `JwtAuthGuard` (existing).
- **Query params:** `CommonGroundQuerySchema` (existing) — `ownerMin`, `tags`, `playerCount`, `lineupId`, etc.
- **Response:** `CommonGroundResponseDto` — array of `CommonGroundGameDto` (now with optional `theme` + `whyReason`) + meta.
- **Errors:** unchanged — `400` validation, `401` unauth, `404` no active lineup.

### Drizzle Schema

No migration required. S1 is read-only over existing tables (`games`, `user_games`, `lineups`, `lineup_entries`, `user_taste_vectors`).

### Why-reason templates

Server-side templated strings (`api/src/lineups/common-ground-theme.helpers.ts`):

| Theme | Template | Example |
|---|---|---|
| `owned` | `{ownerCount} of you own this` | "12 of you own this" |
| `owned` (sale modifier) | `{ownerCount} own · {cut}% off` | "9 of you own · 60% off" |
| `owned` (free modifier) | `{ownerCount} own · Free` | "18 own · Free" |
| `taste` | `Matches your {topGenres} cluster` (top 2 genres from taste vector intersection) | "Matches your sci-fi/co-op cluster" |
| `trending` | `Trending in your guild` (wishlist signal) | "Trending in your guild · new" |
| `trending` (sale) | `On sale {cut}% off · {ownerCount} own` | "On sale 70% off · 14 own" |
| `trending` (wishlist) | `Wishlisted by {wishlistCount} · launches soon` | "Wishlisted by 6 · launches soon" |

Whichever modifier produces the strongest signal wins (sale > free > base). Templates capped at 80 chars (Zod-enforced).

## React Component Spec (`web`)

### Component Hierarchy

    LineupDetailPage (existing)
    └── LineupDetailBody (existing) — phase switch
        └── (when status === 'building') NominatingComposite [NEW]
            ├── JourneyHero (U1 — from ROK-1294)
            ├── NominatingTabs [NEW]                # All (n) / Yours (n) / Trending
            ├── ExistingNominationsList [NEW]       # game refs with U2 drawer trigger
            ├── CommonGroundHero [NEW]              # 3 themed rows × 4 tiles
            │   ├── CommonGroundHeader [NEW]        # ✨ title + ↻ Regenerate + Why these?
            │   ├── CommonGroundThemedRow [NEW] ×3  # Owned / Taste / Trending
            │   │   └── CommonGroundHeroTile [NEW]  # cover 3:2 + ★ why + + Nominate
            │   └── WhyTheseModal [NEW]             # scoring explanation
            ├── GameSearchFallbackRow [NEW]         # 5-up smaller tiles
            └── SubmitBar (U4 — from ROK-1296)      # kind=empty | pre | post

### State Management

- **Server state (existing hooks, reused):**
  - `useCommonGround(lineupId, filters)` from `useCommonGroundState` — already powers `CommonGroundPanel`. S1 reuses unchanged; new code reads `tile.theme` + `tile.whyReason` directly off the response.
  - `useLineupDetail(lineupId)` — provides `lineup.entries` for the "Existing nominations" list and `myVotes`/`nominatedCount` for tab counts.
  - `useNominate(lineupId)` — existing mutation, wired to the per-tile `+ Nominate` CTA.
  - `useSubmitNominations(lineupId)` — NEW mutation from ROK-1296 wired to U4 SubmitBar's submit click.
- **Client state:** local `useState` for `activeTab` (`'all' | 'yours' | 'trending'`) and `whyThisOpen` (modal toggle). No Zustand — these are single-page concerns.
- **Form state:** none — the existing `useSteamPasteDetection` + `NominateModal` already handle freeform paste. S1 keeps `NominateModal` for the search fallback path.

### Component contracts

```ts
// web/src/components/lineups/cycle-4/NominatingComposite.tsx (top-level)
interface NominatingCompositeProps {
  lineup: LineupDetailResponseDto;
  canParticipate: boolean;
}

// web/src/components/lineups/cycle-4/CommonGroundHero.tsx
interface CommonGroundHeroProps {
  lineupId: number;
  canParticipate: boolean;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;   // U2 trigger
}

// web/src/components/lineups/cycle-4/CommonGroundHeroTile.tsx
interface CommonGroundHeroTileProps {
  game: CommonGroundGameDto;            // includes theme + whyReason
  disabled: boolean;                    // atCap || !canParticipate || isNominating
  onNominate: () => void;
  onOpenDrawer: () => void;
}

// web/src/components/lineups/cycle-4/NominatingTabs.tsx
interface NominatingTabsProps {
  activeTab: 'all' | 'yours' | 'trending';
  onChange: (tab: 'all' | 'yours' | 'trending') => void;
  counts: { all: number; yours: number };
}
```

### UI Components

- Tailwind + existing project tokens (`bg-overlay/40`, `border-emerald-500/20`, `text-emerald-300`). No new shadcn primitives required.
- `CommonGroundHeroTile` uses `aspect-[3/2]` for the cover (Cycle 4 cover ratio — wider than the 3:4 used by today's carousel).
- `CommonGroundHeader` reuses the existing `useCommonGroundState` `refetch` for `↻ Regenerate`.
- `WhyTheseModal` is a thin reuse of the existing modal primitive from `web/src/components/common/Modal.tsx`.

### Accessibility

- Every interactive element has an accessible name. Per-tile `+ Nominate` button: `aria-label="Nominate {gameName}"`. `↻ Regenerate` button: `aria-label="Regenerate Common Ground suggestions"`. Why-these button: `aria-label="Why these suggestions?"`. The tile itself acts as a U2 drawer trigger via `role="button"` + `tabIndex={0}` + `aria-label="Open details for {gameName}"`; click anywhere on the tile EXCEPT the `+ Nominate` button opens the drawer (`e.stopPropagation` on the button).
- Tabs use `role="tablist"`/`role="tab"`/`aria-selected`. Selected tab also surfaces `aria-controls` pointing at the existing-nominations list region.
- Color contrast: the existing `text-emerald-300` ★ reason text on `bg-overlay/40` clears WCAG AA at 12px (verified in the wireframe palette).

### Element-count delta (PR description requirement)

| Surface | Before | After |
|---|---|---|
| Chrome rows above the grid | 5 (status pill + nominate header + filter row + search bar + tag chips) | 1 (JourneyHero) |
| Nominate CTAs on the page | 3 (header button + banner CTA + per-tile button) | 1 (per-tile only) |
| Featured suggestions visible w/o scroll | 6 (horizontal carousel) | 12 (3 themed rows × 4) |
| Common Ground rationale visible | 0 (score is opaque) | 12 (per-tile `★ why` annotation) |

## Behavior Specifications

### Scenario: First-time builder sees zero nominations
- **Given:** an authenticated user opens a `building` lineup where they haven't nominated yet (`nominatedCount === 0`).
- **When:** `NominatingComposite` mounts.
- **Then:** JourneyHero renders `active=0`, `tone="action"`, badge "Step 1 of 4 · Nominating · 2d left", task "Add games to the running.", sub "0 of N nominated by N voters." The tabs render `All (0)` `Yours (0)` `Trending`. The "Existing nominations" list is empty (no rows). Common Ground hero renders 3 rows × 4 tiles. SubmitBar renders `kind="empty"` with disabled CTA `Submit (0 of N nominated) →` and nudge text.

### Scenario: User taps a Common Ground tile (not the Nominate button)
- **Given:** the Common Ground hero has rendered with at least one tile.
- **When:** the user clicks/taps on the tile body (cover, name, or why-reason — anywhere except the `+ Nominate` button).
- **Then:** the U2 GameResearchDrawer opens for that `gameId` with context-aware CTA `+ Nominate this`. No nominate mutation fires from the body click. Clicking the drawer's CTA fires the same `useNominate` mutation as the tile's inline button.

### Scenario: User taps the per-tile + Nominate button
- **Given:** the user is at `< maxNominations` and `canParticipate === true`.
- **When:** the user clicks the `+ Nominate` button on a tile.
- **Then:** `useNominate` fires with that `gameId`. `e.stopPropagation()` on the button prevents the drawer from opening. On success, the tile re-renders with the button replaced by `✓ Nominated`, the JourneyHero `sub` line updates to "(nominatedCount+1) of N nominated", and the tab counts update. The Common Ground list refetches (existing behaviour from `useCommonGroundState`).

### Scenario: User reaches the per-user nomination cap
- **Given:** `nominatedCount === maxNominations` for the user.
- **When:** any `+ Nominate` button renders.
- **Then:** every tile's button renders disabled with tooltip "You've used all your nominations." The SubmitBar surfaces `kind="pre"` (ready to submit). Existing nominations and the drawer's "View" CTA still work.

### Scenario: User submits nominations via SubmitBar
- **Given:** the user has `nominatedCount >= 1` and has not yet submitted.
- **When:** the user clicks the SubmitBar's primary CTA.
- **Then:** `useSubmitNominations` fires, writes `nominations_submitted_at = now()` to the user's `lineup_member` row (per U4 schema), and the SubmitBar morphs to `kind="post"` with "✓ Submitted Thu 7:15 PM · 14 of 20 have submitted" status and ghost `Change my nominations` CTA. The JourneyHero tone shifts from `action` → `waiting` automatically via the U3 `getHeroState` selector.

### Scenario: Tabs filter the Existing nominations list
- **Given:** the lineup has 8 nominations: 3 by the current user, 5 by others.
- **When:** the user clicks `Yours (3)`.
- **Then:** the Existing nominations list re-renders showing only the 3 game refs the user nominated. The Common Ground hero is unaffected — it always shows the global suggestions. Clicking `All (8)` restores the full list. `Trending` is hidden behind a "coming next iteration" stub for V1 — it surfaces `wishlistCount`-sorted entries from the same dataset.

### Scenario: User opens "Why these?"
- **Given:** any Common Ground tile is rendered.
- **When:** the user clicks the `Why these?` button next to the section header.
- **Then:** a modal opens explaining the three signals (ownership / taste / trending). The modal lists the active weights from `meta.appliedWeights` so an operator can sanity-check the scoring. Close via Esc or backdrop click.

### Scenario: User regenerates suggestions
- **Given:** Common Ground tiles are stale or the user wants a different mix.
- **When:** the user clicks `↻ Regenerate`.
- **Then:** the `useCommonGround` query invalidates and refetches. The 12 tiles re-render with the new ordering. The "Owned" row's signal is deterministic across regens (ownership is stable); "Taste" and "Trending" may vary as their inputs (taste vector + wishlist freshness + sale state) change.

### Scenario: Server returns games without theme/whyReason (deployment skew)
- **Given:** the API has not yet deployed the additive `theme` + `whyReason` enrichment.
- **When:** `CommonGroundHero` receives an array of tiles where `theme === undefined`.
- **Then:** the component falls back to a single un-themed row of all 12 tiles in score order, with no `★ why` annotation. The `+ Nominate` button still works. No console errors, no broken layout. Once the server redeploys, the next refetch surfaces the themed layout automatically.

## Error Handling Matrix

| Error Condition | Error Type | HTTP Status | User Message |
|---|---|---|---|
| `useCommonGround` query fails | `ErrorState` | n/a (network) | "Failed to load Common Ground. Try again." + Retry button (existing behaviour). |
| `useNominate` mutation fails (game already nominated) | toast.error | 409 | "Already nominated" — `useCommonGroundState` refetches to align UI. |
| `useNominate` fails (cap reached server-side) | toast.error | 400 | "You've used all your nominations." Button disables for the rest of the session. |
| `useSubmitNominations` fails (no nominations) | toast.error | 400 | "Add at least one nomination before submitting." SubmitBar stays in `kind="empty"`. |
| Server returns no `theme` field | silent fallback | 200 | Tiles render un-themed; user sees no annotation. |
| `whyReason` exceeds 80 chars (server bug) | Zod truncates | 200 | Zod schema enforces `.max(80)`; client never sees > 80 chars. |
| User tries to nominate while `canParticipate === false` | tooltip + disabled button | n/a | "Private lineup — ask the creator for an invite to nominate." |

## Dependencies

- **Contract:** `CommonGroundGameSchema`, `CommonGroundResponseSchema` (extended with optional `theme` + `whyReason`); `LineupDetailResponseSchema` (existing).
- **API internal:** `LineupsService.getCommonGround`, `common-ground-query.helpers.ts`, new `common-ground-theme.helpers.ts`.
- **Web internal:**
  - U1 — `web/src/components/shared/journey-hero/JourneyHero.tsx` (ROK-1294, shipped).
  - U2 — `web/src/components/shared/game-research-drawer/GameResearchDrawer.tsx` (ROK-1295, pending).
  - U4 — `web/src/components/shared/submit-bar/SubmitBar.tsx` (ROK-1296, pending).
  - Existing: `useCommonGround`, `useLineupDetail`, `useNominate`, `NominateModal`, `useCommonGroundState`.
- **External:** none new. Existing IGDB / ITAD / Steam pipelines unchanged.

## Out of scope (deliberately deferred)

- A11y audit of the U2 drawer interior — that ships with ROK-1295. S1 owns only the trigger affordance.
- "Trending" tab data source other than `wishlistCount`-sorted Common Ground entries — true global trending is a separate story.
- Per-user reorder of Common Ground rows — V1 is fixed Owned → Taste → Trending.
- Mobile-specific tile sizing — uses existing responsive grid (Tailwind `grid-cols-4` on `md`, `grid-cols-2` on small).

## Test plan

- **Contract:** `packages/contract/src/__tests__/lineup.schema.spec.ts` — Zod schema accepts `theme: undefined` and `whyReason: undefined`, rejects `whyReason.length > 80`, rejects unknown `theme` strings.
- **API unit:** `api/src/lineups/common-ground-theme.helpers.spec.ts` — `classifyTheme()` returns expected theme for representative score breakdowns (high social → owned, high taste → taste, high base+sale → trending, ties → priority order). `buildWhyReason()` produces the templated string for each theme + modifier combo, truncates at 80 chars.
- **API integration:** extend `api/src/lineups/common-ground.integration.spec.ts` to assert that every game in the response has either both `theme` + `whyReason` set or both absent (no half-states).
- **Web unit:** `web/src/components/lineups/cycle-4/__tests__/CommonGroundHero.test.tsx` — renders 3 themed rows of 4 tiles each given a mixed-theme response; falls back to single-row layout when `theme` absent; per-tile button click fires `useNominate`; tile body click opens drawer (NOT nominate).
- **Web unit:** `NominatingTabs.test.tsx` — `aria-selected` updates on click, `Yours` filters the existing-nominations list, counts update from props.
- **Web unit:** `NominatingComposite.test.tsx` — JourneyHero gets `active=0` and `tone="action"` when user has not submitted; tone shifts to `waiting` when `nominations_submitted_at` is set.
- **Playwright smoke:** `web/tests/lineup-nominating-composite.spec.ts` — open a building lineup, see 3 themed rows + 12 tiles, click a tile body → drawer opens, click per-tile + Nominate → nomination added + tab count increments, click SubmitBar → status changes to submitted.

## Cycle 4 STRICT rules applied

- MUST import U1/U2/U4 — no inline duplication. ✓ Component hierarchy above pulls each from `web/src/components/shared/*`.
- Per-tile `+ Nominate` is the ONLY nominate CTA. ✓ Banner-level and `LineupDetailPage` header-level Nominates removed in this refactor.
- Glossary lockdown — only "Nominate" / "Nomination" / "Lineup" terminology used.
- A11y required — every interactive element has an explicit `aria-label`. ✓ enumerated above.
- PR description must include the element-count delta table above.
