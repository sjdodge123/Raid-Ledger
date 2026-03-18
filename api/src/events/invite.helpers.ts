import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { ALL_WOW_GAME_SLUGS } from '../plugins/wow-common/manifest';

type SlotRow = typeof schema.pugSlots.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;

export async function findSlotByCode(
  db: PostgresJsDatabase<typeof schema>,
  code: string,
): Promise<SlotRow | null> {
  const [slot] = await db
    .select()
    .from(schema.pugSlots)
    .where(eq(schema.pugSlots.inviteCode, code))
    .limit(1);
  return slot ?? null;
}

export async function findEventForSlot(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<EventRow | null> {
  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
}

export function validateSlotNotClaimed(slot: SlotRow): string | null {
  if (slot.status === 'accepted' || slot.status === 'claimed') {
    return 'This invite has already been claimed';
  }
  return null;
}

export function validateEventAvailable(event: EventRow | null): string | null {
  if (!event) return 'Event not found';
  if (event.cancelledAt) return 'This event has been cancelled';
  if (event.duration[1] < new Date()) return 'This event has already ended';
  return null;
}

async function findGameRow(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
) {
  const [row] = await db
    .select({
      id: schema.games.id,
      name: schema.games.name,
      coverUrl: schema.games.coverUrl,
      hasRoles: schema.games.hasRoles,
      slug: schema.games.slug,
    })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return row ?? null;
}

export async function resolveGameInfo(
  db: PostgresJsDatabase<typeof schema>,
  event: EventRow,
  slotCreatedBy: number,
) {
  if (!event.gameId) return null;
  const gameRow = await findGameRow(db, event.gameId);
  if (!gameRow) return null;
  const isBlizzardGame = ALL_WOW_GAME_SLUGS.includes(gameRow.slug);
  const hints = isBlizzardGame
    ? await resolveBlizzardHints(db, event.gameId, slotCreatedBy)
    : { inviterRealm: null, gameVariant: null };
  return {
    name: gameRow.name,
    coverUrl: gameRow.coverUrl,
    hasRoles: gameRow.hasRoles,
    gameId: gameRow.id,
    isBlizzardGame,
    ...hints,
  };
}

/** Resolve Blizzard-specific hints for an invite from the game row. */
async function resolveBlizzardHints(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
  createdBy: number,
) {
  const [inviterChar] = await db
    .select({ realm: schema.characters.realm })
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.userId, createdBy),
        eq(schema.characters.gameId, gameId),
      ),
    )
    .limit(1);
  const [gameRow] = await db
    .select({ apiNamespacePrefix: schema.games.apiNamespacePrefix })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return {
    inviterRealm: inviterChar?.realm ?? null,
    gameVariant: gameRow?.apiNamespacePrefix ?? null,
  };
}

export async function findSlotOrThrow(
  db: PostgresJsDatabase<typeof schema>,
  code: string,
): Promise<SlotRow> {
  const slot = await findSlotByCode(db, code);
  if (!slot) throw new NotFoundException('Invite not found');
  if (slot.status === 'accepted' || slot.status === 'claimed') {
    throw new ConflictException('This invite has already been claimed');
  }
  return slot;
}

export async function findClaimEventOrThrow(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<EventRow> {
  const event = await findEventForSlot(db, eventId);
  if (!event || event.cancelledAt) {
    throw new BadRequestException('Event is not available');
  }
  if (event.duration[1] < new Date()) {
    throw new BadRequestException('This event has already ended');
  }
  return event;
}

export async function checkNotAlreadySignedUp(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  slotId: string,
): Promise<void> {
  const [existingSignup] = await db
    .select({ id: schema.eventSignups.id })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .limit(1);
  if (existingSignup) {
    await db.delete(schema.pugSlots).where(eq(schema.pugSlots.id, slotId));
    throw new ConflictException('You are already signed up for this event');
  }
}
