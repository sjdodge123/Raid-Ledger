/**
 * Standalone helper functions extracted from EventPlansService to keep
 * the service class under the file-size limit. These functions receive
 * dependencies explicitly rather than via `this`.
 */
import {
  Logger,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { PollResultsResponse } from '@raid-ledger/contract';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import {
  postDiscordPoll,
  fetchPollResults,
} from './event-plans-discord.helpers';
import type { PollAnswerResult } from './event-plans-poll.helpers';
import type { PlanOpsDeps } from './event-plans-ops.helpers';
import type { EventsService } from './events.service';
import type { SignupsService } from './signups.service';

const logger = new Logger('EventPlansService');

type PlanRow = typeof schema.eventPlans.$inferSelect;

/** Reverts a plan to draft status after a failed poll post. */
async function revertPlanToDraft(
  db: PostgresJsDatabase<typeof schema>,
  planId: string,
  error: unknown,
): Promise<never> {
  await db
    .update(schema.eventPlans)
    .set({ status: 'draft' })
    .where(eq(schema.eventPlans.id, planId));
  logger.error('Failed to post Discord poll:', error);
  throw new BadRequestException('Failed to post Discord poll.');
}

/** Posts a Discord poll and saves the message ID, reverting on failure. */
export async function postPollForPlan(
  discordClient: DiscordBotClientService,
  db: PostgresJsDatabase<typeof schema>,
  channelId: string,
  planId: string,
  title: string,
  options: Array<{ date: string; label: string }>,
  durationHours: number,
  round: number,
  details?: Record<string, unknown>,
): Promise<string> {
  try {
    const msgId = await postDiscordPoll(discordClient, {
      channelId,
      planId,
      title,
      options,
      durationHours,
      round,
      details,
    });
    await db
      .update(schema.eventPlans)
      .set({ pollMessageId: msgId })
      .where(eq(schema.eventPlans.id, planId));
    return msgId;
  } catch (error) {
    return revertPlanToDraft(db, planId, error);
  }
}

/** Posts a poll for a converted event plan. */
export async function postConvertedPoll(
  discordClient: DiscordBotClientService,
  db: PostgresJsDatabase<typeof schema>,
  result: {
    plan: PlanRow;
    pollDurationHours: number;
    pollOptions: Array<{ date: string; label: string }>;
    durationMinutes: number;
  },
  event: Awaited<ReturnType<EventsService['findOne']>>,
): Promise<string> {
  return postPollForPlan(
    discordClient,
    db,
    result.plan.pollChannelId!,
    result.plan.id,
    event.title,
    result.pollOptions,
    result.pollDurationHours,
    1,
    {
      description: event.description,
      gameName: event.game?.name ?? null,
      gameCoverUrl: event.game?.coverUrl ?? null,
      durationMinutes: result.durationMinutes,
      slotConfig: event.slotConfig as Record<string, unknown> | null,
      pollMode: 'standard',
    },
  );
}

/** Asserts the user owns the event or has admin/operator role. */
export function assertEventOwnerOrPrivileged(
  event: { creator: { id: number } },
  userId: number,
  userRole?: string,
): void {
  if (
    event.creator.id !== userId &&
    userRole !== 'admin' &&
    userRole !== 'operator'
  ) {
    throw new ForbiddenException(
      'Only the event creator or an admin/operator can convert this event to a plan',
    );
  }
}

/** Asserts the user is the plan creator or has a privileged role. */
export function assertCreatorOrPrivileged(
  plan: { creatorId: number },
  userId: number,
  userRole: string | undefined,
  action: string,
): void {
  if (
    plan.creatorId !== userId &&
    userRole !== 'admin' &&
    userRole !== 'operator'
  ) {
    throw new ForbiddenException(
      `Only the plan creator or an admin/operator can ${action}`,
    );
  }
}

/** Builds an empty poll results response for non-polling plans. */
export function emptyPollResults(plan: PlanRow): PollResultsResponse {
  return {
    planId: plan.id,
    status: plan.status as PollResultsResponse['status'],
    pollOptions: [],
    noneOption: null,
    totalRegisteredVoters: 0,
    pollEndsAt: plan.pollEndsAt?.toISOString() ?? null,
  };
}

/** Fetches poll results from Discord, throwing on failure. */
export async function fetchResultsOrThrow(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  plan: PlanRow,
): Promise<Map<number, PollAnswerResult>> {
  try {
    return await fetchPollResults(
      db,
      discordClient,
      plan.pollChannelId!,
      plan.pollMessageId!,
    );
  } catch (error) {
    logger.error(`Poll results fetch failed for ${plan.id}:`, error);
    throw new ServiceUnavailableException(
      'Could not fetch poll results from Discord.',
    );
  }
}

/** Tries to cancel the original event during conversion. */
export async function tryCancelOriginal(
  eventsService: EventsService,
  eventId: number,
  userId: number,
  userRole: string | undefined,
  cancelOriginal?: boolean,
): Promise<void> {
  if (cancelOriginal === false) return;
  const isPrivileged = userRole === 'admin' || userRole === 'operator';
  try {
    await eventsService.cancel(eventId, userId, isPrivileged, {
      reason: 'Converted to community poll',
    });
  } catch (e) {
    logger.warn(`Cancel original failed:`, e);
  }
}

/** Builds PlanOpsDeps from service dependencies. */
export function buildOpsDeps(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  channelResolver: ChannelResolverService,
  eventsService: EventsService,
  signupsService: SignupsService,
  schedulePollClose: (id: string, ms: number) => Promise<void>,
  tryDeletePollMessage: (p: PlanRow) => Promise<void>,
): PlanOpsDeps {
  return {
    db,
    discordClient,
    channelResolver,
    eventsService,
    signupsService,
    postPollOrRevert: (ch, p, t, opts, dur, rnd, det?) =>
      postPollForPlan(discordClient, db, ch, p.id, t, opts, dur, rnd, det),
    schedulePollClose,
    tryDeletePollMessage,
  };
}
