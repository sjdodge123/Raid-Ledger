import { z } from 'zod';
import {
  TASTE_PROFILE_AXIS_POOL,
  TasteProfileDimensionsSchema,
} from './taste-profile.schema.js';

/**
 * Per-axis derivation breakdown for a game taste vector.
 *
 * Explains WHY an axis scored what it scored — which tags/genres/modes/themes
 * matched, how the play signal and IDF weighting influenced the raw score,
 * and what the normalized (0–100) score ended up as. Consumed by the admin
 * taste-vector endpoint (not the public profile endpoint).
 */
export const AxisDerivationSchema = z.object({
  axis: z.enum(TASTE_PROFILE_AXIS_POOL),
  matchedTags: z.array(z.string()),
  matchedGenreIds: z.array(z.number().int()),
  matchedModeIds: z.array(z.number().int()),
  matchedThemeIds: z.array(z.number().int()),
  playSignal: z.number(),
  idfWeight: z.number(),
  rawScore: z.number(),
  normalizedScore: z.number(),
});

export type AxisDerivationDto = z.infer<typeof AxisDerivationSchema>;

/**
 * Fixed-length 7-axis vector kept for the `vector vector(7)` pgvector column.
 * Mirrors `TASTE_PROFILE_AXES` width but stores the top-7 game pool axes by
 * score (selected at pipeline time). Use a plain length-checked number array
 * rather than a branded type — matches the player-vector idiom and keeps
 * JSON (de)serialization trivial.
 */
export const GameTasteVectorSchema = z.array(z.number()).length(7);

export type GameTasteVectorDto = z.infer<typeof GameTasteVectorSchema>;

/**
 * Full admin response for `GET /games/:id/taste-vector`.
 * Includes per-axis derivation so admins can audit scoring decisions.
 */
export const GameTasteVectorResponseSchema = z.object({
  gameId: z.number().int(),
  vector: GameTasteVectorSchema,
  dimensions: TasteProfileDimensionsSchema,
  confidence: z.number().min(0).max(1),
  computedAt: z.string(),
  derivation: z.array(AxisDerivationSchema),
});

export type GameTasteVectorResponseDto = z.infer<
  typeof GameTasteVectorResponseSchema
>;

/**
 * Trimmed public response for `GET /games/:id/taste-profile`.
 * Omits derivation — game-detail page only renders the radar chart and axis
 * list, not the scoring audit trail.
 */
export const GameTasteProfileResponseSchema = z.object({
  gameId: z.number().int(),
  vector: GameTasteVectorSchema,
  dimensions: TasteProfileDimensionsSchema,
  confidence: z.number().min(0).max(1),
  computedAt: z.string(),
});

export type GameTasteProfileResponseDto = z.infer<
  typeof GameTasteProfileResponseSchema
>;

/**
 * Request body for `POST /games/similar`.
 *
 * Exactly one of `userId`, `userIds`, or `gameId` must be provided — the
 * controller resolves each branch to a target 7-vector before running the
 * pgvector cosine query.
 */
export const SimilarGamesRequestSchema = z
  .object({
    userId: z.number().int().optional(),
    userIds: z.array(z.number().int()).optional(),
    gameId: z.number().int().optional(),
    limit: z.number().int().min(1).max(50).default(10),
    /**
     * Exclude solo-only titles from the candidate pool (ROK-931).
     *
     * When true the query filters to rows whose `dimensions` jsonb has
     * at least one of `pvp`, `co_op`, `mmo`, `battle_royale`, or `moba`
     * greater than zero. Community lineups are group play by design;
     * ROK-1082 alignment testing showed unfiltered output includes
     * solo-only games (e.g. *Dead In Bermuda*) that are wasted picks.
     */
    multiplayerOnly: z.boolean().optional(),
  })
  .refine(
    (input) => {
      const provided = [
        input.userId !== undefined,
        input.userIds !== undefined,
        input.gameId !== undefined,
      ].filter(Boolean).length;
      return provided === 1;
    },
    {
      message:
        'Exactly one of userId, userIds, or gameId must be provided',
    },
  );

export type SimilarGamesRequestDto = z.infer<typeof SimilarGamesRequestSchema>;

export const SimilarGameSchema = z.object({
  gameId: z.number().int(),
  name: z.string(),
  coverUrl: z.string().nullable(),
  similarity: z.number(),
});

export type SimilarGameDto = z.infer<typeof SimilarGameSchema>;

export const SimilarGamesResponseSchema = z.object({
  similar: z.array(SimilarGameSchema),
});

export type SimilarGamesResponseDto = z.infer<
  typeof SimilarGamesResponseSchema
>;
