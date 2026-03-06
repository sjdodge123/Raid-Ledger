/**
 * CRUD helpers for event plan insertion and event creation from plans.
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import type { CreateEventPlanDto } from '@raid-ledger/contract';
import { dmOrganizer } from './event-plans-discord.helpers';

const logger = new Logger('EventPlansCrud');
type PlanRow = typeof schema.eventPlans.$inferSelect;

/** Builds the common insert values shared by both insert functions. */
function buildCommonInsertValues(
  creatorId: number,
  channelId: string,
  pollDurationHours: number,
) {
  return {
    creatorId,
    pollChannelId: channelId,
    status: 'polling',
    pollStartedAt: new Date(),
    pollEndsAt: new Date(Date.now() + pollDurationHours * 3600 * 1000),
  };
}

/** Builds insert values specific to a new plan from a DTO. */
function buildNewPlanValues(dto: CreateEventPlanDto) {
  return {
    title: dto.title,
    description: dto.description ?? null,
    gameId: dto.gameId ?? null,
    slotConfig: dto.slotConfig ?? null,
    maxAttendees: dto.maxAttendees ?? null,
    autoUnbench: dto.autoUnbench ?? true,
    durationMinutes: dto.durationMinutes,
    pollOptions: dto.pollOptions,
    pollDurationHours: dto.pollDurationHours,
    pollMode: dto.pollMode ?? 'standard',
    contentInstances: dto.contentInstances ?? null,
    reminder15min: dto.reminder15min ?? true,
    reminder1hour: dto.reminder1hour ?? false,
    reminder24hour: dto.reminder24hour ?? false,
  };
}

/** Inserts a new event plan from a CreateEventPlanDto. */
export async function insertPlan(
  db: PostgresJsDatabase<typeof schema>,
  creatorId: number,
  dto: CreateEventPlanDto,
  channelId: string,
): Promise<PlanRow> {
  const [plan] = await db
    .insert(schema.eventPlans)
    .values({
      ...buildCommonInsertValues(creatorId, channelId, dto.pollDurationHours),
      ...buildNewPlanValues(dto),
    })
    .returning();
  return plan;
}

/** Builds insert values specific to a converted event plan. */
function buildConvertedValues(
  event: Awaited<ReturnType<EventsService['findOne']>>,
  durationMinutes: number,
  pollOptions: Array<{ date: string; label: string }>,
  pollDurationHours: number,
) {
  return {
    title: event.title,
    description: event.description ?? null,
    gameId: event.game?.id ?? null,
    slotConfig: event.slotConfig ?? null,
    maxAttendees: event.maxAttendees ?? null,
    autoUnbench: event.autoUnbench ?? true,
    durationMinutes,
    pollOptions,
    pollDurationHours,
    pollMode: 'standard',
    contentInstances: event.contentInstances ?? null,
    reminder15min: event.reminder15min,
    reminder1hour: event.reminder1hour,
    reminder24hour: event.reminder24hour,
  };
}

/** Inserts a plan converted from an existing event. */
export async function insertConvertedPlan(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  event: Awaited<ReturnType<EventsService['findOne']>>,
  durationMinutes: number,
  pollOptions: Array<{ date: string; label: string }>,
  pollDurationHours: number,
  channelId: string,
): Promise<PlanRow> {
  const [plan] = await db
    .insert(schema.eventPlans)
    .values({
      ...buildCommonInsertValues(userId, channelId, pollDurationHours),
      ...buildConvertedValues(
        event,
        durationMinutes,
        pollOptions,
        pollDurationHours,
      ),
    })
    .returning();
  return plan;
}

/** Builds the slot config type for event creation. */
type SlotConfig =
  | {
      type: 'mmo' | 'generic';
      tank?: number;
      healer?: number;
      dps?: number;
      flex?: number;
      player?: number;
      bench?: number;
    }
  | undefined;

