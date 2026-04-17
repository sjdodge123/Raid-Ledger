import { z } from 'zod';

/**
 * The 7 core axes kept for the `vector vector(7)` pgvector column.
 * Used by similar-players cosine similarity — do not widen without a
 * pgvector column migration.
 */
export const TASTE_PROFILE_AXES = [
  'co_op',
  'pvp',
  'rpg',
  'survival',
  'strategy',
  'social',
  'mmo',
] as const;

export type TasteProfileAxis = (typeof TASTE_PROFILE_AXES)[number];

/**
 * Full taste-profile axis pool (ROK-949 dynamic-axes extension).
 *
 * The backend computes scores for every axis in this pool and stores
 * them in `player_taste_vectors.dimensions` (jsonb — no schema change
 * needed). The UI picks the top 7 by value for each player so every
 * radar chart is tailored to that player's actual play habits.
 */
export const TASTE_PROFILE_AXIS_POOL = [
  'co_op',
  'pvp',
  'battle_royale',
  'mmo',
  'moba',
  'fighting',
  'shooter',
  'racing',
  'sports',
  'rpg',
  'fantasy',
  'sci_fi',
  'adventure',
  'strategy',
  'survival',
  'crafting',
  'automation',
  'sandbox',
  'horror',
  'social',
  'roguelike',
  'puzzle',
  'platformer',
  'stealth',
] as const;

export type TasteProfilePoolAxis = (typeof TASTE_PROFILE_AXIS_POOL)[number];

export const TASTE_PROFILE_ARCHETYPES = [
  'Dedicated',
  'Specialist',
  'Explorer',
  'Social Drifter',
  'Casual',
] as const;

export type TasteProfileArchetype = (typeof TASTE_PROFILE_ARCHETYPES)[number];

/**
 * Dimensions object keyed by the full axis pool (~20 keys).
 * `catchall(z.number())` keeps the shape forward-compatible if the
 * pool grows without requiring every consumer to be updated at once.
 */
export const TasteProfileDimensionsSchema = z
  .object(
    Object.fromEntries(
      TASTE_PROFILE_AXIS_POOL.map((axis) => [axis, z.number()]),
    ) as Record<TasteProfilePoolAxis, z.ZodNumber>,
  )
  .catchall(z.number());

export const IntensityMetricsSchema = z.object({
  intensity: z.number(),
  focus: z.number(),
  breadth: z.number(),
  consistency: z.number(),
});

export const CoPlayPartnerSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  avatar: z.string().nullable(),
  sessionCount: z.number().int(),
  totalMinutes: z.number().int(),
  lastPlayedAt: z.string(),
});

export const TasteProfileResponseSchema = z.object({
  userId: z.number().int(),
  dimensions: TasteProfileDimensionsSchema,
  intensityMetrics: IntensityMetricsSchema,
  archetype: z.enum(TASTE_PROFILE_ARCHETYPES),
  coPlayPartners: z.array(CoPlayPartnerSchema).max(10),
  computedAt: z.string(),
});

export const SimilarPlayerSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  avatar: z.string().nullable(),
  archetype: z.enum(TASTE_PROFILE_ARCHETYPES),
  similarity: z.number(),
});

export const SimilarPlayersResponseSchema = z.object({
  similar: z.array(SimilarPlayerSchema).max(50),
});

export type TasteProfileDimensionsDto = z.infer<
  typeof TasteProfileDimensionsSchema
>;
export type IntensityMetricsDto = z.infer<typeof IntensityMetricsSchema>;
export type CoPlayPartnerDto = z.infer<typeof CoPlayPartnerSchema>;
export type TasteProfileResponseDto = z.infer<
  typeof TasteProfileResponseSchema
>;
export type SimilarPlayerDto = z.infer<typeof SimilarPlayerSchema>;
export type SimilarPlayersResponseDto = z.infer<
  typeof SimilarPlayersResponseSchema
>;
