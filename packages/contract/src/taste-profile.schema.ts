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

/**
 * Intensity tier enum (ROK-1083). Always present on every archetype —
 * derived from `intensityMetrics.intensity` via a threshold ladder.
 * Ordered from most to least intense.
 */
export const INTENSITY_TIERS = [
  'Hardcore',
  'Dedicated',
  'Regular',
  'Casual',
] as const;

export type IntensityTier = (typeof INTENSITY_TIERS)[number];

export const IntensityTierSchema = z.enum(INTENSITY_TIERS);

/**
 * Vector title enum (ROK-1083). 0–2 of these may be attached to an
 * archetype based on the player's strongest axis scores. Single-axis
 * titles take the raw axis score; multi-axis titles take the max of
 * their component axes (e.g. `Hero = max(rpg, fantasy)`,
 * `Architect = max(crafting, automation, sandbox)`).
 */
export const VECTOR_TITLES = [
  'Duelist',
  'Brawler',
  'Last One Standing',
  'Tactician',
  'Marksman',
  'Companion',
  'Raider',
  'Socialite',
  'Hero',
  'Spacefarer',
  'Wayfarer',
  'Architect',
  'Strategist',
  'Survivor',
  'Nightcrawler',
  'Risk Taker',
  'Operative',
  'Puzzler',
  'Acrobat',
  'Racer',
  'Athlete',
] as const;

export type VectorTitle = (typeof VECTOR_TITLES)[number];

export const VectorTitleSchema = z.enum(VECTOR_TITLES);

/**
 * Composed archetype shape (ROK-1083) — replaces the old 5-value enum.
 * `intensityTier` is always present; `vectorTitles` may be 0–2 entries;
 * `descriptions.titles` has the same length/order as `vectorTitles`.
 *
 * Description text is owned by the server (see `api/src/taste-profile/
 * archetype-copy.ts`) and shipped to the UI in the response payload so
 * copy changes don't force a contract rebuild cascade.
 */
export const ArchetypeSchema = z.object({
  intensityTier: IntensityTierSchema,
  vectorTitles: z.array(VectorTitleSchema).max(2),
  descriptions: z.object({
    tier: z.string(),
    titles: z.array(z.string()).max(2),
  }),
});

export type ArchetypeDto = z.infer<typeof ArchetypeSchema>;

/**
 * Dimensions object — strict shape keyed by the full axis pool.
 * Every pool axis must be present with a numeric score (0–100). Extra
 * keys are rejected; growing the pool requires updating
 * `TASTE_PROFILE_AXIS_POOL` and rebuilding the contract so consumers
 * see the new type.
 */
export const TasteProfileDimensionsSchema = z.object(
  Object.fromEntries(
    TASTE_PROFILE_AXIS_POOL.map((axis) => [axis, z.number()]),
  ) as Record<TasteProfilePoolAxis, z.ZodNumber>,
);

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
  archetype: ArchetypeSchema,
  coPlayPartners: z.array(CoPlayPartnerSchema).max(10),
  computedAt: z.string(),
});

export const SimilarPlayerSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  avatar: z.string().nullable(),
  intensityTier: IntensityTierSchema,
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

// ============================================================
// Taste Profile LLM Context (ROK-950)
// ============================================================

/**
 * A single pool-axis entry with its score (0–100).
 * Used for ranking the strongest and weakest axes in LLM context.
 */
export const TopAxisSchema = z.object({
    axis: z.enum(TASTE_PROFILE_AXIS_POOL),
    score: z.number(),
});

export type TopAxisDto = z.infer<typeof TopAxisSchema>;

/**
 * Co-play partner context — includes identity, session stats, and the
 * partner's own top axes (≤3) for downstream LLM prompt construction.
 */
export const CoPlayPartnerContextSchema = z.object({
    userId: z.number().int(),
    username: z.string(),
    sessionCount: z.number().int(),
    topAxes: z.array(TopAxisSchema).max(3),
});

export type CoPlayPartnerContextDto = z.infer<
    typeof CoPlayPartnerContextSchema
>;

/**
 * Per-user taste context bundle — shape consumed by LLM prompt builders.
 * Archetype (composed — tier + vector titles + descriptions) + intensity
 * metrics + top axes (≤5) + low axes (≤3) + co-play partners (each with
 * their own top axes). The LLM receives both the intensity tier and the
 * vector titles so the prompt retains the full signal.
 */
export const TasteProfileContextSchema = z.object({
    userId: z.number().int(),
    username: z.string(),
    archetype: ArchetypeSchema,
    intensityMetrics: IntensityMetricsSchema,
    topAxes: z.array(TopAxisSchema).max(5),
    lowAxes: z.array(TopAxisSchema).max(3),
    coPlayPartners: z.array(CoPlayPartnerContextSchema).max(5),
});

export type TasteProfileContextDto = z.infer<typeof TasteProfileContextSchema>;

/**
 * Bundle returned by TasteProfileContextBuilder: resolved contexts plus
 * a list of user IDs that could not be resolved (missing vector, deleted
 * user, etc.).
 */
export const TasteProfileContextBundleSchema = z.object({
    contexts: z.array(TasteProfileContextSchema),
    missingUserIds: z.array(z.number().int()),
});

export type TasteProfileContextBundleDto = z.infer<
    typeof TasteProfileContextBundleSchema
>;
