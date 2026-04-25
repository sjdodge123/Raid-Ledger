import { Logger } from '@nestjs/common';
import { lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CommunityChurnResponseDto,
  CommunityEngagementResponseDto,
  CommunityRadarResponseDto,
  CommunitySocialGraphResponseDto,
  CommunityTemporalResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { SETTING_KEYS } from '../../drizzle/schema';
import type { SettingsService } from '../../settings/settings.service';
import type { ChurnDetectionService } from '../churn-detection.service';
import type { CliqueDetectionService } from '../clique-detection.service';
import type { KeyInsightsService } from '../key-insights.service';
import { buildChurnSection } from './churn-section';
import { buildEngagementSection } from './engagement-section';
import { buildKeyInsightsSection } from './key-insights-section';
import { buildRadarSection } from './radar-section';
import { buildSocialGraphSection } from './social-graph-section';
import { buildTemporalSection } from './temporal-section';

type Db = PostgresJsDatabase<typeof schema>;

type SectionId = 'radar' | 'engagement' | 'churn' | 'social-graph' | 'temporal';

export interface RefreshSnapshotDeps {
  settings: SettingsService;
  churn: ChurnDetectionService;
  clique: CliqueDetectionService;
  keyInsights: KeyInsightsService;
  logger?: Logger;
}

export interface RefreshSnapshotResult {
  snapshotDate: string;
}

const DEFAULT_CHURN_THRESHOLD = 70;
const DEFAULT_BASELINE_WEEKS = 12;
const DEFAULT_RECENT_WEEKS = 4;
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Orchestrates the nightly snapshot build. Uses `Promise.allSettled` so
 * a single failing section substitutes an error payload rather than
 * blanking the whole row. Upsert + retention cleanup run only after at
 * least one section succeeds.
 */
export async function runRefreshSnapshot(
  db: Db,
  deps: RefreshSnapshotDeps,
): Promise<RefreshSnapshotResult> {
  const logger = deps.logger ?? new Logger('runRefreshSnapshot');
  const cfg = await loadConfig(deps.settings);
  const snapshotDate = todayUtcIso();
  const results = await runAllSections(db, deps, snapshotDate, cfg.churn);
  throwIfAllRejected(results);
  const sections = materializeSections(
    results,
    snapshotDate,
    cfg.churn,
    logger,
  );
  const keyInsights = buildKeyInsightsSection(
    deps.keyInsights,
    snapshotDate,
    sections,
  );
  await upsertSnapshot(db, snapshotDate, { ...sections, keyInsights });
  await pruneOlderThan(db, cfg.retentionDays);
  return { snapshotDate };
}

async function runAllSections(
  db: Db,
  deps: RefreshSnapshotDeps,
  snapshotDate: string,
  churn: ChurnSettings,
): Promise<SectionResults> {
  const [radar, engagement, churnR, social, temporal] =
    await Promise.allSettled([
      buildRadarSection(db, snapshotDate),
      buildEngagementSection(db, snapshotDate),
      buildChurnSection(db, snapshotDate, deps.churn, churn),
      buildSocialGraphSection(db, snapshotDate, deps.clique),
      buildTemporalSection(db, snapshotDate),
    ]);
  return { radar, engagement, churn: churnR, social, temporal };
}

function throwIfAllRejected(r: SectionResults): void {
  const all = [r.radar, r.engagement, r.churn, r.social, r.temporal];
  if (all.every((x) => x.status === 'rejected')) {
    const msg = all
      .map((x) => (x.status === 'rejected' ? String(x.reason) : ''))
      .filter(Boolean)
      .join('; ');
    throw new Error(
      `community-insights refresh: every section failed — ${msg}`,
    );
  }
}

function materializeSections(
  r: SectionResults,
  snapshotDate: string,
  churn: ChurnSettings,
  logger: Logger,
) {
  return {
    radar: settledRadar(r.radar, snapshotDate, logger),
    engagement: settledEngagement(r.engagement, snapshotDate, logger),
    churn: settledChurn(r.churn, snapshotDate, churn, logger),
    socialGraph: settledSocial(r.social, snapshotDate, logger),
    temporal: settledTemporal(r.temporal, snapshotDate, logger),
  };
}

function logSectionFailure(
  logger: Logger,
  section: SectionId,
  reason: unknown,
): void {
  logger.error(
    `community-insights ${section} section failed`,
    reason instanceof Error ? reason.stack : String(reason),
  );
}

type ChurnSettings = {
  thresholdPct: number;
  baselineWeeks: number;
  recentWeeks: number;
};

interface SectionResults {
  radar: PromiseSettledResult<CommunityRadarResponseDto>;
  engagement: PromiseSettledResult<CommunityEngagementResponseDto>;
  churn: PromiseSettledResult<CommunityChurnResponseDto>;
  social: PromiseSettledResult<CommunitySocialGraphResponseDto>;
  temporal: PromiseSettledResult<CommunityTemporalResponseDto>;
}

interface SnapshotPayloads {
  radar: CommunityRadarResponseDto;
  engagement: CommunityEngagementResponseDto;
  churn: CommunityChurnResponseDto;
  socialGraph: CommunitySocialGraphResponseDto;
  temporal: CommunityTemporalResponseDto;
  keyInsights: ReturnType<typeof buildKeyInsightsSection>;
}

function toColumnValues(p: SnapshotPayloads) {
  return {
    radarPayload: p.radar,
    engagementPayload: p.engagement,
    churnPayload: p.churn,
    socialGraphPayload: p.socialGraph,
    temporalPayload: p.temporal,
    keyInsightsPayload: p.keyInsights,
  };
}

async function upsertSnapshot(
  db: Db,
  snapshotDate: string,
  payloads: SnapshotPayloads,
): Promise<void> {
  const values = toColumnValues(payloads);
  await db
    .insert(schema.communityInsightsSnapshots)
    .values({ snapshotDate, ...values })
    .onConflictDoUpdate({
      target: schema.communityInsightsSnapshots.snapshotDate,
      set: { ...values, createdAt: new Date() },
    });
}

function settledRadar(
  r: PromiseSettledResult<CommunityRadarResponseDto>,
  snapshotDate: string,
  logger: Logger,
): CommunityRadarResponseDto {
  if (r.status === 'fulfilled') return r.value;
  logSectionFailure(logger, 'radar', r.reason);
  return {
    snapshotDate,
    axes: [],
    archetypes: [],
    driftSeries: [],
    dominantArchetype: null,
  };
}

function settledEngagement(
  r: PromiseSettledResult<CommunityEngagementResponseDto>,
  snapshotDate: string,
  logger: Logger,
): CommunityEngagementResponseDto {
  if (r.status === 'fulfilled') return r.value;
  logSectionFailure(logger, 'engagement', r.reason);
  return { snapshotDate, weeklyActiveUsers: [], intensityHistogram: [] };
}

function settledChurn(
  r: PromiseSettledResult<CommunityChurnResponseDto>,
  snapshotDate: string,
  settings: {
    thresholdPct: number;
    baselineWeeks: number;
    recentWeeks: number;
  },
  logger: Logger,
): CommunityChurnResponseDto {
  if (r.status === 'fulfilled') return r.value;
  logSectionFailure(logger, 'churn', r.reason);
  return {
    snapshotDate,
    thresholdPct: settings.thresholdPct,
    baselineWeeks: settings.baselineWeeks,
    recentWeeks: settings.recentWeeks,
    notEnoughHistory: false,
    atRisk: [],
    candidates: [],
  };
}

function settledSocial(
  r: PromiseSettledResult<CommunitySocialGraphResponseDto>,
  snapshotDate: string,
  logger: Logger,
): CommunitySocialGraphResponseDto {
  if (r.status === 'fulfilled') return r.value;
  logSectionFailure(logger, 'social-graph', r.reason);
  return {
    snapshotDate,
    nodes: [],
    edges: [],
    cliques: [],
    tasteLeaders: [],
  };
}

function settledTemporal(
  r: PromiseSettledResult<CommunityTemporalResponseDto>,
  snapshotDate: string,
  logger: Logger,
): CommunityTemporalResponseDto {
  if (r.status === 'fulfilled') return r.value;
  logSectionFailure(logger, 'temporal', r.reason);
  return { snapshotDate, heatmap: [], peakHours: [] };
}

async function loadConfig(settings: SettingsService): Promise<{
  churn: {
    thresholdPct: number;
    baselineWeeks: number;
    recentWeeks: number;
  };
  retentionDays: number;
}> {
  const [threshold, baseline, recent, retention] = await Promise.all([
    settings.get(SETTING_KEYS.COMMUNITY_INSIGHTS_CHURN_THRESHOLD_PCT),
    settings.get(SETTING_KEYS.COMMUNITY_INSIGHTS_BASELINE_WEEKS),
    settings.get(SETTING_KEYS.COMMUNITY_INSIGHTS_RECENT_WEEKS),
    settings.get(SETTING_KEYS.COMMUNITY_INSIGHTS_SNAPSHOT_RETENTION_DAYS),
  ]);
  return {
    churn: {
      thresholdPct: parseNum(threshold, DEFAULT_CHURN_THRESHOLD),
      baselineWeeks: parseNum(baseline, DEFAULT_BASELINE_WEEKS),
      recentWeeks: parseNum(recent, DEFAULT_RECENT_WEEKS),
    },
    retentionDays: parseNum(retention, DEFAULT_RETENTION_DAYS),
  };
}

function parseNum(raw: string | null, fallback: number): number {
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function pruneOlderThan(db: Db, retentionDays: number): Promise<void> {
  const cutoff = sql`(now() - (${retentionDays}::int * interval '1 day'))::date`;
  await db
    .delete(schema.communityInsightsSnapshots)
    .where(lt(schema.communityInsightsSnapshots.snapshotDate, cutoff));
}
