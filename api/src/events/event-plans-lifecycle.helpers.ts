import { Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { PollAnswerResult } from './event-plans-poll.helpers';
import {
  determineWinner,
  computeTotalRosterSlots,
} from './event-plans-poll.helpers';
import {
  postDiscordPoll,
  fetchPollResults,
  lookupGameInfo,
  dmOrganizer,
} from './event-plans-discord.helpers';
import type { PollOptionResult, PollResultsResponse } from '@raid-ledger/contract';

const logger = new Logger('EventPlansLifecycle');

/**
 * Process the standard-mode "None wins" check.
 * Returns true if the plan should stop processing (None wins → expired).
 */
export async function handleStandardNoneWins(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  plan: typeof schema.eventPlans.$inferSelect,
  results: Map<number, PollAnswerResult>,
  noneIndex: number,
): Promise<boolean> {
  const noneResult = results.get(noneIndex);
  const noneVotes = noneResult?.registeredVotes ?? 0;
  const maxRegisteredVotes = Math.max(
    ...Array.from(results.values()).map((r) => r.registeredVotes),
    0,
  );

  if (noneVotes > 0 && noneVotes >= maxRegisteredVotes) {
    await db
      .update(schema.eventPlans)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(schema.eventPlans.id, plan.id));

    await dmOrganizer(
      db,
      discordClient,
      plan.creatorId,
      `The poll for "${plan.title}" closed and "None of these work" got the most votes. No event was created.`,
    ).catch((e) =>
      logger.warn(`Failed to DM organizer ${plan.creatorId}:`, e),
    );
    return true;
  }
  return false;
}

/**
 * Handle All-or-Nothing re-poll when someone voted "None" and threshold not met.
 * Returns true if repoll condition triggered (regardless of outcome).
 */
export function shouldRepollAllOrNothing(
  plan: typeof schema.eventPlans.$inferSelect,
  results: Map<number, PollAnswerResult>,
  noneIndex: number,
  pollOptionsLength: number,
): boolean {
  const noneResult = results.get(noneIndex);
  const noneVotes = noneResult?.registeredVotes ?? 0;
  if (noneVotes <= 0) return false;

  const totalRosterSlots = computeTotalRosterSlots(plan.slotConfig);

  // When totalRosterSlots is 0, no threshold can be met → re-poll
  if (totalRosterSlots > 0) {
    for (const [idx, result] of results.entries()) {
      if (idx === noneIndex) continue;
      if (idx >= pollOptionsLength) continue;
      if (result.registeredVotes >= totalRosterSlots) {
        return false; // threshold met
      }
    }
  }
  return true; // should repoll
}

/**
 * Handle no-winner scenario (no votes at all).
 */
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

/**
 * Build poll results response DTO with voter details.
 */
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
  const noneIndex = pollOptions.length;

  // Collect all registered voter Discord IDs to look up usernames
  const allRegisteredIds = new Set<string>();
  for (const result of rawResults.values()) {
    for (const id of result.registeredVoterIds) {
      allRegisteredIds.add(id);
    }
  }

  // Look up usernames for registered voters
  const usernameMap = new Map<string, string>();
  if (allRegisteredIds.size > 0) {
    const users = await db
      .select({
        discordId: schema.users.discordId,
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(inArray(schema.users.discordId, Array.from(allRegisteredIds)));

    for (const u of users) {
      if (u.discordId) {
        usernameMap.set(u.discordId, u.displayName ?? u.username);
      }
    }
  }

  // Build poll option results
  const optionResults: PollOptionResult[] = [];
  let noneOption: PollOptionResult | null = null;

  for (const [idx, raw] of rawResults.entries()) {
    const voters = raw.registeredVoterIds.map((discordId) => ({
      discordId,
      username: usernameMap.get(discordId) ?? null,
      isRegistered: true,
    }));

    const optionResult: PollOptionResult = {
      index: idx,
      label:
        idx < pollOptions.length
          ? pollOptions[idx].label
          : 'None of these work',
      totalVotes: raw.totalVotes,
      registeredVotes: raw.registeredVotes,
      voters,
    };

    if (idx === noneIndex) {
      noneOption = optionResult;
    } else if (idx < pollOptions.length) {
      optionResults.push(optionResult);
    }
  }

  return {
    pollOptions: optionResults,
    noneOption,
    totalRegisteredVoters: allRegisteredIds.size,
  };
}

/**
 * Schedule a BullMQ poll-close job.
 */
export interface SchedulePollCloseParams {
  planId: string;
  delayMs: number;
}
