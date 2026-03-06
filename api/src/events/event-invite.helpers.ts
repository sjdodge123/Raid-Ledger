/**
 * Helpers for member invitation to events.
 */
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { EventResponseDto } from '@raid-ledger/contract';
import type { NotificationService } from '../notifications/notification.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { MEMBER_INVITE_EVENTS } from '../discord-bot/discord-bot.constants';
import type { MemberInviteCreatedPayload } from '../discord-bot/discord-bot.constants';

type UserBasic = { id: number; username: string };

/** Finds a registered user by Discord ID or throws. */
export async function findUserByDiscordId(
  db: PostgresJsDatabase<typeof schema>,
  discordId: string,
): Promise<UserBasic> {
  const [user] = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  if (!user) {
    throw new NotFoundException(
      'No registered user found with that Discord ID',
    );
  }
  return user;
}

/** Checks that the user is not already signed up for the event. */
export async function assertNotSignedUp(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  user: UserBasic,
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.eventSignups.id })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, user.id),
      ),
    );
  if (existing) {
    throw new BadRequestException(
      `${user.username} is already signed up for this event`,
    );
  }
}

/** Looks up the inviter's username. */
export async function getInviterUsername(
  db: PostgresJsDatabase<typeof schema>,
  inviterId: number,
): Promise<string> {
  const [inviter] = await db
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, inviterId))
    .limit(1);
  return inviter?.username ?? 'Someone';
}

/** Creates the invite notification and emits a Discord event if needed. */
export async function emitMemberInvite(
  notificationService: NotificationService,
  eventEmitter: EventEmitter2,
  event: EventResponseDto,
  eventId: number,
  targetUser: UserBasic,
  inviterName: string,
  discordId: string,
): Promise<void> {
  const notification = await notificationService.create({
    userId: targetUser.id,
    type: 'new_event',
    title: 'Event Invitation',
    message: `${inviterName} invited you to "${event.title}"`,
    payload: { eventId, invitedBy: inviterName },
    skipDiscord: true,
  });
  if (notification) {
    eventEmitter.emit(MEMBER_INVITE_EVENTS.CREATED, {
      eventId,
      targetDiscordId: discordId,
      notificationId: notification.id,
      gameId: event.game?.id ?? null,
    } satisfies MemberInviteCreatedPayload);
  }
}