/** Builds the event creation DTO from a plan row and winning time. */
function buildEventDto(
  plan: PlanRow,
  startTime: Date,
  endTime: Date,
): Parameters<EventsService['create']>[1] {
  return {
    title: plan.title,
    description: plan.description ?? undefined,
    gameId: plan.gameId ?? undefined,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    slotConfig: plan.slotConfig as SlotConfig,
    maxAttendees: plan.maxAttendees ?? undefined,
    autoUnbench: plan.autoUnbench,
    contentInstances: plan.contentInstances
      ? (plan.contentInstances as Record<string, unknown>[])
      : undefined,
    reminder15min: plan.reminder15min,
    reminder1hour: plan.reminder1hour,
    reminder24hour: plan.reminder24hour,
  };
}

/** Marks a plan as completed after event creation. */
async function markPlanCompleted(
  db: PostgresJsDatabase<typeof schema>,
  planId: string,
  winnerIndex: number,
  eventId: number,
): Promise<void> {
  await db
    .update(schema.eventPlans)
    .set({
      status: 'completed',
      winningOption: winnerIndex,
      createdEventId: eventId,
      updatedAt: new Date(),
    })
    .where(eq(schema.eventPlans.id, planId));
}

/** Handles successful event creation from plan: signup, mark complete, notify. */
async function handleEventCreated(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  signupsService: SignupsService,
  plan: PlanRow,
  eventId: number,
  winnerIndex: number,
  winnerLabel: string,
): Promise<void> {
  await signupsService.signup(eventId, plan.creatorId);
  await markPlanCompleted(db, plan.id, winnerIndex, eventId);
  safeDmOrganizer(
    db,
    discordClient,
    plan.creatorId,
    `The poll for "${plan.title}" has closed! "${winnerLabel}" won. Your event has been auto-created.`,
  );
  logger.log(
    `Event ${eventId} created from plan ${plan.id} (winner: option ${winnerIndex})`,
  );
}

/** Marks a plan as expired after a failed event creation attempt. */
async function expirePlanOnError(
  db: PostgresJsDatabase<typeof schema>,
  planId: string,
  error: unknown,
): Promise<void> {
  logger.error(`Failed to create event from plan ${planId}:`, error);
  await db
    .update(schema.eventPlans)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(eq(schema.eventPlans.id, planId));
}

/** Resolves the winning poll option's time range. */
function resolveWinningTimes(
  plan: PlanRow,
  winnerIndex: number,
): {
  winningOption: { date: string; label: string };
  startTime: Date;
  endTime: Date;
} {
  const pollOptions = plan.pollOptions as Array<{
    date: string;
    label: string;
  }>;
  const winningOption = pollOptions[winnerIndex];
  const startTime = new Date(winningOption.date);
  const endTime = new Date(
    startTime.getTime() + plan.durationMinutes * 60 * 1000,
  );
  return { winningOption, startTime, endTime };
}

/** Creates an event from a completed poll plan. */
export async function createEventFromPlan(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  eventsService: EventsService,
  signupsService: SignupsService,
  plan: PlanRow,
  winnerIndex: number,
): Promise<void> {
  const { winningOption, startTime, endTime } = resolveWinningTimes(
    plan,
    winnerIndex,
  );
  try {
    const event = await eventsService.create(
      plan.creatorId,
      buildEventDto(plan, startTime, endTime),
    );
    await handleEventCreated(
      db,
      discordClient,
      signupsService,
      plan,
      event.id,
      winnerIndex,
      winningOption.label,
    );
  } catch (error) {
    await expirePlanOnError(db, plan.id, error);
  }
}

/** Regenerates human-readable labels for poll options. */
export function regenerateLabels(
  options: Array<{ date: string; label: string }>,
): Array<{ date: string; label: string }> {
  return options.map((opt) => ({
    date: opt.date,
    label: new Date(opt.date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }),
  }));
}

function safeDmOrganizer(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  userId: number,
  message: string,
): void {
  dmOrganizer(db, discordClient, userId, message).catch((e) =>
    logger.warn(
      `Failed to DM organizer ${userId}:`,
      e instanceof Error ? e.message : 'Unknown error',
    ),
  );
}
