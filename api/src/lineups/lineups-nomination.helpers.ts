/**
 * Nomination insertion helpers (ROK-935).
 * Extracted from LineupsService for the 300-line file limit.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { NominateGameDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { findGameName, countLineupEntries, countDistinctNominators } from './lineups-query.helpers';
import { nominationCap } from './common-ground-scoring.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** Enforce the dynamic nomination cap (base 20, +5 per unique participant). */
export async function validateNominationCap(
  db: Db,
  lineupId: number,
): Promise<void> {
  const [[entries], [nominators]] = await Promise.all([
    countLineupEntries(db, lineupId),
    countDistinctNominators(db, lineupId),
  ]);
  const cap = nominationCap(nominators?.count ?? 0);
  if (entries && entries.count >= cap) {
    throw new BadRequestException(`Lineup has reached the ${cap}-entry cap`);
  }
}

/** Validate that a game exists in the database. */
export async function validateGameExists(
  db: Db,
  gameId: number,
): Promise<void> {
  const [game] = await findGameName(db, gameId);
  if (!game) throw new NotFoundException('Game not found');
}

/** Check if a DB error is a unique constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  if (e.code === '23505') return true;
  if (e.cause && typeof e.cause === 'object') {
    return (e.cause as Record<string, unknown>).code === '23505';
  }
  return false;
}

/** Insert a nomination entry, handling duplicate conflicts. */
export async function insertNomination(
  db: Db,
  lineupId: number,
  dto: NominateGameDto,
  userId: number,
): Promise<void> {
  try {
    await db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId: dto.gameId,
      nominatedBy: userId,
      note: dto.note ?? null,
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new ConflictException('Game already nominated in this lineup');
    }
    throw err;
  }
}
