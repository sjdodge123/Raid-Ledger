/**
 * Event-level share invite links (ROK-1621).
 *
 * A share link's code lives on `events.invite_code`, so generating one creates
 * no roster occupant. The `pug_slots` row is materialised only when a guest
 * without a Discord account actually claims the link.
 */
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { validateEventAvailable } from './invite.helpers';

type EventRow = typeof schema.events.$inferSelect;
type Db = PostgresJsDatabase<typeof schema>;
export type ClaimRole = 'tank' | 'healer' | 'dps' | 'player';

/** Look up the event that owns a share invite code. */
export async function findEventByShareCode(
  db: Db,
  code: string,
): Promise<EventRow | null> {
  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.inviteCode, code))
    .limit(1);
  return event ?? null;
}

/** Look up a claimable event by share code, or throw the user-facing reason. */
export async function findShareEventOrThrow(
  db: Db,
  code: string,
): Promise<EventRow> {
  const event = await findEventByShareCode(db, code);
  if (!event) throw new NotFoundException('Invite not found');
  const unavailable = validateEventAvailable(event);
  if (unavailable) throw new BadRequestException(unavailable);
  return event;
}

/** Default role for a share-link claim when the claimant picked none. */
export function defaultShareClaimRole(event: {
  slotConfig: unknown;
}): ClaimRole {
  const slotConfig = event.slotConfig as { type?: string } | null;
  return slotConfig?.type === 'mmo' ? 'dps' : 'player';
}

/**
 * Materialise the guest roster occupant for a share-link claim.
 * Only called for claimants with no linked Discord account — members get a
 * normal signup and never need a `pug_slots` row.
 */
export async function materialiseClaimedPugSlot(
  db: Db,
  event: { id: number; creatorId: number },
  userId: number,
  role: ClaimRole,
): Promise<void> {
  await db.insert(schema.pugSlots).values({
    eventId: event.id,
    role,
    status: 'claimed',
    claimedByUserId: userId,
    createdBy: event.creatorId,
  });
}
