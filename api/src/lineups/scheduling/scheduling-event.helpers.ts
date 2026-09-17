/**
 * Event creation helpers for scheduling service (ROK-1031 refactor).
 * Extracted from scheduling.service.ts to stay within the 300-line limit.
 */
import { eq } from 'drizzle-orm';
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CreateEventDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  findScheduleSlots,
  findScheduleVotes,
  findVoteBySlotAndUser,
} from './scheduling-query.helpers';
import { resolvePlayerCap } from '../lineups-match-response.helpers';
import { updateMatchLinkedEvent } from './scheduling-query.helpers';
import { autoSignupSlotVoters } from './scheduling-auto-signup.helpers';
import { fireAutoHeartForVoters } from './scheduling-auto-heart.helpers';
import { fireEventCreated } from '../lineups-notify-hooks.helpers';
import type { EventsService } from '../../events/events.service';
import type { SignupsService } from '../../events/signups.service';
import type { LineupNotificationService } from '../lineup-notification.service';
import { withDefaultRosterSlots } from '../../events/event-roster-slots.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Assert the user has voted on at least one slot of the match before they may
 * create an event from it (ROK-1031). Extracted from the service to keep it
 * within the 300-line ESLint cap (ROK-1219).
 */
export async function assertUserHasVoted(
  db: Db,
  matchId: number,
  userId: number,
): Promise<void> {
  const slots = await findScheduleSlots(db, matchId);
  for (const slot of slots) {
    const votes = await findVoteBySlotAndUser(db, slot.id, userId);
    if (votes.length > 0) return;
  }
  throw new ForbiddenException(
    'You must vote on a slot before creating an event',
  );
}

const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;
const FOUR_WEEKS_MS = 4 * 7 * 24 * 60 * 60 * 1000;

/** Look up a schedule slot by ID or throw. */
export async function findSlotOrThrow(db: Db, slotId: number) {
  const [slot] = await db
    .select()
    .from(schema.communityLineupScheduleSlots)
    .where(eq(schema.communityLineupScheduleSlots.id, slotId))
    .limit(1);
  if (!slot) throw new NotFoundException('Slot not found');
  return slot;
}

/** Resolve game name, cover URL, and player cap from a game ID. */
export async function resolveGameInfo(db: Db, gameId: number) {
  const [game] = await db
    .select({
      name: schema.games.name,
      coverUrl: schema.games.coverUrl,
      // ROK-1411: both feed resolvePlayerCap (ROK-1397 precedence).
      playerCount: schema.games.playerCount,
      cooptimusOnlineMax: schema.games.cooptimusOnlineMax,
    })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return {
    gameName: game?.name ?? 'Game Night',
    gameCoverUrl: game?.coverUrl ?? null,
    playerCap: resolvePlayerCap(
      game?.cooptimusOnlineMax ?? null,
      game?.playerCount?.max ?? null,
    ),
  };
}

/**
 * Build a CreateEventDto from scheduling slot data.
 *
 * ROK-1606: the lock-in event gets the `/events/new` form's default player
 * slots (`withDefaultRosterSlots`). Without them `SignupsService.signup` finds
 * no player slot and every auto-signed-up voter stays off the roster.
 */
export function buildCreateEventDto(
  title: string,
  gameId: number,
  proposedTime: Date | string,
  recurring: boolean,
): CreateEventDto {
  const startTime = new Date(proposedTime);
  const endTime = new Date(startTime.getTime() + EVENT_DURATION_MS);
  const base = {
    title,
    gameId,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };
  if (!recurring) return withDefaultRosterSlots(base);
  const until = new Date(startTime.getTime() + FOUR_WEEKS_MS);
  return withDefaultRosterSlots({
    ...base,
    recurrence: { frequency: 'weekly' as const, until: until.toISOString() },
  });
}

/** Everything `createLockedInEvent` reaches outside the database. */
export interface LockInEventDeps {
  db: Db;
  eventsService: { create: EventsService['create'] };
  signupsService: Pick<SignupsService, 'signup'>;
  lineupNotifications: LineupNotificationService;
  pollEmbed: { fireUpdateEmbed: (matchId: number) => void };
  logger: Logger;
}

/**
 * Create the locked-in event, link it to the match, sign up exactly this
 * slot's voters (and roster them — ROK-1606), then announce.
 *
 * Lives here rather than in `SchedulingService` for the 300-line file cap
 * (ROK-1610); the sequence is unchanged.
 *
 * @param deps - Database plus the four services the lock-in touches.
 * @param match - The match being locked in.
 * @param slot - The slot whose time and voters the event takes.
 * @param userId - The locking-in caller, who becomes the event creator.
 * @param recurring - Whether to build a weekly recurrence.
 * @returns The new event's id.
 */
export async function createLockedInEvent(
  deps: LockInEventDeps,
  match: { id: number; gameId: number },
  slot: { id: number; proposedTime: Date },
  userId: number,
  recurring: boolean,
): Promise<number> {
  const { db, logger } = deps;
  const matchId = match.id;
  const { gameName } = await resolveGameInfo(db, match.gameId);
  const dto = buildCreateEventDto(
    gameName,
    match.gameId,
    slot.proposedTime,
    recurring,
  );
  const event = await deps.eventsService.create(userId, dto);
  await updateMatchLinkedEvent(db, matchId, event.id);
  const voters = await findScheduleVotes(db, [slot.id]);
  // ROK-1606: nobody is pre-signed-up on this path, so no voter is skipped —
  // the organiser who locked the time in is a voter like any other and needs
  // the signup (and the roster slot) too. An organiser who did NOT vote for
  // this slot is absent from `voters` and stays off the event (ROK-1610).
  await autoSignupSlotVoters({
    eventId: event.id,
    creatorId: null,
    voters,
    signupsService: deps.signupsService,
  });
  fireAutoHeartForVoters(db, match.gameId, voters, logger);
  // ROK-1461: the match is locked in now — re-render the poll embed so it
  // stops advertising itself as open.
  deps.pollEmbed.fireUpdateEmbed(matchId);
  fireEventCreated(
    deps.lineupNotifications,
    logger,
    db,
    matchId,
    slot.proposedTime,
    event.id,
  );
  return event.id;
}
