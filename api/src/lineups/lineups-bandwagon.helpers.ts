/**
 * Bandwagon join and match advance helpers (ROK-937).
 * Handles post-decided match membership and promotion.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { BandwagonJoinResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { findLineupById } from './lineups-query.helpers';
import {
  findMatchById,
  findExistingMatchMember,
  countMatchMembers,
} from './lineups-match-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Validate the lineup is in decided status. */
async function validateDecidedLineup(db: Db, lineupId: number) {
  const [lineup] = await findLineupById(db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');
  if (lineup.status !== 'decided') {
    throw new BadRequestException('Lineup must be in decided status');
  }
  return lineup;
}

/** Validate match exists and belongs to the lineup. */
async function validateMatchBelongsToLineup(
  db: Db,
  matchId: number,
  lineupId: number,
) {
  const [match] = await findMatchById(db, matchId);
  if (!match || match.lineupId !== lineupId) {
    throw new NotFoundException('Match not found');
  }
  return match;
}

/** Insert a bandwagon member row. */
async function insertBandwagonMember(db: Db, matchId: number, userId: number) {
  await db.insert(schema.communityLineupMatchMembers).values({
    matchId,
    userId,
    source: 'bandwagon',
  });
}

/** Derive the original total voters from stored match data. */
function deriveOriginalTotal(
  match: typeof schema.communityLineupMatches.$inferSelect,
): number {
  const pct = match.votePercentage ? Number(match.votePercentage) : 0;
  if (pct <= 0) return 0;
  return Math.round((match.voteCount * 100) / pct);
}

/** Check and apply auto-promotion if threshold is reached. */
async function checkAutoPromote(
  db: Db,
  match: typeof schema.communityLineupMatches.$inferSelect,
  threshold: number,
): Promise<{ promoted: boolean; newMemberCount: number }> {
  const [countRow] = await countMatchMembers(db, match.id);
  const newMemberCount = countRow?.count ?? 0;
  const totalVoters = deriveOriginalTotal(match);

  if (totalVoters === 0) return { promoted: false, newMemberCount };
  const pct = (newMemberCount / totalVoters) * 100;
  const shouldPromote = pct >= threshold && match.status === 'suggested';

  if (shouldPromote) {
    await promoteMatch(db, match.id);
  }

  return { promoted: shouldPromote, newMemberCount };
}

/** Promote a match to scheduling status. */
async function promoteMatch(db: Db, matchId: number) {
  await db
    .update(schema.communityLineupMatches)
    .set({ status: 'scheduling', thresholdMet: true })
    .where(eq(schema.communityLineupMatches.id, matchId));
}

/** Execute a bandwagon join for a match. */
export async function executeBandwagonJoin(
  db: Db,
  lineupId: number,
  matchId: number,
  userId: number,
): Promise<BandwagonJoinResponseDto> {
  const lineup = await validateDecidedLineup(db, lineupId);
  const match = await validateMatchBelongsToLineup(db, matchId, lineupId);

  const [existing] = await findExistingMatchMember(db, matchId, userId);
  if (existing) {
    throw new ConflictException('Already a member of this match');
  }

  await insertBandwagonMember(db, matchId, userId);
  const threshold = lineup.matchThreshold ?? 35;
  const { promoted, newMemberCount } = await checkAutoPromote(
    db,
    match,
    threshold,
  );

  return { matchId, promoted, newMemberCount };
}

/** Advance a suggested match to scheduling (operator action). */
export async function advanceMatch(
  db: Db,
  lineupId: number,
  matchId: number,
): Promise<{ promoted: boolean }> {
  const match = await validateMatchBelongsToLineup(db, matchId, lineupId);
  if (match.status !== 'suggested') {
    throw new BadRequestException('Match must be in suggested status');
  }

  await promoteMatch(db, matchId);
  return { promoted: true };
}
