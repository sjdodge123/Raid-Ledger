/**
 * ROK-1474 — the starred ballot (contract).
 *
 * A voter's single "top pick" on a community lineup. It is NOT a new vote
 * type: the star is the ordinal `rank = 1` written onto the voter's existing
 * approval row (`community_lineup_votes`), so starring implies approval by
 * construction and ranks `2..N` are a later additive change with no second
 * migration (issue design constraint, 2026-09-03).
 *
 * Operator ruling (2026-09-05 21:55Z) — **stars are PRIVATE until the
 * outcome**. While a ballot is open nobody may see who starred what or how
 * many stars a game holds; the voter sees only their own star
 * (`LineupDetailResponseDto.myTopPickGameId`). Counts surface only once the
 * vote is closed — on the decided outcome and on the tie readiness card. That
 * is why there is no `StarTallySchema` here: an open-ballot tally is not a
 * shape this system is allowed to produce.
 */
import { z } from 'zod';

/**
 * Body for `POST /lineups/:id/star`.
 *
 * `null` clears the voter's star. A voter may star nothing (AC1), so "no
 * selection" is a first-class value rather than an omitted field — an
 * optional key would make "clear my star" indistinguishable from a
 * malformed body.
 */
export const SetStarSchema = z.object({
    gameId: z.number().int().positive().nullable(),
});
export type SetStarDto = z.infer<typeof SetStarSchema>;

/** What `setStar` did, echoed by the endpoint's activity-log entry. */
export const StarActionSchema = z.enum(['set', 'cleared']);
export type StarAction = z.infer<typeof StarActionSchema>;
