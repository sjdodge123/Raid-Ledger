import { Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { PollAnswerResult } from './event-plans-poll.helpers';
import { computeTotalRosterSlots } from './event-plans-poll.helpers';
import { dmOrganizer } from './event-plans-discord.helpers';
import type {
  PollOptionResult,
  PollResultsResponse,
} from '@raid-ledger/contract';

const logger = new Logger('EventPlansLifecycle');

/** Process standard-mode "None wins" check. Returns true if plan should stop. */
export async function handleStandardNoneWins(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  plan: typeof schema.eventPlans.$inferSelect,
  results: Map<number, PollAnswerResult>,
  noneIndex: number,
): Promise<boolean> {
  const noneResult = results.get(noneIndex);
  const noneVotes = noneResult?.registeredVotes ?? 0;
  const maxVotes = Math.max(
    ...Array.from(results.values()).map((r) => r.registeredVotes),
    0,
  );
  if (noneVotes > 0 && noneVotes >= maxVotes) {
    await db
      .update(schema.eventPlans)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(schema.eventPlans.id, plan.id));
    await dmOrganizer(
      db,
      discordClient,
      plan.creatorId,
      `The poll for "${plan.title}" closed and "None of these work" got the most votes. No event was created.`,
    ).catch((e) => logger.warn(`Failed to DM organizer ${plan.creatorId}:`, e));
    return true;
  }
  return false;
}

/** Check if all-or-nothing mode should trigger a re-poll. */
export function shouldRepollAllOrNothing(
  plan: typeof schema.eventPlans.$inferSelect,
  results: Map<number, PollAnswerResult>,
  noneIndex: number,
  pollOptionsLength: number,
): boolean {
  const noneResult = results.get(noneIndex);
  const noneVotes = noneResult?.registeredVotes ?? 0;
  if (noneVotes <= 0) return false;
  const totalSlots = computeTotalRosterSlots(plan.slotConfig);
  if (totalSlots > 0) {
    for (const [idx, result] of results.entries()) {
      if (idx === noneIndex || idx >= pollOptionsLength) continue;
      if (result.registeredVotes >= totalSlots) return false;
    }
  }
  return true;
}

/** Handle no-winner scenario (no votes at all). */
export async function handleNoWinner(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  plan: typeof schema.eventPlans.$inferSelect,
): Promise<void> {
  await db
    .update(schema.eventPlans)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(eq(schema.eventPlans.id, plan.id));
  await dmOrganizer(
    db,
    discordClient,
    plan.creatorId,
    `The poll for "${plan.title}" closed with no votes. No event was created.`,
  ).catch((e) => logger.warn(`Failed to DM organizer ${plan.creatorId}:`, e));
}

/** Looks up usernames for a set of Discord IDs. */
async function lookupUsernames(
  db: PostgresJsDatabase<typeof schema>,
  discordIds: Set<string>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (discordIds.size === 0) return map;
  const users = await db
    .select({
      discordId: schema.users.discordId,
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(inArray(schema.users.discordId, Array.from(discordIds)));
  for (const u of users) {
    if (u.discordId) map.set(u.discordId, u.displayName ?? u.username);
  }
  return map;
}

/** Maps raw poll results to PollOptionResult entries. */
function mapOptionResults(
  rawResults: Map<number, PollAnswerResult>,
  pollOptions: Array<{ date: string; label: string }>,
  usernameMap: Map<string, string>,
): { optionResults: PollOptionResult[]; noneOption: PollOptionResult | null } {
  const noneIndex = pollOptions.length;
  const optionResults: PollOptionResult[] = [];
  let noneOption: PollOptionResult | null = null;
  for (const [idx, raw] of rawResults.entries()) {
    const voters = raw.registeredVoterIds.map((discordId) => ({
      discordId,
      username: usernameMap.get(discordId) ?? null,
      isRegistered: true,
    }));
    const label =
      idx < pollOptions.length ? pollOptions[idx].label : 'None of these work';
    const result: PollOptionResult = {
      index: idx,
      label,
      totalVotes: raw.totalVotes,
      registeredVotes: raw.registeredVotes,
      voters,
    };
    if (idx === noneIndex) noneOption = result;
    else if (idx < pollOptions.length) optionResults.push(result);
  }
  return { optionResults, noneOption };
}

/** Build poll results response DTO with voter details. */
export async function buildPollResultsResponse(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  plan: typeof schema.eventPlans.$inferSelect,
  rawResults: Map<number, PollAnswerResult>,
): Promise<Omit<PollResultsResponse, 'planId' | 'status' | 'pollEndsAt'>> {
  const pollOptions = plan.pollOptions as Array<{
    date: string;
    label: string;
  }>;
  const allIds = new Set<string>();
  for (const r of rawResults.values())
    r.registeredVoterIds.forEach((id) => allIds.add(id));
  const usernameMap = await lookupUsernames(db, allIds);
  const { optionResults, noneOption } = mapOptionResults(
    rawResults,
    pollOptions,
    usernameMap,
  );
  return {
    pollOptions: optionResults,
    noneOption,
    totalRegisteredVoters: allIds.size,
  };
}

/** Schedule a BullMQ poll-close job. */
export interface SchedulePollCloseParams {
  planId: string;
  delayMs: number;
}
