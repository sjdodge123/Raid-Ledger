import { z } from 'zod';
import { MatchDetailResponseSchema } from './lineup.schema.js';

// ============================================================
// Community Lineup Matches — Decided View (ROK-937)
// ============================================================

/** A game carried forward from a previous lineup's suggested matches. */
export const CarriedForwardEntrySchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    voteCount: z.number(),
    nominatedBy: z.object({
        id: z.number(),
        displayName: z.string(),
    }),
});

export type CarriedForwardEntryDto = z.infer<typeof CarriedForwardEntrySchema>;

/** Grouped matches response for the decided view. */
export const GroupedMatchesResponseSchema = z.object({
    scheduling: z.array(MatchDetailResponseSchema),
    almostThere: z.array(MatchDetailResponseSchema),
    rallyYourCrew: z.array(MatchDetailResponseSchema),
    carriedForward: z.array(CarriedForwardEntrySchema),
    matchThreshold: z.number(),
    totalVoters: z.number(),
});

export type GroupedMatchesResponseDto = z.infer<
    typeof GroupedMatchesResponseSchema
>;

/** Response from a bandwagon join action. */
export const BandwagonJoinResponseSchema = z.object({
    matchId: z.number(),
    promoted: z.boolean(),
    newMemberCount: z.number(),
});

export type BandwagonJoinResponseDto = z.infer<
    typeof BandwagonJoinResponseSchema
>;
