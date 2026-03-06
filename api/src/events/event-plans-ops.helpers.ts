/**
 * Orchestration helpers for event plan operations (restart, poll close, convert).
 */
import { Logger, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { EventPlanResponseDto } from '@raid-ledger/contract';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import {
  type PollAnswerResult,
  determineWinner,
  toResponseDto,
} from './event-plans-poll.helpers';
import {
  postDiscordPoll,
  fetchPollResults,
  lookupGameInfo,
} from './event-plans-discord.helpers';
import {
  handleStandardNoneWins,
  shouldRepollAllOrNothing,
  handleNoWinner,
} from './event-plans-lifecycle.helpers';
import {
  createEventFromPlan,
  regenerateLabels,
} from './event-plans-crud.helpers';
import { handleRepoll, type RepollDeps } from './event-plans-time.helpers';

const logger = new Logger('EventPlansOps');
type PlanRow = typeof schema.eventPlans.$inferSelect;

/** Dependencies for plan operations that require service-level access. */
export interface PlanOpsDeps {
  db: PostgresJsDatabase<typeof schema>;
  discordClient: DiscordBotClientService;
  channelResolver: ChannelResolverService;
  eventsService: EventsService;
  signupsService: SignupsService;
  postPollOrRevert: (
    ch: string,
    p: { id: string },
    t: string,
    opts: Array<{ date: string; label: string }>,
    dur: number,
    rnd: number,
    det?: Record<string, unknown>,
  ) => Promise<string>;
  schedulePollClose: (planId: string, delayMs: number) => Promise<void>;
  tryDeletePollMessage: (plan: PlanRow) => Promise<void>;
}

/** Builds poll details object from plan metadata. */
function buildPollDetails(
  plan: PlanRow,
  gameName: string | null,
  gameCoverUrl: string | null,
): Record<string, unknown> {
  return {
    description: plan.description,
    gameName,
    gameCoverUrl,
    durationMinutes: plan.durationMinutes,
    slotConfig: plan.slotConfig as Record<string, unknown> | null,
    pollMode: plan.pollMode,
  };
}

/** Validates that a plan can be restarted, returns prepared data. */
async function prepareRestart(deps: PlanOpsDeps, plan: PlanRow) {
  const { gameName, gameCoverUrl } = await lookupGameInfo(deps.db, plan.gameId);
  const pollOptions = regenerateLabels(
    plan.pollOptions as Array<{ date: string; label: string }>,
  );
  const newRound = plan.status === 'draft' ? 1 : (plan.pollRound ?? 1) + 1;
  const channelId =
    plan.pollChannelId ??
    (await deps.channelResolver.resolveChannelForEvent(plan.gameId));
  if (!channelId)
    throw new BadRequestException(
      'No Discord channel configured for this game.',
    );
  return { pollOptions, newRound, channelId, gameName, gameCoverUrl };
}

/** Persists the restart state to the database. */
async function persistRestart(
  deps: PlanOpsDeps,
  plan: PlanRow,
  channelId: string,
  messageId: string,
  newRound: number,
): Promise<PlanRow> {
  const pollEndsAt = new Date(
    Date.now() + plan.pollDurationHours * 3600 * 1000,
  );
  const [updated] = await deps.db
    .update(schema.eventPlans)
    .set({
      status: 'polling',
      pollChannelId: channelId,
      pollMessageId: messageId,
      pollRound: newRound,
      pollStartedAt: new Date(),
      pollEndsAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.eventPlans.id, plan.id))
    .returning();
  await deps.schedulePollClose(plan.id, plan.pollDurationHours * 3600 * 1000);
  return updated;
}

/** Restarts a plan by posting a new poll and updating DB state. */
export async function restartPlan(
  deps: PlanOpsDeps,
  plan: PlanRow,
): Promise<EventPlanResponseDto> {
  const { pollOptions, newRound, channelId, gameName, gameCoverUrl } =
    await prepareRestart(deps, plan);
  const messageId = await deps.postPollOrRevert(
    channelId,
    plan,
    plan.title,
    pollOptions,
    plan.pollDurationHours,
    newRound,
    buildPollDetails(plan, gameName, gameCoverUrl),
  );
  const updated = await persistRestart(
    deps,
    plan,
    channelId,
    messageId,
    newRound,
  );
  return toResponseDto(updated);
}

/** Fetches poll results, expiring the plan on failure. */
async function fetchResultsOrExpire(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  plan: PlanRow,
): Promise<Map<number, PollAnswerResult> | null> {
  try {
    return await fetchPollResults(
      db,
      discordClient,
      plan.pollChannelId!,
      plan.pollMessageId!,
    );
  } catch (error) {
    logger.error(`Failed to fetch poll results for plan ${plan.id}:`, error);
    await db
      .update(schema.eventPlans)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(schema.eventPlans.id, plan.id));
    return null;
  }
}

