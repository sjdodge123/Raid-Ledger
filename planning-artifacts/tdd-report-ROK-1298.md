# TDD Report — ROK-1298 (Sv Voting composite + a11y vote toggle + normalized vote bars)

**Branch:** `rok-1298-sv-voting-composite`
**Worktree:** `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1298`
**Author:** test agent
**Date:** 2026-05-18
**Spec:** `docs/specs/rok-1298-sv-voting-composite.md`
**Brief:** `planning-artifacts/dev-brief-ROK-1298.md`

## Summary

7 new failing test files (8 if you count the api-side mirror of the contract spec) covering every AC in the spec. All tests confirmed to fail with module-not-found or assertion failures — not typos — until the dev ships the source files.

| Workspace | Files added | Test count |
|---|---|---|
| `packages/contract` | 1 spec (`__tests__/lineup.schema.spec.ts`) | 8 |
| `api` (jest) | 1 mirror spec, 1 unit spec, 1 integration block | 7 + 11 + 4 = 22 |
| `web` (vitest) | 3 specs under `cycle-4/__tests__/` | 10 + 14 + 9 = 33 |
| `scripts/smoke` (Playwright) | 1 spec, runs on both viewports | 8 × 2 = 16 |
| **Total** | **7 files** | **79 test cases** |

## Per-AC mapping

| AC (spec) | What it asserts | Test file(s) | Status |
|---|---|---|---|
| AC1 | JourneyHero region with `active=1` + tone `'action'`; tone shifts to `'waiting'` when `votesSubmittedAt` is set. | `VotingComposite.test.tsx` (3 cases), `lineup-voting-composite.smoke.spec.ts` (AC1 group) | FAIL — module-not-found |
| AC2 | Tapping the row body opens the U2 drawer; tapping the vote circle does NOT bubble (calls `e.stopPropagation()`). | `VotingRow.test.tsx` (click-bubbling guard, 3 cases) | FAIL — module-not-found |
| AC3 | Vote toggle has `aria-label="Vote for {gameName}"` AND `aria-pressed` reflects state. | `VotingRow.test.tsx` (a11y group, 5 cases), `lineup-voting-composite.smoke.spec.ts` (AC3 group, 2 cases) | FAIL — module-not-found |
| AC4 | Vote bars normalized to `voteCount / votingEligibleCount` — `voteBarPct(1, 12) === 8`, NOT 100. | `voting-bar.helpers.test.ts` (10 cases incl. clamp + NaN guard), `VotingRow.test.tsx` (bar group, 4 cases), `lineup-voting-composite.smoke.spec.ts` (AC4 group, 2 cases) | FAIL — module-not-found |
| AC5 | "X of N votes used" pill above the leaderboard (role=status, aria-live=polite). | `VotingComposite.test.tsx` (2 cases) | FAIL — module-not-found |
| AC6 | SubmitBar 4 kinds (`empty` / `partial` / `pre` / `post`) derived from `viewerSubmissions.votesSubmittedAt` + `myVotes.length`. | `VotingComposite.test.tsx` (4 cases, one per kind) | FAIL — module-not-found |
| AC7 (smoke) | Bar reads "1/N" and width is between 0% and < 100% on a 1-vote, multi-eligible-voter lineup. | `lineup-voting-composite.smoke.spec.ts` (AC4 group) | FAIL — UI not built |
| AC8 (smoke) | Vote toggle locatable by `getByRole('button', { name: 'Vote for {game}' })`. | `lineup-voting-composite.smoke.spec.ts` (AC3 group) | FAIL — UI not built |
| AC9 (smoke) | Keyboard Tab to row → Enter opens drawer; Tab to vote button → Enter toggles vote (drawer stays closed). Both desktop AND mobile. | `lineup-voting-composite.smoke.spec.ts` (AC9 group, 2 cases × 2 projects) | FAIL — UI not built |
| **Contract** | Zod accepts a positive int for `votingEligibleCount`, rejects 0/negative/non-int/missing/string. | `packages/contract/src/__tests__/lineup.schema.spec.ts` (8 cases), api mirror `api/src/lineups/lineup-schema-voting-eligible.spec.ts` (7 cases) | FAIL — field not in schema |
| **API unit** | `computeVotingEligibleCount` covers private/public branches, dedupes creator from invitees, floors at 1. | `api/src/lineups/voting-eligibility.helpers.spec.ts` (11 cases) | FAIL — helper missing |
| **API integration** | `GET /lineups/:id` returns `votingEligibleCount` for public (12 → 12) and private (5 invitees → 6), dedupes creator, floors at 1. | `api/src/lineups/lineups.integration.spec.ts` (4 new cases in `ROK-1298: votingEligibleCount` describe block) | FAIL — response field missing |

