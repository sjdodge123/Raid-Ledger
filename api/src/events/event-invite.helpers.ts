/**
 * Helpers for member invitation to events.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { EventResponseDto } from '@raid-ledger/contract';
import type { NotificationService } from '../notifications/notification.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { MEMBER_INVITE_EVENTS } from '../discord-bot/discord-bot.constants';
import type { MemberInviteCreatedPayload } from '../discord-bot/discord-bot.constants';
import { isEventSignup } from '../guilds/forum/event-discussion/event-discussion.queries';
import { canManageEvent } from './pugs-visibility.helpers';
import {
  assertEventOpenForInvites,
  MEMBER_INVITE_TITLE,
} from './event-invite-state.helpers';
import { claimMemberInvite } from './event-invite-claim.helpers';

export type UserBasic = { id: number; username: string };

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

/** True when the user already has a signup row for the event. */
export async function isSignedUp(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: schema.eventSignups.id })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .limit(1);
  return existing !== undefined;
}

/** Checks that the user is not already signed up for the event. */
export async function assertNotSignedUp(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  user: UserBasic,
): Promise<void> {
  if (await isSignedUp(db, eventId, user.id)) {
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

/** The 403 a caller gets when they may not invite members (ROK-2217). */
export const INVITE_MEMBER_FORBIDDEN_MESSAGE =
  'Only the event organizer, staff, or members signed up to this event can invite members';

/**
 * ROK-2217: managers (creator or operator/admin) may always invite members;
 * anyone else only while they hold a signed-up or tentative signup on the
 * event (the ROK-2226 writable-signup rule — declined/departed don't count).
 */
export async function assertCanInviteMembers(
  db: PostgresJsDatabase<typeof schema>,
  event: { id: number; creator: { id: number } },
  inviterId: number,
  isAdmin: boolean,
): Promise<void> {
  if (canManageEvent(event.creator.id, inviterId, isAdmin)) return;
  if (await isEventSignup(db, event.id, inviterId)) return;
  throw new ForbiddenException(INVITE_MEMBER_FORBIDDEN_MESSAGE);
}

/** Full invite flow: find user, check signup, send invite. */
export async function inviteMemberFlow(
  db: PostgresJsDatabase<typeof schema>,
  notificationService: NotificationService,
  eventEmitter: EventEmitter2,
  event: EventResponseDto,
  eventId: number,
  inviterId: number,
  discordId: string,
): Promise<{ message: string; targetUser: UserBasic; sent: boolean }> {
  const targetUser = await findUserByDiscordId(db, discordId);
  const inviterName = await getInviterUsername(db, inviterId);
  const sent = await inviteUserToEvent(
    db,
    notificationService,
    eventEmitter,
    event,
    eventId,
    inviterName,
    targetUser,
    discordId,
  );
  const message = sent
    ? `Invite sent to ${targetUser.username}`
    : `${targetUser.username} already has an invite to this event`;
  return { message, targetUser, sent };
}

/**
 * User-keyed invite (ROK-2215): refuses a user already signed up (400), then
 * creates the notification and emits the Discord DM event. ROK-2217: a user
 * who already holds an unanswered invite to this event is skipped (no second
 * DM) and the call resolves `false`; `true` means an invite went out. The
 * check and the insert are one locked claim (event-invite-claim.helpers.ts),
 * and the DM is emitted only after that claim has committed.
 */
export async function inviteUserToEvent(
  db: PostgresJsDatabase<typeof schema>,
  notificationService: NotificationService,
  eventEmitter: EventEmitter2,
  event: EventResponseDto,
  eventId: number,
  inviterName: string,
  targetUser: UserBasic,
  discordId: string,
): Promise<boolean> {
  await assertNotSignedUp(db, eventId, targetUser);
  const claim = await claimMemberInvite(db, notificationService, {
    eventId,
    userId: targetUser.id,
    inviterName,
    eventTitle: event.title,
  });
  if (!claim.claimed) return false;
  if (claim.notificationId) {
    emitInviteCreated(
      eventEmitter,
      event,
      eventId,
      discordId,
      claim.notificationId,
    );
  }
  return true;
}

/** Emits the event the Discord bot turns into the invite DM. */
function emitInviteCreated(
  eventEmitter: EventEmitter2,
  event: EventResponseDto,
  eventId: number,
  discordId: string,
  notificationId: string,
): void {
  eventEmitter.emit(MEMBER_INVITE_EVENTS.CREATED, {
    eventId,
    targetDiscordId: discordId,
    notificationId,
    gameId: event.game?.id ?? null,
  } satisfies MemberInviteCreatedPayload);
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
    title: MEMBER_INVITE_TITLE,
    message: `${inviterName} invited you to "${event.title}"`,
    payload: { eventId, invitedBy: inviterName },
    skipDiscord: true,
  });
  if (notification) {
    emitInviteCreated(eventEmitter, event, eventId, discordId, notification.id);
  }
}

/**
 * Service-level `inviteMember` orchestration (flow + success log). Extracted
 * from EventsService to keep that file under the 300-line limit.
 */
export async function inviteMemberToEvent(
  deps: {
    db: PostgresJsDatabase<typeof schema>;
    notificationService: NotificationService;
    eventEmitter: EventEmitter2;
    logger: Logger;
  },
  event: EventResponseDto,
  eventId: number,
  inviter: { id: number; isAdmin: boolean },
  discordId: string,
): Promise<{ message: string; alreadyInvited: boolean }> {
  await assertCanInviteMembers(deps.db, event, inviter.id, inviter.isAdmin);
  assertEventOpenForInvites(event);
  const inviterId = inviter.id;
  const result = await inviteMemberFlow(
    deps.db,
    deps.notificationService,
    deps.eventEmitter,
    event,
    eventId,
    inviterId,
    discordId,
  );
  deps.logger.log(
    `User ${inviterId} invited ${result.targetUser.username} to event ${eventId}`,
  );
  return { message: result.message, alreadyInvited: !result.sent };
}