/** Builds RepollDeps from PlanOpsDeps. */
function buildRepollDeps(
  deps: PlanOpsDeps,
  settingsService: unknown,
): RepollDeps {
  return {
    db: deps.db,
    discordClient: deps.discordClient,
    settingsService: settingsService as RepollDeps['settingsService'],
    postPoll: (ch, p, t, opts, dur, rnd, det?) =>
      postDiscordPoll(deps.discordClient, {
        channelId: ch,
        planId: p.id,
        title: t,
        options: opts,
        durationHours: dur,
        round: rnd,
        details: det,
      }),
    tryDeletePollMessage: (p) => deps.tryDeletePollMessage(p),
    schedulePollClose: (id, ms) => deps.schedulePollClose(id, ms),
  };
}

/** Handles poll mode-specific logic (repoll or none-wins). Returns true if handled. */
async function handlePollModes(
  deps: PlanOpsDeps,
  settingsService: unknown,
  plan: PlanRow,
  results: Map<number, PollAnswerResult>,
  noneIndex: number,
  optionCount: number,
): Promise<boolean> {
  if (
    plan.pollMode === 'all_or_nothing' &&
    shouldRepollAllOrNothing(plan, results, noneIndex, optionCount)
  ) {
    await handleRepoll(buildRepollDeps(deps, settingsService), plan);
    return true;
  }
  if (plan.pollMode === 'standard') {
    const stopped = await handleStandardNoneWins(
      deps.db,
      deps.discordClient,
      plan,
      results,
      noneIndex,
    );
    if (stopped) return true;
  }
  return false;
}

/** Handles the winner determination and event creation. */
async function handleWinnerOrNoWinner(
  deps: PlanOpsDeps,
  plan: PlanRow,
  results: Map<number, PollAnswerResult>,
  pollOptions: Array<{ date: string; label: string }>,
  noneIndex: number,
): Promise<void> {
  const winnerIndex = determineWinner(results, pollOptions, noneIndex);
  if (winnerIndex === null) {
    await handleNoWinner(deps.db, deps.discordClient, plan);
    return;
  }
  await createEventFromPlan(
    deps.db,
    deps.discordClient,
    deps.eventsService,
    deps.signupsService,
    plan,
    winnerIndex,
  );
}

/** Processes a closed poll: determines winner and creates event or re-polls. */
export async function processPollResults(
  deps: PlanOpsDeps,
  settingsService: unknown,
  plan: PlanRow,
): Promise<void> {
  const results = await fetchResultsOrExpire(deps.db, deps.discordClient, plan);
  if (!results) return;
  const pollOptions = plan.pollOptions as Array<{
    date: string;
    label: string;
  }>;
  const noneIndex = pollOptions.length;
  if (
    await handlePollModes(
      deps,
      settingsService,
      plan,
      results,
      noneIndex,
      pollOptions.length,
    )
  )
    return;
  await handleWinnerOrNoWinner(deps, plan, results, pollOptions, noneIndex);
}

// Conversion helpers moved to event-plans-convert.helpers.ts
export { executeConversion } from './event-plans-convert.helpers';
