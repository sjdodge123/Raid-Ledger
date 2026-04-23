import { z } from 'zod';
import {
  TASTE_PROFILE_AXIS_POOL,
  ArchetypeSchema,
  IntensityTierSchema,
} from './taste-profile.schema.js';

// ============================================================
// Community Insights (ROK-1099)
// Operator-facing /insights hub — Community tab payloads produced by
// a nightly snapshot cron and surfaced through a facade service. All
// responses are read from the latest `community_insights_snapshots`
// row; per-section payloads match these shapes.
// ============================================================

// ─── Shared atoms ───────────────────────────────────────────

/**
 * One axis of the aggregate community radar — the mean score across all
 * players who have a current taste vector. Keyed by the full dynamic
 * axis pool (same as `TasteProfileDimensionsSchema`).
 */
export const CommunityTasteAxisSchema = z.object({
  axis: z.enum(TASTE_PROFILE_AXIS_POOL),
  meanScore: z.number(),
});

export type CommunityTasteAxisDto = z.infer<typeof CommunityTasteAxisSchema>;

/**
 * One bucket in the archetype distribution chart — (intensityTier,
 * optional vectorTitle) pair with a member count. `vectorTitle` is
 * null when the bucket represents a tier-only group (no title attached).
 */
export const ArchetypeDistributionEntrySchema = z.object({
  intensityTier: IntensityTierSchema,
  vectorTitle: z.string().nullable(),
  count: z.number().int(),
});

export type ArchetypeDistributionEntryDto = z.infer<
  typeof ArchetypeDistributionEntrySchema
>;

/**
 * One point in the 8-week taste-drift series — axis score averaged
 * across the community on a given week-start date.
 */
export const TasteDriftPointSchema = z.object({
  weekStart: z.string(),
  axis: z.enum(TASTE_PROFILE_AXIS_POOL),
  meanScore: z.number(),
});

export type TasteDriftPointDto = z.infer<typeof TasteDriftPointSchema>;

/**
 * Single point in the 12-week weekly-active-users trend.
 */
export const WeeklyActiveUsersPointSchema = z.object({
  weekStart: z.string(),
  activeUsers: z.number().int(),
});

export type WeeklyActiveUsersPointDto = z.infer<
  typeof WeeklyActiveUsersPointSchema
>;

/**
 * 10-bucket histogram entry for the weekly intensity (hours) distribution.
 * `bucketStart` / `bucketEnd` define the hours range for this bucket.
 */
export const IntensityHistogramBucketSchema = z.object({
  bucketStart: z.number(),
  bucketEnd: z.number(),
  userCount: z.number().int(),
});

export type IntensityHistogramBucketDto = z.infer<
  typeof IntensityHistogramBucketSchema
>;

/**
 * Per-user churn-risk candidate — baseline/recent weekly intensity plus
 * derived drop percentage. Stored in the snapshot with the full candidate
 * set so the read endpoint can filter by threshold without rebuilding.
 */
export const ChurnRiskEntrySchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  avatar: z.string().nullable(),
  baselineHours: z.number(),
  recentHours: z.number(),
  dropPct: z.number(),
});

export type ChurnRiskEntryDto = z.infer<typeof ChurnRiskEntrySchema>;

/**
 * Node in the co-play social graph. `cliqueId` is assigned by the
 * Louvain pass on the snapshot builder and is stable within a snapshot
 * (sort-ordered, see `dev-brief` Louvain stability note) but not across
 * snapshots.
 */
export const SocialGraphNodeSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  avatar: z.string().nullable(),
  intensityTier: IntensityTierSchema,
  cliqueId: z.number().int(),
  degree: z.number().int(),
});

export type SocialGraphNodeDto = z.infer<typeof SocialGraphNodeSchema>;

/**
 * Edge in the co-play graph — weight is session count between the pair.
 */
export const SocialGraphEdgeSchema = z.object({
  sourceUserId: z.number().int(),
  targetUserId: z.number().int(),
  weight: z.number(),
});

export type SocialGraphEdgeDto = z.infer<typeof SocialGraphEdgeSchema>;

/**
 * Louvain community — sorted stably by member count desc then first
 * member id asc so snapshot diffs and tests are deterministic.
 */
export const CliqueSchema = z.object({
  cliqueId: z.number().int(),
  memberUserIds: z.array(z.number().int()),
});

export type CliqueDto = z.infer<typeof CliqueSchema>;

/**
 * Top influencer entry for the "taste leaders" panel. `metric` is the
 * ranking basis (`betweenness` or `degree` fallback) so the UI tooltip
 * can explain why this user ranked.
 */
export const TasteLeaderSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  avatar: z.string().nullable(),
  score: z.number(),
  metric: z.enum(['betweenness', 'degree']),
});

export type TasteLeaderDto = z.infer<typeof TasteLeaderSchema>;

/**
 * 7 weekdays × 24 hours grid cell — `activity` is session starts or
 * voice-join events in that bucket over the temporal window. `weekday`
 * follows ISO (1 = Monday, 7 = Sunday) to match Luxon / Postgres `isodow`.
 */
export const TemporalHeatmapCellSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
  activity: z.number().int(),
});

