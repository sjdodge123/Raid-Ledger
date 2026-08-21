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
