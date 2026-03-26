/**
 * Cancel/status flow helpers for SignupsService.
 * Contains signup cancellation, status update, and slot backfill logic.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, ne } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { Tx } from './signups.service.types';
import { determineCancelStatus } from './signups-roster.helpers';

export async function fetchEventOrThrow(db: Tx, eventId: number) {
  const [eventRow] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!eventRow)
    throw new NotFoundException(`Event with ID ${eventId} not found`);
  assertEventAcceptingSignups(eventRow);
  return eventRow;
}

/**
 * Validate that an event is still accepting signups.
 * Throws ConflictException if the event is cancelled, explicitly ended,
 * or its effective end time has elapsed.
 */
export function assertEventAcceptingSignups(
  event: typeof schema.events.$inferSelect,
): void {
  if (event.cancelledAt) {
    throw new ConflictException(
      'This event has been cancelled and is no longer accepting signups.',
    );
  }
  if (event.adHocStatus === 'ended') {
    throw new ConflictException(
      'This event has ended and is no longer accepting signups.',
    );
  }
  const effectiveEnd = event.extendedUntil ?? event.duration?.[1];
  if (effectiveEnd && effectiveEnd < new Date()) {
    throw new ConflictException(
      'This event has ended and is no longer accepting signups.',
    );
  }
}

export async function resolveCancelStatus(db: Tx, eventId: number) {
  const [event] = await db
    .select({ duration: schema.events.duration })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return determineCancelStatus(event?.duration as [Date, Date] | null);
}

export async function findAssignmentForSignup(db: Tx, signupId: number) {
  const [assignment] = await db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signupId))
    .limit(1);
  return assignment ?? null;
}

export async function findActiveSignupForCancel(
  db: Tx,
  eventId: number,
  userId: number,
) {
  const [directSignup] = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
        ne(schema.eventSignups.status, 'roached_out'),
        ne(schema.eventSignups.status, 'declined'),
        ne(schema.eventSignups.status, 'departed'),
      ),
    )
    .limit(1);

  const signup =
    directSignup ?? (await findUnclaimedAnonymousSignup(db, eventId, userId));
  if (!signup)
    throw new NotFoundException(
      `Signup not found for user ${userId} on event ${eventId}`,
    );
  return signup;
}

async function findUnclaimedAnonymousSignup(
  db: Tx,
  eventId: number,
  userId: number,
) {
  const [user] = await db
    .select({ discordId: schema.users.discordId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user?.discordId) return undefined;
  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.discordUserId, user.discordId),
        ne(schema.eventSignups.status, 'roached_out'),
        ne(schema.eventSignups.status, 'declined'),
        ne(schema.eventSignups.status, 'departed'),
      ),
    )
    .limit(1);
  return signup;
}

export async function executeCancelSignup(
  db: Tx,
  signupId: number,
  assignment: typeof schema.rosterAssignments.$inferSelect | undefined,
  cancelStatus: string,
  isGracefulDecline: boolean,
  now: Date,
): Promise<void> {
  if (assignment) {
    await db
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, signupId));
  }
  await db
    .update(schema.eventSignups)
    .set({
      status: cancelStatus,
      roachedOutAt: isGracefulDecline ? null : now,
    })
    .where(eq(schema.eventSignups.id, signupId));
}

export async function gatherCancelNotifyData(
  db: Tx,
  eventId: number,
  userId: number,
) {
  const [[evt], [user]] = await Promise.all([
    db
      .select({
        creatorId: schema.events.creatorId,
        title: schema.events.title,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1),
    db
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1),
  ]);
  return {
    creatorId: evt.creatorId,
    eventTitle: evt.title,
    displayName: user?.username ?? 'Unknown',
  };
}

export async function fetchAndVerifySignup(
  db: Tx,
  eventId: number,
  signupId: number,
  userId: number,
) {
  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.id, signupId),
        eq(schema.eventSignups.eventId, eventId),
      ),
    )
    .limit(1);
  if (!signup)
    throw new NotFoundException(
      `Signup ${signupId} not found for event ${eventId}`,
    );
  if (signup.userId !== userId)
    throw new ForbiddenException('You can only confirm your own signup');
  return signup;
}

export async function verifyCharacterOwnership(
  db: Tx,
  characterId: string,
  userId: number,
) {
  const [character] = await db
    .select()
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.id, characterId),
        eq(schema.characters.userId, userId),
      ),
    )
    .limit(1);
  if (!character)
    throw new BadRequestException(
      'Character not found or does not belong to you',
    );
  return character;
}

export async function fetchUserById(db: Tx, userId: number) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user;
}

export async function getCharacterById(
  db: Tx,
  characterId: string,
): Promise<typeof schema.characters.$inferSelect | null> {
  const [character] = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, characterId))
    .limit(1);
  return character ?? null;
}

export async function findSignupByIdentifier(
  db: Tx,
  eventId: number,
  identifier: { userId?: number; discordUserId?: string },
) {
  const conditions = [eq(schema.eventSignups.eventId, eventId)];
  if (identifier.userId)
    conditions.push(eq(schema.eventSignups.userId, identifier.userId));
  else if (identifier.discordUserId)
    conditions.push(
      eq(schema.eventSignups.discordUserId, identifier.discordUserId),
    );
  else
    throw new BadRequestException(
      'Either userId or discordUserId must be provided',
    );
  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(and(...conditions))
    .limit(1);
  if (!signup) throw new NotFoundException('Signup not found');
  return signup;
}

export async function verifyAdminPermission(
  db: Tx,
  eventId: number,
  requesterId: number,
  isAdmin: boolean,
  action = 'remove users from an event',
) {
  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) throw new NotFoundException(`Event with ID ${eventId} not found`);
  if (event.creatorId !== requesterId && !isAdmin) {
    throw new ForbiddenException(
      `Only event creator, admin, or operator can ${action}`,
    );
  }
  return event;
}

export async function findSignupForEvent(
  db: Tx,
  eventId: number,
  signupId: number,
) {
  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.id, signupId),
        eq(schema.eventSignups.eventId, eventId),
      ),
    )
    .limit(1);
  if (!signup)
    throw new NotFoundException(
      `Signup ${signupId} not found for event ${eventId}`,
    );
  return signup;
}

// Re-export cleanupMatchingPugSlots from signup-roster.helpers for backward compat
export { cleanupMatchingPugSlots } from './signup-roster.helpers';