export type TemporalHeatmapCellDto = z.infer<typeof TemporalHeatmapCellSchema>;

/**
 * Peak-hour entry for the stacked bar chart — weekday + hour + count.
 */
export const PeakHourEntrySchema = z.object({
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
  activity: z.number().int(),
});

export type PeakHourEntryDto = z.infer<typeof PeakHourEntrySchema>;

// ─── Key Insights discriminated union ───────────────────────

export const GenreShiftInsightSchema = z.object({
  kind: z.literal('genre-shift'),
  axis: z.enum(TASTE_PROFILE_AXIS_POOL),
  deltaPct: z.number(),
  windowWeeks: z.number().int(),
  summary: z.string(),
});

export const CliqueEmergedInsightSchema = z.object({
  kind: z.literal('clique-emerged'),
  cliqueId: z.number().int(),
  memberCount: z.number().int(),
  summary: z.string(),
});

export const ChurnWarningInsightSchema = z.object({
  kind: z.literal('churn-warning'),
  atRiskCount: z.number().int(),
  thresholdPct: z.number(),
  summary: z.string(),
});

export const EngagementPeakInsightSchema = z.object({
  kind: z.literal('engagement-peak'),
  weekStart: z.string(),
  activeUsers: z.number().int(),
  summary: z.string(),
});

export const TasteLeaderValidationInsightSchema = z.object({
  kind: z.literal('taste-leader-validation'),
  userId: z.number().int(),
  username: z.string(),
  summary: z.string(),
});

/**
 * Discriminated union by `kind` — rule-based narration entries produced
 * by the `KeyInsightsService`. Deferred LLM variant is out of scope.
 */
export const KeyInsightSchema = z.discriminatedUnion('kind', [
  GenreShiftInsightSchema,
  CliqueEmergedInsightSchema,
  ChurnWarningInsightSchema,
  EngagementPeakInsightSchema,
  TasteLeaderValidationInsightSchema,
]);

export type KeyInsightDto = z.infer<typeof KeyInsightSchema>;

// ─── Query-param schemas ────────────────────────────────────

export const CommunityChurnQuerySchema = z.object({
  thresholdPct: z.coerce.number().min(1).max(100).optional(),
});

export type CommunityChurnQueryDto = z.infer<
  typeof CommunityChurnQuerySchema
>;

export const CommunitySocialGraphQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  minWeight: z.coerce.number().min(0).max(0.99).optional(),
});

export type CommunitySocialGraphQueryDto = z.infer<
  typeof CommunitySocialGraphQuerySchema
>;

// ─── Response shapes ────────────────────────────────────────

export const CommunityRadarResponseSchema = z.object({
  snapshotDate: z.string(),
  axes: z.array(CommunityTasteAxisSchema),
  archetypes: z.array(ArchetypeDistributionEntrySchema),
  driftSeries: z.array(TasteDriftPointSchema),
  dominantArchetype: ArchetypeSchema.nullable(),
});

export type CommunityRadarResponseDto = z.infer<
  typeof CommunityRadarResponseSchema
>;

export const CommunityEngagementResponseSchema = z.object({
  snapshotDate: z.string(),
  weeklyActiveUsers: z.array(WeeklyActiveUsersPointSchema),
  intensityHistogram: z.array(IntensityHistogramBucketSchema),
});

export type CommunityEngagementResponseDto = z.infer<
  typeof CommunityEngagementResponseSchema
>;

export const CommunityChurnResponseSchema = z.object({
  snapshotDate: z.string(),
  thresholdPct: z.number(),
  baselineWeeks: z.number().int(),
  recentWeeks: z.number().int(),
  notEnoughHistory: z.boolean(),
  atRisk: z.array(ChurnRiskEntrySchema),
  candidates: z.array(ChurnRiskEntrySchema),
});

export type CommunityChurnResponseDto = z.infer<
  typeof CommunityChurnResponseSchema
>;

export const CommunitySocialGraphResponseSchema = z.object({
  snapshotDate: z.string(),
  nodes: z.array(SocialGraphNodeSchema),
  edges: z.array(SocialGraphEdgeSchema),
  cliques: z.array(CliqueSchema),
  tasteLeaders: z.array(TasteLeaderSchema),
});

export type CommunitySocialGraphResponseDto = z.infer<
  typeof CommunitySocialGraphResponseSchema
>;

export const CommunityTemporalResponseSchema = z.object({
  snapshotDate: z.string(),
  heatmap: z.array(TemporalHeatmapCellSchema),
  peakHours: z.array(PeakHourEntrySchema),
});

export type CommunityTemporalResponseDto = z.infer<
  typeof CommunityTemporalResponseSchema
>;

export const CommunityKeyInsightsResponseSchema = z.object({
  snapshotDate: z.string(),
  insights: z.array(KeyInsightSchema),
});

export type CommunityKeyInsightsResponseDto = z.infer<
  typeof CommunityKeyInsightsResponseSchema
>;

export const CommunityRefreshResponseSchema = z.object({
  enqueued: z.literal(true),
  jobId: z.string(),
});

export type CommunityRefreshResponseDto = z.infer<
  typeof CommunityRefreshResponseSchema
>;
