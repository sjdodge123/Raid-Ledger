/**
 * Event-to-plan conversion helpers for the event plans module.
 */
import { BadRequestException } from '@nestjs/common';
import * as schema from '../drizzle/schema';
import type {
  EventPlanResponseDto,
  ConvertEventToPlanDto,
} from '@raid-ledger/contract';
import { EventsService } from './events.service';
import { toResponseDto } from './event-plans-poll.helpers';
import { insertConvertedPlan } from './event-plans-crud.helpers';
import {
  getTimeSuggestions,
  type RepollDeps,
} from './event-plans-time.helpers';
import type { PlanOpsDeps } from './event-plans-ops.helpers';

type PlanRow = typeof schema.eventPlans.$inferSelect;

/** Builds the converted poll details for posting. */
function buildConvertedPollDetails(
  event: Awaited<ReturnType<EventsService['findOne']>>,
  durationMinutes: number,
): Record<string, unknown> {
  return {
    description: event.description,
    gameName: event.game?.name ?? null,
    gameCoverUrl: event.game?.coverUrl ?? null,
    durationMinutes,
    slotConfig: event.slotConfig as Record<string, unknown> | null,
    pollMode: 'standard',
  };
}

/** Resolves channel and generates poll options for event conversion. */
async function resolveConversionOptions(
  deps: PlanOpsDeps,
  event: Awaited<ReturnType<EventsService['findOne']>>,
  settingsService: unknown,
) {
  const channelId = await deps.channelResolver.resolveChannelForEvent(
    event.game?.id ?? null,
  );
  if (!channelId)
    throw new BadRequestException(
      'No Discord channel configured for this game.',
    );
  const suggestions = await getTimeSuggestions(
    deps.db,
    settingsService as RepollDeps['settingsService'],
    event.game?.id ?? undefined,
    0,
  );
  const pollOptions = suggestions.suggestions
    .slice(0, 9)
    .map((s) => ({ date: s.date, label: s.label }));
  if (pollOptions.length < 2)
    throw new BadRequestException(
      'Could not generate enough time suggestions. At least 2 options are required.',
    );
  return { channelId, pollOptions };
}

/** Computes event duration in minutes from start/end ISO strings. */
function computeDurationMinutes(startTime: string, endTime: string): number {
  return Math.max(
    1,
    Math.round((Date.parse(endTime) - Date.parse(startTime)) / 60000),
  );
}

/** Posts the conversion poll and schedules close. */
async function postConversionPoll(
  deps: PlanOpsDeps,
  plan: PlanRow,
  event: Awaited<ReturnType<EventsService['findOne']>>,
  pollOptions: Array<{ date: string; label: string }>,
  pollDurationHours: number,
  durationMinutes: number,
): Promise<void> {
  plan.pollMessageId = await deps.postPollOrRevert(
    plan.pollChannelId!,
    plan,
    event.title,
    pollOptions,
    pollDurationHours,
    1,
    buildConvertedPollDetails(event, durationMinutes),
  );
  await deps.schedulePollClose(plan.id, pollDurationHours * 3600 * 1000);
}

/** Creates the plan and posts the poll for a conversion. */
async function createAndPostPlan(
  deps: PlanOpsDeps,
  event: Awaited<ReturnType<EventsService['findOne']>>,
  userId: number,
  durationMinutes: number,
  pollOptions: Array<{ date: string; label: string }>,
  pollDurationHours: number,
  channelId: string,
): Promise<PlanRow> {
  const plan = await insertConvertedPlan(
    deps.db,
    userId,
    event,
    durationMinutes,
    pollOptions,
    pollDurationHours,
    channelId,
  );
  await postConversionPoll(
    deps,
    plan,
    event,
    pollOptions,
    pollDurationHours,
    durationMinutes,
  );
  return plan;
}

/** Executes full event-to-plan conversion: build plan, post poll, schedule close. */
export async function executeConversion(
  deps: PlanOpsDeps,
  event: Awaited<ReturnType<EventsService['findOne']>>,
  userId: number,
  settingsService: unknown,
  options?: ConvertEventToPlanDto,
): Promise<{ plan: PlanRow; dto: EventPlanResponseDto }> {
  const durationMinutes = computeDurationMinutes(
    event.startTime,
    event.endTime,
  );
  const resolved = await resolveConversionOptions(deps, event, settingsService);
  const pollDurationHours = options?.pollDurationHours ?? 24;
  const plan = await createAndPostPlan(
    deps,
    event,
    userId,
    durationMinutes,
    resolved.pollOptions,
    pollDurationHours,
    resolved.channelId,
  );
  return { plan, dto: toResponseDto(plan) };
}
