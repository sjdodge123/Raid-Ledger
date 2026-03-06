/**
 * Time suggestion generation and repoll handling for event plans.
 */
import { Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import type { TimeSuggestionsResponse } from '@raid-ledger/contract';
import {
  mapToConcreteDates,
  generateFallbackSuggestions,
} from './event-plans-poll.helpers';
import { lookupGameInfo, dmOrganizer } from './event-plans-discord.helpers';

const logger = new Logger('EventPlansTime');
type PlanRow = typeof schema.eventPlans.$inferSelect;

export interface RepollDeps {
  db: PostgresJsDatabase<typeof schema>;
  discordClient: DiscordBotClientService;
  settingsService: SettingsService;
  postPoll: (
    ch: string,
    p: { id: string },
    t: string,
    opts: Array<{ date: string; label: string }>,
    dur: number,
    rnd: number,
    det?: Record<string, unknown>,
  ) => Promise<string>;
  tryDeletePollMessage: (plan: PlanRow) => Promise<void>;
  schedulePollClose: (planId: string, delayMs: number) => Promise<void>;
}

/** Queries game interest templates and ranks time slots. */
async function queryRankedTimeSlots(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
): Promise<{ ranked: [string, number][]; playerCount: number } | null> {
  const interests = await db
    .select({ userId: schema.gameInterests.userId })
    .from(schema.gameInterests)
    .where(eq(schema.gameInterests.gameId, gameId));
  const userIds = interests.map((i) => i.userId);
  if (userIds.length === 0) return null;
  const templates = await db
    .select({
      dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
      startHour: schema.gameTimeTemplates.startHour,
    })
    .from(schema.gameTimeTemplates)
    .where(inArray(schema.gameTimeTemplates.userId, userIds));
  if (templates.length === 0) return null;
  const countMap = new Map<string, number>();
  for (const t of templates) {
    const key = `${t.dayOfWeek}:${t.startHour}`;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }
  return {
    ranked: Array.from(countMap.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 21),
    playerCount: userIds.length,
  };
}

/** Builds a game-interest response from ranked time slots. */
function buildGameInterestResponse(
  ranked: [string, number][],
  playerCount: number,
  offset: number,
  after: Date,
  timezone: string | undefined,
): TimeSuggestionsResponse {
  const suggestions = mapToConcreteDates(ranked, offset, after, 14, timezone);
  return {
    source: 'game-interest',
    interestedPlayerCount: playerCount,
    suggestions: suggestions.slice(0, 20),
  };
}

/** Generates time suggestions based on game interest or fallback. */
export async function getTimeSuggestions(
  db: PostgresJsDatabase<typeof schema>,
  settingsService: SettingsService,
  gameId?: number,
  tzOffset?: number,
  afterDate?: string,
): Promise<TimeSuggestionsResponse> {
  const offset = tzOffset ?? 0;
  const after = afterDate ? new Date(afterDate) : new Date();
  const timezone = (await settingsService.getDefaultTimezone()) ?? undefined;
  if (gameId) {
    const result = await queryRankedTimeSlots(db, gameId);
    if (result)
      return buildGameInterestResponse(
        result.ranked,
        result.playerCount,
        offset,
        after,
        timezone,
      );
  }
  return {
    source: 'fallback',
    interestedPlayerCount: 0,
    suggestions: generateFallbackSuggestions(offset, after, timezone),
  };
}

/** Computes the next set of poll options from the latest existing date. */
async function computeNewPollOptions(
  deps: RepollDeps,
  plan: PlanRow,
): Promise<Array<{ date: string; label: string }> | null> {
  const pollOptions = plan.pollOptions as Array<{
    date: string;
    label: string;
  }>;
  const latestDate = pollOptions.reduce((max, opt) => {
    const d = new Date(opt.date).getTime();
    return d > max ? d : max;
  }, 0);
  const suggestions = await getTimeSuggestions(
    deps.db,
    deps.settingsService,
    plan.gameId ?? undefined,
    0,
    new Date(latestDate + 24 * 3600 * 1000).toISOString(),
  );
  if (suggestions.suggestions.length < 2) return null;
  return suggestions.suggestions
    .slice(0, 9)
    .map((s) => ({ date: s.date, label: s.label }));
}

/** Posts a new poll round for the given plan. */
async function postRepollMessage(
  deps: RepollDeps,
  plan: PlanRow,
  newOptions: Array<{ date: string; label: string }>,
  newRound: number,
): Promise<string | null> {
  const { gameName, gameCoverUrl } = await lookupGameInfo(deps.db, plan.gameId);
  try {
    return await deps.postPoll(
      plan.pollChannelId!,
      plan,
      plan.title,
      newOptions,
      plan.pollDurationHours,
      newRound,
      {
        description: plan.description,
        gameName,
        gameCoverUrl,
        durationMinutes: plan.durationMinutes,
        slotConfig: plan.slotConfig as Record<string, unknown> | null,
        pollMode: plan.pollMode,
      },
    );
  } catch (error) {
    logger.error(`Failed to post re-poll for plan ${plan.id}:`, error);
    return null;
  }
}

/** Persists the re-poll state to the database. */
async function persistRepoll(
  deps: RepollDeps,
  plan: PlanRow,
  newOptions: Array<{ date: string; label: string }>,
  newMessageId: string,
  newRound: number,
): Promise<void> {
  const pollEndsAt = new Date(
    Date.now() + plan.pollDurationHours * 3600 * 1000,
  );
  await deps.db
    .update(schema.eventPlans)
    .set({
      pollOptions: newOptions,
      pollMessageId: newMessageId,
      pollRound: newRound,
      pollStartedAt: new Date(),
      pollEndsAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.eventPlans.id, plan.id));
  await deps.schedulePollClose(plan.id, plan.pollDurationHours * 3600 * 1000);
  logger.log(`Re-poll posted for plan ${plan.id}, round ${newRound}`);
}

/** Handles the full re-poll flow when "none" wins in all-or-nothing mode. */
export async function handleRepoll(
  deps: RepollDeps,
  plan: PlanRow,
): Promise<void> {
  const newOptions = await computeNewPollOptions(deps, plan);
  if (!newOptions) {
    await expirePlan(
      deps,
      plan,
      `The poll for "${plan.title}" couldn't generate enough new time options. The plan has expired.`,
    );
    return;
  }
  await deps.tryDeletePollMessage(plan);
  const newRound = (plan.pollRound ?? 1) + 1;
  const newMessageId = await postRepollMessage(
    deps,
    plan,
    newOptions,
    newRound,
  );
  if (!newMessageId) {
    await expirePlan(deps, plan);
    return;
  }
  await persistRepoll(deps, plan, newOptions, newMessageId, newRound);
}

/** Expires a plan and optionally DMs the organizer. */
async function expirePlan(
  deps: RepollDeps,
  plan: PlanRow,
  dmMessage?: string,
): Promise<void> {
  await deps.db
    .update(schema.eventPlans)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(eq(schema.eventPlans.id, plan.id));
  if (dmMessage)
    safeDmOrganizer(deps.db, deps.discordClient, plan.creatorId, dmMessage);
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
