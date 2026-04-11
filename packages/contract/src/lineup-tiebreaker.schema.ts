/**
 * Community Lineup Tiebreaker contract schemas (ROK-938).
 * Bracket and veto tiebreaker resolution modes.
 */
import { z } from 'zod';

// ============================================================
// Enums
// ============================================================

export const TiebreakerModeSchema = z.enum(['bracket', 'veto']);
export type TiebreakerMode = z.infer<typeof TiebreakerModeSchema>;

export const TiebreakerStatusSchema = z.enum([
    'pending',
    'active',
    'resolved',
    'dismissed',
]);
export type TiebreakerStatus = z.infer<typeof TiebreakerStatusSchema>;

// ============================================================
// Request Schemas
// ============================================================

/** Start a tiebreaker (operator chooses mode). */
export const StartTiebreakerSchema = z.object({
    mode: TiebreakerModeSchema,
    roundDurationHours: z.number().int().min(1).max(168).optional(),
});
export type StartTiebreakerDto = z.infer<typeof StartTiebreakerSchema>;

/** Cast a bracket vote on a matchup. */
export const CastBracketVoteSchema = z.object({
    matchupId: z.number().int().positive(),
    gameId: z.number().int().positive(),
});
export type CastBracketVoteDto = z.infer<typeof CastBracketVoteSchema>;

/** Submit a veto on a game. */
export const CastVetoSchema = z.object({
    gameId: z.number().int().positive(),
});
export type CastVetoDto = z.infer<typeof CastVetoSchema>;

// ============================================================
// Response Schemas
// ============================================================

/** A game in the tiebreaker. */
const TiebreakerGameSchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    originalVoteCount: z.number(),
});

/** A single bracket matchup with game info and vote state. */
export const BracketMatchupSchema = z.object({
    id: z.number(),
    round: z.number(),
    position: z.number(),
    gameA: TiebreakerGameSchema,
    gameB: TiebreakerGameSchema.nullable(),
    isBye: z.boolean(),
    winnerGameId: z.number().nullable(),
    voteCountA: z.number(),
    voteCountB: z.number(),
    myVote: z.number().nullable(),
    isActive: z.boolean(),
    isCompleted: z.boolean(),
});
export type BracketMatchupDto = z.infer<typeof BracketMatchupSchema>;

/** Veto game card state. */
const VetoGameCardSchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    vetoCount: z.number(),
    isEliminated: z.boolean(),
    isWinner: z.boolean(),
});

/** Full veto mode status. */
export const VetoStatusSchema = z.object({
    games: z.array(VetoGameCardSchema),
    totalVetoes: z.number(),
    vetoCap: z.number(),
    revealed: z.boolean(),
    myVetoGameId: z.number().nullable(),
    survivorGameId: z.number().nullable(),
});
export type VetoStatusDto = z.infer<typeof VetoStatusSchema>;

/** Full tiebreaker detail with mode-specific payload. */
export const TiebreakerDetailSchema = z.object({
    id: z.number(),
    lineupId: z.number(),
    mode: TiebreakerModeSchema,
    status: TiebreakerStatusSchema,
    tiedGameIds: z.array(z.number()),
    originalVoteCount: z.number(),
    winnerGameId: z.number().nullable(),
    roundDeadline: z.string().nullable(),
    resolvedAt: z.string().nullable(),
    currentRound: z.number().nullable(),
    totalRounds: z.number().nullable(),
    matchups: z.array(BracketMatchupSchema).nullable(),
    vetoStatus: VetoStatusSchema.nullable(),
});
export type TiebreakerDetailDto = z.infer<typeof TiebreakerDetailSchema>;

/** Prompt for operator when ties are detected. */
export const TiebreakerPromptSchema = z.object({
    tiedGames: z.array(TiebreakerGameSchema),
    voteCount: z.number(),
    hasPendingTiebreaker: z.boolean(),
});
export type TiebreakerPromptDto = z.infer<typeof TiebreakerPromptSchema>;
