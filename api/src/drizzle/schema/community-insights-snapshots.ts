import {
  pgTable,
  uuid,
  date,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import type {
  CommunityRadarResponseDto,
  CommunityEngagementResponseDto,
  CommunityChurnResponseDto,
  CommunitySocialGraphResponseDto,
  CommunityTemporalResponseDto,
  CommunityKeyInsightsResponseDto,
} from '@raid-ledger/contract';

/**
 * Community Insights Snapshots (ROK-1099).
 *
 * One row per calendar day holding the six pre-computed community-tab
 * payloads. Refreshed nightly by `CommunityInsightsService.refreshSnapshot`
 * (06:30 UTC cron) and on-demand via `POST /insights/community/refresh`.
 * Reads always fetch the latest row; per-section payloads are JSONB
 * because they are written-whole once a day and read-whole per panel —
 * sub-table normalization would be premature.
 */
export const communityInsightsSnapshots = pgTable(
  'community_insights_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotDate: date('snapshot_date').notNull().unique(),
    radarPayload: jsonb('radar_payload')
      .$type<CommunityRadarResponseDto>()
      .notNull(),
    engagementPayload: jsonb('engagement_payload')
      .$type<CommunityEngagementResponseDto>()
      .notNull(),
    churnPayload: jsonb('churn_payload')
      .$type<CommunityChurnResponseDto>()
      .notNull(),
    socialGraphPayload: jsonb('social_graph_payload')
      .$type<CommunitySocialGraphResponseDto>()
      .notNull(),
    temporalPayload: jsonb('temporal_payload')
      .$type<CommunityTemporalResponseDto>()
      .notNull(),
    keyInsightsPayload: jsonb('key_insights_payload')
      .$type<CommunityKeyInsightsResponseDto>()
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_community_insights_snapshots_created_at').on(
      table.createdAt,
    ),
  }),
);
