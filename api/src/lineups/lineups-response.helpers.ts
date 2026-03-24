/**
 * Lineup response mapping helpers (ROK-933/934/935).
 * Maps raw query results to LineupDetailResponseDto with enrichment.
 */
import type {
  LineupDetailResponseDto,
  LineupEntryResponseDto,
} from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { NotFoundException } from '@nestjs/common';
import * as schema from '../drizzle/schema';
import {
  findLineupById,
  findEntriesWithGames,
  countVotesPerGame,
  countDistinctVoters,
  findUserById,
  findGameName,
} from './lineups-query.helpers';
import {
  countOwnersPerGame,
  countWishlistPerGame,
  fetchPricingMetadata,
  countTotalMembers,
  type GamePricing,
} from './lineups-enrichment.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Enrichment maps passed through to entry mapping. */
interface EnrichmentMaps {
  ownerMap: Map<number, number>;
  wishlistMap: Map<number, number>;
  pricingMap: Map<number, GamePricing>;
  totalMembers: number;
}

/** Map a single entry row to the response shape with enrichment. */
function mapEntry(
  e: Awaited<ReturnType<typeof findEntriesWithGames>>[0],
  voteMap: Map<number, number>,
  enrichment: EnrichmentMaps,
): LineupEntryResponseDto {
  const ownerCount = enrichment.ownerMap.get(e.gameId) ?? 0;
  const pricing = enrichment.pricingMap.get(e.gameId);

  return {
    id: e.id,
    gameId: e.gameId,
    gameName: e.gameName,
    gameCoverUrl: e.gameCoverUrl,
    nominatedBy: { id: e.nominatedById, displayName: e.nominatedByName },
    note: e.note,
    carriedOver: e.carriedOverFrom !== null,
    voteCount: voteMap.get(e.gameId) ?? 0,
    createdAt: e.createdAt.toISOString(),
    ownerCount,
    totalMembers: enrichment.totalMembers,
    nonOwnerCount: enrichment.totalMembers - ownerCount,
    wishlistCount: enrichment.wishlistMap.get(e.gameId) ?? 0,
    itadCurrentPrice: pricing?.itadCurrentPrice ?? null,
    itadCurrentCut: pricing?.itadCurrentCut ?? null,
    itadCurrentShop: pricing?.itadCurrentShop ?? null,
    itadCurrentUrl: pricing?.itadCurrentUrl ?? null,
  };
}

/** Map raw query results to the detail response shape. */
function mapToDetailResponse(
  lineup: typeof schema.communityLineups.$inferSelect,
  entries: Awaited<ReturnType<typeof findEntriesWithGames>>,
  voteCounts: Awaited<ReturnType<typeof countVotesPerGame>>,
  voterCount: Awaited<ReturnType<typeof countDistinctVoters>>,
  creator: Awaited<ReturnType<typeof findUserById>>,
  decidedGame: Awaited<ReturnType<typeof findGameName>>,
  enrichment: EnrichmentMaps,
): LineupDetailResponseDto {
  const voteMap = new Map(voteCounts.map((v) => [v.gameId, v.voteCount]));
  return {
    id: lineup.id,
    status: lineup.status,
    targetDate: lineup.targetDate?.toISOString() ?? null,
    decidedGameId: lineup.decidedGameId,
    decidedGameName: decidedGame[0]?.name ?? null,
    linkedEventId: lineup.linkedEventId,
    createdBy: creator[0] ?? { id: lineup.createdBy, displayName: 'Unknown' },
    votingDeadline: lineup.votingDeadline?.toISOString() ?? null,
    phaseDeadline: lineup.phaseDeadline?.toISOString() ?? null,
    entries: entries.map((e) => mapEntry(e, voteMap, enrichment)),
    totalVoters: voterCount[0]?.total ?? 0,
    totalMembers: enrichment.totalMembers,
    createdAt: lineup.createdAt.toISOString(),
    updatedAt: lineup.updatedAt.toISOString(),
  };
}

/** Assemble the full detail response for a lineup. */
export async function buildDetailResponse(
  db: Db,
  lineupId: number,
): Promise<LineupDetailResponseDto> {
  const [lineup] = await findLineupById(db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');

  const [entries, voteCounts, voterCount, creator, decidedGame] =
    await Promise.all([
      findEntriesWithGames(db, lineupId),
      countVotesPerGame(db, lineupId),
      countDistinctVoters(db, lineupId),
      findUserById(db, lineup.createdBy),
      lineup.decidedGameId
        ? findGameName(db, lineup.decidedGameId)
        : Promise.resolve([]),
    ]);

  const gameIds = entries.map((e) => e.gameId);
  const [ownerMap, wishlistMap, pricingMap, totalMembers] = await Promise.all([
    countOwnersPerGame(db, gameIds),
    countWishlistPerGame(db, gameIds),
    fetchPricingMetadata(db, gameIds),
    countTotalMembers(db),
  ]);

  return mapToDetailResponse(
    lineup,
    entries,
    voteCounts,
    voterCount,
    creator,
    decidedGame,
    { ownerMap, wishlistMap, pricingMap, totalMembers },
  );
}
