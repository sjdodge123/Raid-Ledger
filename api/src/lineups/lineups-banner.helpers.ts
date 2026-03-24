/**
 * Banner helpers for the lineup Games-page banner (ROK-935).
 * Builds lightweight banner data for building/voting/decided lineups.
 */
import { desc, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LineupBannerResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema';

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
 * Find the most recent lineup eligible for the banner.
 * Returns the newest building, voting, or decided lineup.
 */
export function findBannerLineup(db: Db) {
  return db
    .select()
    .from(schema.communityLineups)
    .where(inArray(schema.communityLineups.status, BANNER_STATUSES))
    .orderBy(desc(schema.communityLineups.createdAt))
    .limit(1);
}

/**
 * Build the banner response DTO from pre-fetched data.
 * Returns null for archived lineups (shouldn't happen, but safe).
 */
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
  };
}