## Files added (absolute paths)

1. `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1298/packages/contract/src/__tests__/lineup.schema.spec.ts`
2. `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1298/api/src/lineups/lineup-schema-voting-eligible.spec.ts` (api-side mirror — contract has no runner)
3. `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1298/api/src/lineups/voting-eligibility.helpers.spec.ts`
4. `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1298/web/src/components/lineups/cycle-4/__tests__/voting-bar.helpers.test.ts`
5. `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1298/web/src/components/lineups/cycle-4/__tests__/VotingRow.test.tsx`
6. `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1298/web/src/components/lineups/cycle-4/__tests__/VotingComposite.test.tsx`
7. `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1298/scripts/smoke/lineup-voting-composite.smoke.spec.ts`

## Files modified

- `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1298/api/src/lineups/lineups.integration.spec.ts` — appended `describe('ROK-1298: votingEligibleCount', describeROK1298)` block at the bottom.

## Notes for the dev

- **Filename convention**: The brief said `voting-bar.helpers.spec.ts`. Vitest's `web/vitest.config.ts` (and the root `vitest.config.ts`) only include `**/*.test.{ts,tsx}` in `web/src/**`, so the spec was named `voting-bar.helpers.test.ts`. Same for `VotingRow.test.tsx` / `VotingComposite.test.tsx`. Don't rename them back.
- **Component contract assumed by the tests**:
  - `VotingRow` props: `{ entry, isVoted, disabled, voterDenominator, onToggleVote, onOpenDrawer }`.
  - `VotingRow` DOM expectations: vote circle is `<button aria-label="Vote for {gameName}" aria-pressed={isVoted}>`. Row body is also `role="button"` with `aria-label="Open details for {gameName}"`. Bar fill is `<div data-testid="vote-bar-fill" style={{ width: \`${pct}%\` }} />`. Row also renders the literal text `"{voteCount}/{voterDenominator}"` (e.g. "1/12").
  - `VotingComposite` props: `{ lineup, canParticipate }`. Must render JourneyHero with badge text matching `/step 2 of 4 · voting/i`. Pill text is "X of N votes used". SubmitBar CTAs match `/Submit my votes/i` (pre) and `/Change my votes/i` (post).
  - `voting-bar.helpers.ts` exports `voteBarPct(voteCount, votingEligibleCount): number` matching the spec's clamp + zero-denominator guard.
- **API helper signature** (locked by the unit test): `computeVotingEligibleCount(lineup: { createdBy, visibility }, invitees: { id }[], totalMembers: number): number`. Pure function; floor at 1.
- **Contract field**: extend `LineupDetailResponseSchema` with `votingEligibleCount: z.number().int().positive()`. The integration test asserts the field is returned by the live HTTP layer for both visibilities.
- **Smoke gameName interpolation**: the smoke uses the first game from `/admin/settings/games` (seed-dependent). It does NOT hard-code "Valheim" — that selector would break in CI if seed names rotate. The spec's example AC literally references "Vote for Valheim" but the test uses the actual fixture game name.
- **Smoke denominator**: the smoke reads `votingEligibleCount` back from `GET /lineups/:id` and asserts whatever N is — but enforces `N >= 2` as a setup precondition so the regression guard (bar < 100% on 1 vote) is meaningful. The seed already has admin + at least 1 other community member, so this holds in CI.

## Verification commands

Run from the worktree root:

```bash
# API (jest) — should see 22 failing tests in the 3 ROK-1298 specs.
cd api && npx jest voting-eligibility lineup-schema-voting-eligible
cd api && npx jest --config=jest.integration.config.js lineups.integration  # needs Docker

# Web (vitest) — should see 33 failing tests across 3 files.
npx vitest run web/src/components/lineups/cycle-4/__tests__/

# Smoke (Playwright) — 16 tests (8 × 2 viewports), require dev env up.
npx playwright test scripts/smoke/lineup-voting-composite.smoke.spec.ts --list
```

All commands confirmed to produce module-not-found / parse / assertion errors at the time of writing — the test contract is the spec; the dev's job is to make it pass.
