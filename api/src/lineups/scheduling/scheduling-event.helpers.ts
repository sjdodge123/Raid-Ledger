/**
 * Event creation helpers for scheduling service (ROK-1031 refactor).
 * Extracted from scheduling.service.ts to stay within the 300-line limit.
 */
import { eq } from 'drizzle-orm';
import { NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CreateEventDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;
const FOUR_WEEKS_MS = 4 * 7 * 24 * 60 * 60 * 1000;

/** Look up a schedule slot by ID or throw. */
export async function findSlotOrThrow(db: Db, slotId: number) {
  const [slot] = await db
    .select()
    .from(schema.communityLineupScheduleSlots)
    .where(eq(schema.communityLineupScheduleSlots.id, slotId))
    .limit(1);
  if (!slot) throw new NotFoundException('Slot not found');
  return slot;
}

/** Resolve game name and cover URL from a game ID. */
export async function resolveGameInfo(db: Db, gameId: number) {
  const [game] = await db
    .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return {
    gameName: game?.name ?? 'Game Night',
    gameCoverUrl: game?.coverUrl ?? null,
  };
}

/** Build a CreateEventDto from scheduling slot data. */
export function buildCreateEventDto(
  title: string,
  gameId: number,
  proposedTime: Date | string,
  recurring: boolean,
): CreateEventDto {
  const startTime = new Date(proposedTime);
  const endTime = new Date(startTime.getTime() + EVENT_DURATION_MS);
  const base = {
    title,
    gameId,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };
  if (!recurring) return base;
  const until = new Date(startTime.getTime() + FOUR_WEEKS_MS);
  return {
    ...base,
    recurrence: { frequency: 'weekly' as const, until: until.toISOString() },
  };
}
