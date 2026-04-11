/**
 * Banner helpers for the lineup Games-page banner (ROK-935).
 * Builds lightweight banner data for building/voting/decided lineups.
 */
import { and, desc, inArray, or, isNull, sql } from 'drizzle-orm';
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
  status: string;
  targetDate: Date | null;
  phaseDeadline?: Date | null;
  decidedGameId: number | null;
  decidedGameName: string | null;
}

/**
 * Find the most recent community lineup eligible for the banner.
 * Excludes standalone scheduling poll lineups (phaseDurationOverride.standalone).
 */
export function findBannerLineup(db: Db) {
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
  const [ownerMap, voteMap, voterCount, totalMembers, decidedGame] =
    await Promise.all([
      countOwnersPerGame(db, gameIds),
      countVotesPerGame(db, lineup.id),
      countDistinctVoters(db, lineup.id),
      countTotalMembers(db),
      lineup.decidedGameId
        ? findGameName(db, lineup.decidedGameId)
        : Promise.resolve([]),
    ]);
  const vMap = new Map(voteMap.map((v) => [v.gameId, v.voteCount]));
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
): LineupBannerResponseDto | null {
  if (lineup.status === 'archived') return null;

  return {
    id: lineup.id,
    status: lineup.status as LineupBannerResponseDto['status'],
    targetDate: lineup.targetDate?.toISOString?.() ?? null,
    phaseDeadline: lineup.phaseDeadline?.toISOString?.() ?? null,
    entryCount: entries.length,
    totalVoters,
    totalMembers,
    decidedGameName: lineup.decidedGameName ?? null,
    entries: entries.map((e) => ({
      gameId: e.gameId,
      gameName: e.gameName,
      gameCoverUrl: e.gameCoverUrl,
      ownerCount: ownerMap.get(e.gameId) ?? 0,
      voteCount: voteMap.get(e.gameId) ?? 0,
    })),
    tiebreakerActive: false,
  };
}
