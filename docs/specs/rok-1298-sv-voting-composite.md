# Spec: ROK-1298 — Sv Voting page composite + normalized vote bars + a11y vote toggle

**Plan / Design doc:** `planning-artifacts/specs/cycle-4-unify-lineup.md` (canonical), also tracked at `web/src/dev/simplify-wireframes/README.md`
**Linear:** [ROK-1298](https://linear.app/roknua-projects/issue/ROK-1298)
**Wireframe (DEMO_MODE):** `http://localhost:5173/dev/wireframes/simplify#sv`
**Date:** 2026-05-16
**Status:** draft

## Overview

Sv rebuilds the Voting phase of `LineupDetailPage` as a composite that imports the Cycle 4 foundation (U1 JourneyHero, U2 GameResearchDrawer, U4 SubmitBar). It replaces the legacy `VotingLeaderboard` + `LeaderboardRow` + standalone `ConfirmationPill` triad. Beyond the structural rebuild, Sv fixes two HIGH-severity bugs surfaced in the 2026-05-15 live walkthrough:

1. **Vote bars max out at 100% with 1 vote.** Today's `LeaderboardRow.voteBarPct` divides `voteCount / totalVoters`, but `totalVoters` only counts users who have actually cast at least one vote — so the first vote on the first nominee makes the bar full. Sv normalizes to **voter denominator**: `voteCount / votingEligibleCount` where `votingEligibleCount` is the number of users who *could* vote on this lineup (creator + invitees for private, all members + creator for public). The "X of N voters" label reflects the same denominator so the bar and number agree.
2. **Vote toggle button has no accessible name.** Today's `<button data-testid="vote-toggle">` ships with no `aria-label`/text — `find` tool reports `button "(no name)"`. Sv requires `aria-label={`Vote for ${gameName}`}` on every vote toggle, with `aria-pressed` reflecting the current state.

The composite collapses the chrome from **3 chrome rows (status pill + private-notice + table header)** to **1 JourneyHero + 1 "X of N votes used" pill above the list**. Per-row interaction matrix: tap the row body → U2 drawer; tap the vote circle → toggle. The two affordances cannot collide because the vote circle calls `e.stopPropagation()`.

## Contract Layer (`packages/contract`)

Sv is **almost entirely a presentational refactor** — the entries-with-votes payload already lives at `LineupDetailResponseSchema.entries[*]` and the user's votes at `LineupDetailResponseSchema.myVotes`. **One additive field** is required to fix the vote-bar normalization correctly:

```ts
// packages/contract/src/lineup.schema.ts (extend LineupDetailResponseSchema)
export const LineupDetailResponseSchema = z.object({
  // ...existing fields (totalVoters, totalMembers, etc.)...

  /**
   * Sv (ROK-1298) — total number of users *eligible* to vote on this lineup,
   * used as the denominator for normalized vote bars. For private lineups
   * this is creator + invitees count; for public lineups it is the union of
   * (members ∪ creator). Distinct from `totalVoters` (which only counts
   * users who have cast ≥1 vote) and `totalMembers` (which counts everyone
   * on the lineup including non-eligible viewers in some edge cases).
   * Always >= totalVoters. Always >= 1 (creator is always eligible).
   */
  votingEligibleCount: z.number().int().positive(),
});
```

The existing `totalVoters` field stays as-is because the leaderboard's "X have voted so far" copy still uses it. Both fields ship alongside each other; the bar denominator uses `votingEligibleCount`, the participation copy uses `totalVoters`.

The vote-toggle action contract is unchanged — `POST /api/lineups/:id/vote` continues to return `{ myVotes: number[] }` per `VoteToggleResponseSchema`.

## NestJS Module Spec (`api`)

### Module Structure

Sv extends the existing `LineupsModule`. No new files for routing — the additive `votingEligibleCount` is computed inside the existing `LineupsService.findById` mapper.

- **Service:** `LineupsService.findById` (existing) — computes `votingEligibleCount` from `lineup.visibility` + `invitees.length` (private) or from the existing membership query (public). Returned alongside the existing `totalVoters`/`totalMembers` fields.
- **Helper (new):** `api/src/lineups/voting-eligibility.helpers.ts` (~40 lines) — single pure function:
  - `computeVotingEligibleCount(lineup: LineupRow, invitees: InviteeRow[], members: MemberRow[]): number`
  - Private: `1 (creator) + invitees.length` (creator implicit in invitee list? — assert and dedupe).
  - Public: `members.length` (already includes the creator via the membership table).
- **Submit action (NEW, lands with U4 / ROK-1296 schema):** `POST /api/lineups/:id/votes/submit` writes `votes_submitted_at = now()` to `lineup_member` for the calling user. Sv consumes this via the SubmitBar.

### API Endpoints

#### `GET /api/lineups/:id`

- **Description:** Existing endpoint. Response gains `votingEligibleCount`.
- **Auth:** `JwtAuthGuard` (existing).
- **Response:** `LineupDetailResponseDto` (extended).
- **Errors:** unchanged.

#### `POST /api/lineups/:id/vote`

- **Description:** Existing toggle endpoint. Unchanged in this story.
- **Auth:** `JwtAuthGuard` + `NotDeactivatedGuard` (existing).

#### `POST /api/lineups/:id/votes/submit` (NEW — ROK-1296 owns)

- **Description:** Mark the calling user's votes as submitted. Idempotent.
- **Auth:** `JwtAuthGuard` + `NotDeactivatedGuard`.
- **Response:** `{ votesSubmittedAt: string | null }` (returns the new timestamp, or null if the action no-ops because the lineup advanced phase).
- **Errors:** `404` lineup not found / user not a member, `409` lineup is no longer in `voting` phase.

### Drizzle Schema

No new tables. `votes_submitted_at` lives on `lineup_member` (added by ROK-1296). Sv does not alter the schema directly.

## React Component Spec (`web`)

### Component Hierarchy

    LineupDetailPage (existing)
    └── LineupDetailBody (existing) — phase switch
        └── (when status === 'voting' && hasEntries) VotingComposite [NEW]
            ├── JourneyHero (U1)
            ├── VotesUsedPill [NEW]              # "X of N votes used" above the list
            ├── VotingLeaderboardV2 [NEW]
            │   └── VotingRow [NEW] (per entry)
            │       ├── GameRefBody [NEW]        # cover + name + sub + vote bar (clickable → U2 drawer)
            │       └── VoteToggleButton [NEW]   # accessible vote circle (stopPropagation)
            └── SubmitBar (U4)                   # kinds: empty | partial | pre | post

`LineupDetailBody` is updated so the `lineup.status === 'voting' && hasEntries` branch renders `<VotingComposite />` instead of the legacy `<VotingLeaderboard />` (legacy component is removed in this story — see "Out of scope" for the exception).

### Component contracts

```ts
// web/src/components/lineups/cycle-4/VotingComposite.tsx
interface VotingCompositeProps {
  lineup: LineupDetailResponseDto;
  canParticipate: boolean;
}

// web/src/components/lineups/cycle-4/VotingRow.tsx
interface VotingRowProps {
  entry: LineupEntryResponseDto;
  isVoted: boolean;
  disabled: boolean;
  /** Bar denominator — `lineup.votingEligibleCount`, never derived in the row. */
  voterDenominator: number;
  onToggleVote: () => void;
  onOpenDrawer: () => void;
}

// web/src/components/lineups/cycle-4/VoteToggleButton.tsx
interface VoteToggleButtonProps {
  gameName: string;                          // for aria-label
  isVoted: boolean;
  disabled: boolean;
  onToggle: () => void;
}
```

### State Management

- **Server state:** `useLineupDetail(lineupId)` (existing) — yields `entries`, `myVotes`, `votingEligibleCount`, `totalVoters`, `maxVotesPerPlayer`.
- **Mutations:**
  - `useToggleVote()` (existing) — fires on vote-circle click.
  - `useSubmitVotes(lineupId)` (NEW, ships with U4 / ROK-1296) — fires from the SubmitBar CTA.
- **Client state:** none. All state is server-derived; optimistic updates handled by `useToggleVote`'s existing mutation cache.

### Normalized vote-bar math

```ts
// web/src/components/lineups/cycle-4/voting-bar.helpers.ts
/**
 * Compute the vote-bar percentage for a single entry.
 * Denominator is `votingEligibleCount` (voter pool), NOT `totalVoters`
 * (users who have cast >=1 vote). This is the explicit fix for the
 * "100% bar with 1 vote" bug observed on 2026-05-15.
 */
export function voteBarPct(voteCount: number, votingEligibleCount: number): number {
  if (votingEligibleCount <= 0) return 0;
  const pct = Math.round((voteCount / votingEligibleCount) * 100);
  return Math.max(0, Math.min(100, pct));   // clamp defensively
}
```

The accompanying label reads `${voteCount}/${votingEligibleCount}` (e.g., "8/12") rather than the previous "8 votes" — matching the wireframe.

### Accessibility (the canonical Cycle 4 fix lives here)

Every interactive element on Sv MUST have an accessible name. Concretely:

- **Vote toggle button** — `aria-label={`Vote for ${gameName}`}` (e.g., `aria-label="Vote for Valheim"`). Also surfaces `aria-pressed={isVoted}` and `type="button"`. When disabled and `atLimit && !isVoted`, the `aria-label` becomes `Vote for ${gameName} (vote limit reached)`. When `disabled && !canParticipate`, becomes `Vote for ${gameName} (not a participant)`.
- **Row body (drawer trigger)** — `role="button"` + `tabIndex={0}` + `aria-label={`Open details for ${gameName}`}`. `onKeyDown` handles Enter and Space. `aria-haspopup="dialog"` to signal that activation opens a drawer.
- **Votes-used pill** — non-interactive, but uses `role="status"` + `aria-live="polite"` so screen readers announce the running tally as the user toggles votes.
- **SubmitBar** — owned by U4 (ROK-1296), but Sv must verify `aria-label` is set on its primary CTA in the Sv-mounted instance.
- **Visual focus rings** — `focus-visible:ring-2 focus-visible:ring-emerald-500` on both the vote toggle and the row body. The row's focus ring uses an outline (`outline-emerald-500`) so it doesn't get hidden inside `overflow-hidden` containers.

### UI Components

- Tailwind primitives only — no new shadcn. Color tokens reuse existing emerald/edge palette.
- Vote toggle: circular `w-5 h-5` (wireframe) — slightly smaller than the legacy 7×7. Filled emerald when voted, ringed edge color otherwise.
- Vote bar: `h-1.5 bg-overlay/60 rounded-full` track; emerald-500 fill (uniform color regardless of voted state — the row already gets an emerald left-rail when voted, the bar doesn't need to triple-encode it).

### Element-count delta (PR description requirement)

| Surface | Before | After |
|---|---|---|
| Chrome rows above the leaderboard | 3 (status pill + private-notice + table header) | 2 (JourneyHero + votes-used pill) |
| Vote-toggle a11y name | "(no name)" (0 chars) | "Vote for {gameName}" (with aria-pressed) |
| Vote-bar denominator | `totalVoters` (active voters only) | `votingEligibleCount` (voter pool) |
| Submit affordance | none on page (autosave only) | U4 SubmitBar with 4 states |

## Behavior Specifications

### Scenario: Voter casts the first vote on a lineup with 12 eligible voters
- **Given:** `lineup.votingEligibleCount === 12`, `lineup.myVotes === []`, `entries[0].voteCount === 0`.
- **When:** the user clicks the vote toggle on `entries[0]`.
- **Then:** `useToggleVote` fires. On success: `myVotes` includes `entries[0].gameId`, `entries[0].voteCount === 1`, the bar renders at `Math.round(1/12 * 100) = 8%` (NOT 100%), the label reads "1/12". The vote toggle's `aria-pressed` flips to `true`. The "X of 3 votes used" pill increments.

### Scenario: Voter at the per-user vote limit
- **Given:** `myVotes.length === maxVotesPerPlayer` (e.g., 3 of 3).
- **When:** the page renders.
- **Then:** every vote toggle for a non-voted entry renders `disabled` with `aria-label="Vote for {gameName} (vote limit reached)"`. The user CAN still toggle off any of their existing votes (button stays interactive for already-voted entries). SubmitBar surfaces `kind="pre"` (3 of 3 used · autosaved → primary CTA "Submit my votes →").

### Scenario: Tap the row body (not the vote circle)
- **Given:** any entry is visible.
- **When:** the user taps the cover image, the game name, or the empty area in the row but NOT the vote circle.
- **Then:** the U2 GameResearchDrawer opens for that gameId with context-aware CTA `Vote for this`. The vote toggle's state on the row is unchanged. Clicking the drawer's CTA fires the same `useToggleVote` mutation as the inline circle.

### Scenario: Tap the vote circle
- **Given:** any entry is visible.
- **When:** the user clicks/taps the vote circle inside a row.
- **Then:** the click does NOT bubble to the row body (button's `onClick` calls `e.stopPropagation()`). The drawer does NOT open. `useToggleVote` fires for that gameId.

### Scenario: Keyboard user reaches a row via Tab
- **Given:** the user has tabbed to a row body.
- **When:** the user presses Enter or Space.
- **Then:** the U2 drawer opens (same as click). Tab continues to the vote circle as a separate focus stop. Enter/Space on the vote circle toggles the vote.

### Scenario: Screen reader narrates the page
- **Given:** the user has a screen reader active.
- **When:** focus reaches a voted entry's vote button.
- **Then:** SR announces "Vote for Valheim, button, pressed" (or "not pressed" if unvoted). Focus on the row body announces "Open details for Valheim, button, has popup, dialog".

### Scenario: User submits votes via SubmitBar
- **Given:** the user has cast `>= 1` vote and the lineup is in `voting` phase.
- **When:** the user clicks the SubmitBar primary CTA.
- **Then:** `useSubmitVotes` fires, writes `votes_submitted_at = now()` to `lineup_member` for the user. SubmitBar transitions to `kind="post"` with "✓ Submitted Thu 7:15 PM · 14 of 20 have submitted" and ghost `Change my votes` CTA. JourneyHero tone shifts `action` → `waiting` via the U3 selector (which reads `votes_submitted_at`).

### Scenario: Lineup has zero eligible voters edge case
- **Given:** `lineup.votingEligibleCount === 0` (defensive — should never happen in production).
- **When:** any vote bar renders.
- **Then:** `voteBarPct()` returns `0`, the bar renders empty, no `NaN%` ever reaches the DOM. The page does not crash. An error is logged client-side for tracing.

### Scenario: Server returns lineup without `votingEligibleCount` (deployment skew)
- **Given:** the API has not yet deployed the additive field.
- **When:** the Sv composite receives a lineup with `votingEligibleCount === undefined`.
- **Then:** the component falls back to `lineup.totalVoters || lineup.totalMembers || 1` for the denominator (legacy behaviour), surfaces a one-time `console.warn` in dev, and continues rendering. Once the server redeploys, the next refetch surfaces the corrected denominator.

## Error Handling Matrix

| Error Condition | Error Type | HTTP Status | User Message |
|---|---|---|---|
| `useToggleVote` fails (race — lineup phase changed) | toast.error | 409 | "Voting has closed for this lineup." Page refetches; SubmitBar may disappear (status → decided). |
| `useToggleVote` fails (over per-user limit, server-side) | toast.error | 400 | "You've used all your votes." |
| `useToggleVote` fails (network) | toast.error | n/a | "Vote failed. Try again." Optimistic update rolled back. |
| `useSubmitVotes` fails (lineup advanced) | toast.error | 409 | "Votes already finalized — the lineup advanced." SubmitBar morphs to `kind="post"` anyway (defensive). |
| `useSubmitVotes` fails (no votes cast) | toast.error | 400 | "Cast at least one vote before submitting." SubmitBar stays in `kind="empty"`. |
| `votingEligibleCount` is `0` (server bug) | client-side guard | 200 | Bars render at 0%. Sentry breadcrumb logged. |
| `canParticipate === false` (private lineup non-invitee) | tooltip + disabled buttons | n/a | "Private lineup — ask the creator for an invite to cast votes." Vote toggles all disabled. |

## Dependencies

- **Contract:** `LineupDetailResponseSchema` (extended with `votingEligibleCount`), `LineupEntryResponseSchema` (unchanged), `VoteToggleResponseSchema` (unchanged).
- **API internal:** `LineupsService.findById`, new `voting-eligibility.helpers.ts`, U4 `POST /:id/votes/submit` (lands with ROK-1296).
- **Web internal:**
  - U1 — `web/src/components/shared/journey-hero/JourneyHero.tsx` (ROK-1294, shipped).
  - U2 — `web/src/components/shared/game-research-drawer/GameResearchDrawer.tsx` (ROK-1295, pending).
  - U4 — `web/src/components/shared/submit-bar/SubmitBar.tsx` (ROK-1296, pending).
  - Existing: `useLineupDetail`, `useToggleVote`, `ConfirmationPill` (replaced by `VotesUsedPill`).
- **External:** none new.

## Out of scope (deliberately deferred)

- Replacing the public-lineup voting flow (`PublicLineupPage`) — Sv targets the authenticated detail page only. Public path keeps the legacy `VotingLeaderboard` until a follow-up consolidates them.
- "Submitted-by-N" leaderboard column — quorum logic per U4 spec counts submissions, but the leaderboard does not surface per-game submission counts in V1. Considered for a later story.
- Vote-bar animation polish (spring-on-update) — visual polish, not in scope for the bug-fix story.
- Tiebreaker/veto flow integration — Sv defers to the existing `TiebreakerView` branch in `LineupDetailBody` when a tiebreaker is active.

## Test plan

- **Contract:** `packages/contract/src/__tests__/lineup.schema.spec.ts` — Zod accepts `votingEligibleCount: 12`, rejects `0` and negative, rejects missing field once the migration ships (until then optional in a transition window).
- **API unit:** `api/src/lineups/voting-eligibility.helpers.spec.ts` — covers private (creator + invitees, dedup), public (member count), edge cases (creator is also an invitee — count once).
- **API integration:** `api/src/lineups/lineups.integration.spec.ts` — `GET /lineups/:id` for a private lineup with 5 invitees returns `votingEligibleCount: 6` (creator + 5); public lineup with 12 members returns `votingEligibleCount: 12`.
- **Web unit:** `web/src/components/lineups/cycle-4/__tests__/VotingRow.test.tsx`:
  - vote bar renders at `1/12 = 8%` when `voteCount=1, voterDenominator=12` (NOT 100% — this is the explicit regression guard).
  - clicking vote circle calls `onToggleVote` and does NOT call `onOpenDrawer`.
  - clicking row body calls `onOpenDrawer` and does NOT call `onToggleVote`.
  - vote button has `aria-label="Vote for Valheim"` and `aria-pressed="false"` initially.
  - aria-pressed flips to `true` when `isVoted` prop becomes true.
- **Web unit:** `VotingComposite.test.tsx` — JourneyHero `active=1`, `tone="action"` while user has not submitted; tone shifts to `waiting` once `votesSubmittedAt` is set.
- **Web unit:** `voting-bar.helpers.spec.ts` — `voteBarPct(1, 12) === 8`; `voteBarPct(12, 12) === 100`; `voteBarPct(0, 0) === 0`; clamps overflow.
- **Playwright smoke:** `web/tests/lineup-voting-composite.spec.ts`:
  - load a voting-phase lineup with 12 eligible voters and 1 cast vote → bar reads "1/12" and is ~8% wide, NOT 100%.
  - vote toggle has `aria-label="Vote for Valheim"` (Playwright `getByRole('button', { name: 'Vote for Valheim' })`).
  - keyboard Tab to a row, press Enter → drawer opens.
  - keyboard Tab past row to vote button, press Enter → vote toggles (drawer does NOT open).
  - both desktop AND mobile projects pass (CI parity per CLAUDE.md).
- **A11y axe scan:** Playwright `await page.locator('[data-testid="voting-composite"]').evaluate(... axe.run())` returns zero violations on the voting region.

## Cycle 4 STRICT rules applied

- MUST import U1/U2/U4 — no inline duplication. ✓ Component hierarchy above.
- Every interactive element needs an accessible name — Sv is the canonical fix for the existing "(no name)" violation. ✓ enumerated above; tests assert.
- Vote bars normalized to voter count — explicit regression test (`1/12 === 8%`).
- Glossary lockdown — only "Vote" / "Voting" / "Lineup" terminology used.
- PR description must include the element-count delta + a11y check note ("Sv-region axe scan: 0 violations").
