/**
 * Banner helpers for the lineup Games-page banner (ROK-935).
 * Builds lightweight banner data for building/voting/decided lineups.
 */
import { and, desc, eq, inArray, or, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LineupBannerResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema';
import {
  findEntriesWithGames,
  countVotesPerGame,
  countDistinctVoters,
  findGameName,
} from './lineups-query.helpers';
import {
  countOwnersPerGame,
  countTotalMembers,
} from './lineups-enrichment.helpers';
import { loadInvitees } from './lineups-eligibility.helpers';
import { computeVotingEligibleCount } from './voting-eligibility.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Statuses eligible for the banner (not archived). */
const BANNER_STATUSES: LineupStatus[] = ['building', 'voting', 'decided'];

/** Banner-eligible entry shape. */
interface BannerEntry {
  gameId: number;
  gameName: string;
  gameCoverUrl: string | null;
}

/** Lineup shape used by buildBannerResponse. */
interface BannerLineup {
  id: number;
  title: string;
  description: string | null;
  status: string;
  targetDate: Date | null;
  phaseDeadline?: Date | null;
  /** ROK-1253: when set, lineup will auto-advance at this wall-clock time. */
  pendingAdvanceAt?: Date | null;
  decidedGameId: number | null;
  decidedGameName: string | null;
  visibility: 'public' | 'private';
  /** ROK-1302: terminal-at-decided flag for the game-detail banner copy. */
  includeSchedulingPhase?: boolean;
}

/** Largest id a Postgres int4 column can hold; a bigger value would 500. */
const MAX_INT4 = 2147483647;

/** The one SettingsService read the banner scope gate needs. */
export interface DemoModeReader {
  getDemoMode(): Promise<boolean>;
}

/**
 * Parse the `?lineupId=` banner scope (a smoke-test seam that pins the banner
 * to one spec's lineup). Returns undefined — i.e. the normal global banner —
 * unless env DEMO_MODE is 'true' and `raw` is a positive int4. This is only
 * the env half of the demo gate; `resolveBannerScope` adds the settings half.
 */
export function parseBannerScope(
  raw: unknown,
  demoMode: string | undefined = process.env.DEMO_MODE,
): number | undefined {
  if (demoMode !== 'true' || typeof raw !== 'string') return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n > 0 && n <= MAX_INT4 ? n : undefined;
}

/**
 * Resolve the banner scope behind the same two-key demo gate every demo-only
 * endpoint uses: env DEMO_MODE AND the `demo_mode` app setting. The settings
 * read (cached by SettingsService) only happens when a valid scope was sent,
 * so the normal unscoped banner request pays nothing for it.
 */
export async function resolveBannerScope(
  raw: unknown,
  settings: DemoModeReader,
  envDemoMode: string | undefined = process.env.DEMO_MODE,
): Promise<number | undefined> {
  const scope = parseBannerScope(raw, envDemoMode);
  if (scope === undefined) return undefined;
  return (await settings.getDemoMode()) ? scope : undefined;
}

/**
 * Find the most recent community lineup eligible for the banner.
 * Excludes standalone scheduling poll lineups (phaseDurationOverride.standalone).
 * A `scope` narrows to that one lineup: archived, standalone or missing
 * yields no row — it never falls back to the global banner.
 */
export function findBannerLineup(db: Db, scope?: number) {
  return db
    .select()
    .from(schema.communityLineups)
    .where(
      and(
        inArray(schema.communityLineups.status, BANNER_STATUSES),
        or(
          isNull(schema.communityLineups.phaseDurationOverride),
          sql`${schema.communityLineups.phaseDurationOverride}->>'standalone' IS NULL`,
        ),
        scope !== undefined ? eq(schema.communityLineups.id, scope) : undefined,
      ),
    )
    .orderBy(desc(schema.communityLineups.createdAt))
    .limit(1);
}

/**
 * Build the banner response DTO from pre-fetched data.
 * Returns null for archived lineups (shouldn't happen, but safe).
 */
/** Assemble full banner data for a lineup (extracted from service). */
export async function buildBannerData(
  db: Db,
  lineup: typeof schema.communityLineups.$inferSelect,
): Promise<LineupBannerResponseDto | null> {
  const entries = await findEntriesWithGames(db, lineup.id);
  const gameIds = entries.map((e) => e.gameId);
  const [ownerMap, voteMap, voterCount, totalMembers, decidedGame, invitees] =
    await Promise.all([
      countOwnersPerGame(db, gameIds),
      countVotesPerGame(db, lineup.id),
      countDistinctVoters(db, lineup.id),
      countTotalMembers(db),
      lineup.decidedGameId
        ? findGameName(db, lineup.decidedGameId)
        : Promise.resolve([]),
      // ROK-1348: private lineups must use the creator+invitees pool, not
      // the whole community, as the people-denominator. Public lineups never
      // need the invitee rows — skip the query on this hot path (reviewer low).
      lineup.visibility === 'private'
        ? loadInvitees(db, lineup.id)
        : Promise.resolve([]),
    ]);
  const vMap = new Map(voteMap.map((v) => [v.gameId, v.voteCount]));
  const votingEligibleCount = computeVotingEligibleCount(
    { createdBy: lineup.createdBy, visibility: lineup.visibility },
    invitees.map((id) => ({ id })),
    totalMembers,
  );
  const bannerEntries = entries.map((e) => ({
    gameId: e.gameId,
    gameName: e.gameName,
    gameCoverUrl: e.gameCoverUrl,
  }));
  const result = buildBannerResponse(
    { ...lineup, decidedGameName: decidedGame[0]?.name ?? null },
    bannerEntries,
    ownerMap,
    vMap,
    voterCount[0]?.total ?? 0,
    totalMembers,
    votingEligibleCount,
  );
  if (result) {
    result.tiebreakerActive = !!lineup.activeTiebreakerId;
  }
  return result;
}

export function buildBannerResponse(
  lineup: BannerLineup,
  entries: BannerEntry[],
  ownerMap: Map<number, number>,
  voteMap: Map<number, number>,
  totalVoters: number,
  totalMembers: number,
  votingEligibleCount: number,
): LineupBannerResponseDto | null {
  if (lineup.status === 'archived') return null;

  return {
    id: lineup.id,
    title: lineup.title,
    description: lineup.description ?? null,
    status: lineup.status as LineupBannerResponseDto['status'],
    targetDate: lineup.targetDate?.toISOString?.() ?? null,
    phaseDeadline: lineup.phaseDeadline?.toISOString?.() ?? null,
    // ROK-1253: banner countdown opts in to the grace stamp only (no
    // pause exposure for the lightweight Games-page hero).
    pendingAdvanceAt: lineup.pendingAdvanceAt?.toISOString?.() ?? null,
    entryCount: entries.length,
    totalVoters,
    totalMembers,
    // ROK-1348: people-denominator scoped to the lineup audience.
    votingEligibleCount,
    decidedGameName: lineup.decidedGameName ?? null,
    entries: entries.map((e) => ({
      gameId: e.gameId,
      gameName: e.gameName,
      gameCoverUrl: e.gameCoverUrl,
      ownerCount: ownerMap.get(e.gameId) ?? 0,
      voteCount: voteMap.get(e.gameId) ?? 0,
    })),
    tiebreakerActive: false,
    // ROK-1065: visibility surfaced to the banner so the UI can render a
    // private badge.
    visibility: lineup.visibility,
    // ROK-1302: lets the game-detail decided banner drop scheduling copy.
    includeSchedulingPhase: lineup.includeSchedulingPhase ?? true,
  };
}

/**
 * Resolve the Games-page banner end to end: pick the banner-eligible lineup
 * and shape its payload, or `null` when there is none. Extracted from
 * `LineupsService.findBanner` (ROK-1314) for the 300-line cap.
 */
export async function loadGamesPageBanner(
  db: Db,
  rawScope: unknown,
  settings: DemoModeReader,
): Promise<LineupBannerResponseDto | null> {
  const scope = await resolveBannerScope(rawScope, settings);
  const [lineup] = await findBannerLineup(db, scope);
  if (!lineup) return null;
  return buildBannerData(db, lineup);
}
