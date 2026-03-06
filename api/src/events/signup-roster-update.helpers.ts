import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { NotificationService } from '../notifications/notification.service';
import {
  notifyRoleChanges,
  notifyNewAssignments,
} from './signup-notifications.helpers';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot/discord-bot.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { UpdateRosterDto } from '@raid-ledger/contract';

const logger = new Logger('SignupRosterUpdate');

type SignupRow = typeof schema.eventSignups.$inferSelect;

async function updateCharacterSelections(
  db: PostgresJsDatabase<typeof schema>,
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupRow>,
): Promise<void> {
  for (const a of assignments) {
    if (a.characterId) {
      const signup = signupByUserId.get(a.userId);
      if (signup) {
        await db
          .update(schema.eventSignups)
          .set({ characterId: a.characterId, confirmationStatus: 'confirmed' })
          .where(eq(schema.eventSignups.id, signup.id));
      }
    }
  }
}

async function insertAssignmentRows(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupRow>,
): Promise<void> {
  await db.insert(schema.rosterAssignments).values(
    assignments.map((a) => ({
      eventId,
      signupId: a.signupId ?? signupByUserId.get(a.userId)!.id,
      role: a.slot,
      position: a.position,
      isOverride: a.isOverride ? 1 : 0,
    })),
  );
}

async function confirmNonBenchSignups(
  db: PostgresJsDatabase<typeof schema>,
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupRow>,
): Promise<void> {
  const nonBenchSignupIds = assignments
    .filter((a) => a.slot && a.slot !== 'bench')
    .map((a) => signupByUserId.get(a.userId)!)
    .filter((s) => s.confirmationStatus === 'pending')
    .map((s) => s.id);
  if (nonBenchSignupIds.length > 0) {
    await db
      .update(schema.eventSignups)
      .set({ confirmationStatus: 'confirmed' })
      .where(inArray(schema.eventSignups.id, nonBenchSignupIds));
  }
}

async function cancelPromotionsForSlots(
  eventId: number,
  assignments: UpdateRosterDto['assignments'],
  benchPromo: BenchPromotionService,
): Promise<void> {
  for (const a of assignments) {
    if (a.slot && a.slot !== 'bench') {
      await benchPromo.cancelPromotion(eventId, a.slot, a.position);
    }
  }
}

export async function applyRosterAssignments(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  dto: UpdateRosterDto,
  signupByUserId: Map<number | null, SignupRow>,
  benchPromo: BenchPromotionService,
): Promise<void> {
  await updateCharacterSelections(db, dto.assignments, signupByUserId);
  if (dto.assignments.length === 0) return;
  await insertAssignmentRows(db, eventId, dto.assignments, signupByUserId);
  await confirmNonBenchSignups(db, dto.assignments, signupByUserId);
  await cancelPromotionsForSlots(eventId, dto.assignments, benchPromo);
}

export async function notifyRemovedUser(
  notificationService: NotificationService,
  eventId: number,
  userId: number,
  eventTitle: string,
): Promise<void> {
  const discordUrl = await notificationService.getDiscordEmbedUrl(eventId);
  const voiceChannelId =
    await notificationService.resolveVoiceChannelForEvent(eventId);
  await notificationService.create({
    userId,
    type: 'slot_vacated',
    title: 'Removed from Event',
    message: `You were removed from ${eventTitle}`,
    payload: {
      eventId,
      ...(discordUrl ? { discordUrl } : {}),
      ...(voiceChannelId ? { voiceChannelId } : {}),
    },
  });
}

async function validateRosterAccess(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  isAdmin: boolean,
): Promise<typeof schema.events.$inferSelect> {
  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) throw new NotFoundException(`Event with ID ${eventId} not found`);
  if (event.creatorId !== userId && !isAdmin) {
    throw new ForbiddenException(
      'Only event creator, admin, or operator can update roster',
    );
  }
  return event;
}

async function loadSignupsAndValidate(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  dto: UpdateRosterDto,
): Promise<Map<number | null, SignupRow>> {
  const signups = await db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  const signupByUserId = new Map(signups.map((s) => [s.userId, s]));
  for (const a of dto.assignments) {
    if (!signupByUserId.get(a.userId))
      throw new BadRequestException(
        `User ${a.userId} is not signed up for this event`,
      );
  }
  return signupByUserId;
}

async function replaceAssignments(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  dto: UpdateRosterDto,
  signupByUserId: Map<number | null, SignupRow>,
  benchPromo: BenchPromotionService,
): Promise<Map<number, string | null>> {
  const oldAssignments = await db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId));
  const oldRoleBySignupId = new Map(
    oldAssignments.map((a) => [a.signupId, a.role]),
  );
  await db
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId));
  await applyRosterAssignments(db, eventId, dto, signupByUserId, benchPromo);
  return oldRoleBySignupId;
}

type NotifyArgs = [
  NotificationService,
  number,
  string,
  UpdateRosterDto['assignments'],
  Map<number | null, SignupRow>,
  Map<number, string | null>,
];

function logNotifyError(label: string) {
  return (err: unknown) =>
    logger.warn(
      `Failed to send ${label} notifications: %s`,
      err instanceof Error ? err.message : 'Unknown error',
    );
}

function fireRosterNotifications(...args: NotifyArgs): void {
  notifyRoleChanges(...args).catch(logNotifyError('roster reassign'));
  notifyNewAssignments(...args).catch(logNotifyError('roster assignment'));
}

function emitAndNotify(
  eventEmitter: EventEmitter2,
  notificationService: NotificationService,
  eventId: number,
  eventTitle: string,
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupRow>,
  oldRoleBySignupId: Map<number, string | null>,
): void {
  logger.log(
    `Roster updated for event ${eventId}: ${assignments.length} assignments`,
  );
  eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
    eventId,
    action: 'roster_updated',
  } satisfies SignupEventPayload);
  fireRosterNotifications(
    notificationService,
    eventId,
    eventTitle,
    assignments,
    signupByUserId,
    oldRoleBySignupId,
  );
}

export async function updateRoster(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  isAdmin: boolean,
  dto: UpdateRosterDto,
  notificationService: NotificationService,
  benchPromo: BenchPromotionService,
  eventEmitter: EventEmitter2,
): Promise<void> {
  const event = await validateRosterAccess(db, eventId, userId, isAdmin);
  const signupByUserId = await loadSignupsAndValidate(db, eventId, dto);
  const oldRoleBySignupId = await replaceAssignments(
    db,
    eventId,
    dto,
    signupByUserId,
    benchPromo,
  );
  emitAndNotify(
    eventEmitter,
    notificationService,
    eventId,
    event.title,
    dto.assignments,
    signupByUserId,
    oldRoleBySignupId,
  );
}

export async function validateCharacterOwnership(
  db: PostgresJsDatabase<typeof schema>,
  characterId: string,
  userId: number,
): Promise<typeof schema.characters.$inferSelect> {
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

  if (!character) {
    throw new BadRequestException(
      'Character not found or does not belong to you',
    );
  }
  return character;
}
