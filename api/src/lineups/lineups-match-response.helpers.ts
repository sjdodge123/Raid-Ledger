/**
 * Match response mapping helpers for decided view (ROK-937).
 * Groups matches into tiers and builds the grouped response.
 */
import { NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GroupedMatchesResponseDto,
  MatchDetailResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { findLineupById, countDistinctVoters } from './lineups-query.helpers';
import {
  findMatchesByLineup,
  findMatchMembers,
  type MatchMemberRow,
} from './lineups-match-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Classify a match into a display tier. */
export function classifyMatch(
  status: string,
  votePercentage: number,
  threshold: number,
): 'scheduling' | 'almostThere' | 'rallyYourCrew' {
  if (status === 'scheduling') return 'scheduling';
  const almostThreshold = threshold * 0.7;
  if (votePercentage >= almostThreshold) return 'almostThere';
  return 'rallyYourCrew';
}

/** Map a single member row to the response shape. */
function mapMemberRow(m: MatchMemberRow) {
  return {
    id: m.id,
    matchId: m.matchId,
    userId: m.userId,
    source: m.source as 'voted' | 'bandwagon',
    createdAt: m.createdAt.toISOString(),
    displayName: m.displayName,
  };
}

/** Map a raw match row + its members to a MatchDetailResponseDto. */
function mapMatchToDto(
  match: Awaited<ReturnType<typeof findMatchesByLineup>>[0],
  memberRows: MatchMemberRow[],
): MatchDetailResponseDto {
  const members = memberRows
    .filter((m) => m.matchId === match.id)
    .map(mapMemberRow);

  return {
    id: match.id,
    lineupId: match.lineupId,
    gameId: match.gameId,
    status: match.status,
    thresholdMet: match.thresholdMet,
    voteCount: match.voteCount,
    votePercentage: match.votePercentage ? Number(match.votePercentage) : null,
    fitType: match.fitType,
    linkedEventId: match.linkedEventId,
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
    gameName: match.gameName,
    gameCoverUrl: match.gameCoverUrl,
    members,
  };
}

/** Build the full grouped matches response for a lineup. */
export async function buildGroupedMatchesResponse(
  db: Db,
  lineupId: number,
): Promise<GroupedMatchesResponseDto> {
  const [lineup] = await findLineupById(db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');

  const threshold = lineup.matchThreshold ?? 35;

  const [matches, voterRows] = await Promise.all([
    findMatchesByLineup(db, lineupId),
    countDistinctVoters(db, lineupId),
  ]);

  const totalVoters = voterRows[0]?.total ?? 0;
  const matchIds = matches.map((m) => m.id);
  const matchMemberRows = await findMatchMembers(db, matchIds);

  return groupMatchesIntoTiers(
    matches,
    matchMemberRows,
    threshold,
    totalVoters,
  );
}

/** Group matches into scheduling/almostThere/rallyYourCrew tiers. */
function groupMatchesIntoTiers(
  matches: Awaited<ReturnType<typeof findMatchesByLineup>>,
  memberRows: MatchMemberRow[],
  threshold: number,
  totalVoters: number,
): GroupedMatchesResponseDto {
  const result: GroupedMatchesResponseDto = {
    scheduling: [],
    almostThere: [],
    rallyYourCrew: [],
    carriedForward: [],
    matchThreshold: threshold,
    totalVoters,
  };

  for (const match of matches) {
    const dto = mapMatchToDto(match, memberRows);
    const pct = match.votePercentage ? Number(match.votePercentage) : 0;
    const tier = classifyMatch(match.status, pct, threshold);
    result[tier].push(dto);
  }

  return result;
}
