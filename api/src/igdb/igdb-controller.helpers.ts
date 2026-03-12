import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EventTypesResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/**
 * Handle errors from the game search endpoint.
 * Re-throws as appropriate NestJS HTTP exceptions.
 * @param error - The caught error
 * @param logger - Logger instance for IGDB errors
 * @throws BadRequestException for Zod validation failures
 * @throws InternalServerErrorException for IGDB API errors
 */
export function handleSearchError(error: unknown, logger: Logger): never {
  if (error instanceof Error && error.name === 'ZodError') {
    const messages = (error as ZodError).issues.map(
      (e) => `${e.path.join('.')}: ${e.message}`,
    );
    throw new BadRequestException({
      message: 'Validation failed',
      errors: messages,
    });
  }
  if (error instanceof Error && error.message.includes('IGDB')) {
    logger.error(`IGDB API error: ${error.message}`);
    throw new InternalServerErrorException(
      'Game search service temporarily unavailable',
    );
  }
  throw error;
}

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
