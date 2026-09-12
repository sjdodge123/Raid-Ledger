import { z } from 'zod';

// ============================================================
// Voter-Cohort Lineup Memory (ROK-1309)
// ============================================================

/**
 * Canonical resolution enum, mirroring `community_lineup_cohort_memory.resolution`.
 *
 * - `decided`    — the lineup's `decidedGameId`.
 * - `match`      — a match-tier game produced by the voting algorithm.
 * - `veto_won`   — the game that survived a veto tiebreaker.
 * - `veto_lost`  — a game vetoed out. Persisted for the ROK-1310 insights
 *                  panel; never surfaced by the in-lineup endpoint.
 */
export const CohortMemoryResolutionSchema = z.enum([
    'decided',
    'match',
    'veto_won',
    'veto_lost',
]);

export type CohortMemoryResolution = z.infer<
    typeof CohortMemoryResolutionSchema
>;

/**
 * A game this exact cohort has resolved before.
 *
 * `resolution` narrows the canonical enum to the three positive outcomes:
 * `veto_lost` rows are filtered out at the API layer for
 * `GET /lineups/:id/cohort-memory`, so a `veto_lost` entry reaching the client
 * is a contract violation rather than something the UI must remember to hide.
 */
export const CohortMemoryEntrySchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    resolution: z.enum(['decided', 'match', 'veto_won']),
    /** ISO timestamp of the most recent resolution by this cohort. */
    lastResolvedAt: z.string(),
    /** Lineup the remembered resolution came from (diagnostics / linking). */
    sourceLineupId: z.number(),
});

export type CohortMemoryEntryDto = z.infer<typeof CohortMemoryEntrySchema>;

/**
 * Response for `GET /lineups/:id/cohort-memory`.
 *
 * `cohortSize` is the size of the current lineup's engaged participant set
 * (`union(entries.nominatedBy, votes.userId)`). It is 0 — with an empty
 * `entries` array — when the lineup has no engaged participants yet, since a
 * cohort with no members has no signature to match on.
 */
export const CohortMemoryResponseSchema = z.object({
    cohortSize: z.number(),
    entries: z.array(CohortMemoryEntrySchema),
});

export type CohortMemoryResponseDto = z.infer<
    typeof CohortMemoryResponseSchema
>;
