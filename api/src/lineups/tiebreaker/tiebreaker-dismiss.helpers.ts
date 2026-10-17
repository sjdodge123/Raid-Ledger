/**
 * Tiebreaker dismiss helpers (ROK-1262).
 *
 * Extracted so `tiebreaker.service.ts` stays under its 300-line cap while
 * the idempotent dismiss behavior (no tiebreaker row + ties → auto-pick
 * winner) lives close to the related detect logic.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { detectTies } from './tiebreaker-detect.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Resolve the winner for a "dismiss with no tiebreaker row" path.
 * Validates the lineup is in voting first (matches `findAndValidateLineup`
 * semantics), then picks the lowest-gameId tied entry — matches
 * `deriveTopVotedGame`'s deterministic tiebreaker (`a.gameId - b.gameId`).
 * Throws 404 if the lineup is missing, 400 if not voting or no ties.
 */
export async function pickDismissWinner(
  db: Db,
  lineupId: number,
): Promise<number> {
  const [lineup] = await db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!lineup) throw new NotFoundException('Lineup not found');
  if (lineup.status !== 'voting') {
    throw new BadRequestException('Lineup must be in voting status');
  }
  const ties = await detectTies(db, lineupId);
  if (!ties) throw new BadRequestException('No ties to dismiss');
  return Math.min(...ties.tiedGameIds);
}
