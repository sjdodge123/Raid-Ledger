/**
 * Removal helpers for lineup nominations (ROK-935).
 * Extracted from LineupsService to stay under 300-line file limit.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as schema from '../drizzle/schema';
import type { CallerIdentity } from './lineups.service';

type Db = PostgresJsDatabase<typeof schema>;

/** Find an entry by lineup + game ID. Throws if not found. */
export async function findEntry(db: Db, lineupId: number, gameId: number) {
  const [entry] = await db
    .select()
    .from(schema.communityLineupEntries)
    .where(
      and(
        eq(schema.communityLineupEntries.lineupId, lineupId),
        eq(schema.communityLineupEntries.gameId, gameId),
      ),
    )
    .limit(1);

  if (!entry) throw new NotFoundException('Nomination not found');
  return entry;
}

/** Validate authorization and carried-over guard for removal. */
export function validateRemoval(
  entry: typeof schema.communityLineupEntries.$inferSelect,
  caller: CallerIdentity,
): void {
  if (entry.carriedOverFrom !== null) {
    throw new BadRequestException('Carried-over entries cannot be removed');
  }
  const isPrivileged = caller.role === 'operator' || caller.role === 'admin';
  if (entry.nominatedBy !== caller.id && !isPrivileged) {
    throw new ForbiddenException("Cannot remove another user's nomination");
  }
}

/** Delete a lineup entry by lineupId + gameId. */
export async function deleteEntry(
  db: Db,
  lineupId: number,
  gameId: number,
): Promise<void> {
  await db
    .delete(schema.communityLineupEntries)
    .where(
      and(
        eq(schema.communityLineupEntries.lineupId, lineupId),
        eq(schema.communityLineupEntries.gameId, gameId),
      ),
    );
}
