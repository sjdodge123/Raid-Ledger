/**
 * DB reads that assemble a scheduling poll card's render data (ROK-1549).
 *
 * Moved out of `SchedulingPollEmbedService` so the service stays under the
 * file cap once the sync path gained the deadline + cancel reason inputs.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type {
  SchedulingPollEmbedData,
  SchedulingPollStatus,
} from '../../discord-bot/services/discord-embed-scheduling.types';
import {
  findScheduleSlots,
  findScheduleVotes,
} from './scheduling-query.helpers';
import { buildEmbedSlots, buildPollUrl } from './scheduling-poll-embed.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The parent lineup's lifecycle inputs. */
export interface LineupLifecycle {
  status: string | null;
  phaseDeadline: Date | null;
}

/** Inputs for {@link loadEmbedData}. */
export interface EmbedDataInput {
  matchId: number;
  lineupId: number;
  gameId: number;
  clientUrl: string;
  status?: SchedulingPollStatus;
  lockedInTime?: string | null;
  /** ROK-1549 AC3: ISO `community_lineups.phase_deadline`. */
  deadline?: string | null;
  /** ROK-1549 AC3: persisted `community_lineup_matches.cancellation_reason`. */
  cancelReason?: string | null;
}

/**
 * The parent lineup's lifecycle inputs (ROK-1545 review F2).
 *
 * @param db - Drizzle handle.
 * @param lineupId - The match's parent lineup.
 * @returns Its `status` + `phase_deadline`, or undefined when it is gone.
 */
export async function loadLineupLifecycle(
  db: Db,
  lineupId: number,
): Promise<LineupLifecycle | undefined> {
  const [lineup] = await db
    .select({
      status: schema.communityLineups.status,
      phaseDeadline: schema.communityLineups.phaseDeadline,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  return lineup;
}

/**
 * ISO start time of the event a lock-in produced (ROK-1461 review
 * follow-up). Lock-in may select a slot that is NOT the top-voted one, so
 * the linked event's start is the only trustworthy "locked in at" value.
 *
 * @param db - Drizzle handle.
 * @param linkedEventId - The match's linked event, when it has one.
 * @param status - The poll status the embed is about to render.
 * @returns The ISO start time, or null when there is nothing to announce.
 */
export async function loadLockedInTime(
  db: Db,
  linkedEventId: number | null,
  status: SchedulingPollStatus,
): Promise<string | null> {
  if (status !== 'locked_in' || !linkedEventId) return null;
  // `events.duration` is a tsrange — its lower bound is the start time.
  const [event] = await db
    .select({ startTime: sql<string>`lower(${schema.events.duration})` })
    .from(schema.events)
    .where(eq(schema.events.id, linkedEventId))
    .limit(1);
  return event?.startTime ? new Date(event.startTime).toISOString() : null;
}

/**
 * Build the card's render data from current DB state.
 *
 * @param db - Drizzle handle.
 * @param input - Match identity, client origin and lifecycle inputs.
 * @returns The embed data, or null when the game row is gone.
 */
export async function loadEmbedData(
  db: Db,
  input: EmbedDataInput,
): Promise<SchedulingPollEmbedData | null> {
  const [game] = await db
    .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
    .from(schema.games)
    .where(eq(schema.games.id, input.gameId))
    .limit(1);
  if (!game) return null;
  const slots = await findScheduleSlots(db, input.matchId);
  const votes = await findScheduleVotes(
    db,
    slots.map((s) => s.id),
  );
  return {
    matchId: input.matchId,
    lineupId: input.lineupId,
    gameId: input.gameId,
    status: input.status ?? 'open',
    lockedInTime: input.lockedInTime ?? null,
    deadline: input.deadline ?? null,
    cancelReason: input.cancelReason ?? null,
    gameName: game.name,
    gameCoverUrl: game.coverUrl,
    pollUrl: buildPollUrl(input.clientUrl, input.lineupId, input.matchId),
    slots: buildEmbedSlots(slots, votes),
    uniqueVoterCount: new Set(votes.map((v) => v.userId)).size,
  };
}
