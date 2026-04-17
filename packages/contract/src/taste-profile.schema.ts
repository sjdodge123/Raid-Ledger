import { z } from 'zod';

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

export const TASTE_PROFILE_ARCHETYPES = [
  'Dedicated',
  'Specialist',
  'Explorer',
  'Social Drifter',
  'Casual',
] as const;

export type TasteProfileArchetype = (typeof TASTE_PROFILE_ARCHETYPES)[number];

export const TasteProfileDimensionsSchema = z.object({
  co_op: z.number(),
  pvp: z.number(),
  rpg: z.number(),
  survival: z.number(),
  strategy: z.number(),
  social: z.number(),
  mmo: z.number(),
});

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
