import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EventTypesResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/**
 * Fetch event types for a game. Throws NotFoundException if game not found.
 */
export async function fetchGameEventTypes(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
): Promise<EventTypesResponseDto> {
  const gameRows = await db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  if (gameRows.length === 0) throw new NotFoundException('Game not found');

  const game = gameRows[0];
  const types = await db
    .select()
    .from(schema.eventTypes)
    .where(eq(schema.eventTypes.gameId, gameId))
    .orderBy(schema.eventTypes.name);
  return {
    data: types.map((t) => ({
      ...t,
      defaultPlayerCap: t.defaultPlayerCap ?? null,
      defaultDurationMinutes: t.defaultDurationMinutes ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
    meta: { total: types.length, gameId: game.id, gameName: game.name },
  };
}
