import { Logger, NotFoundException } from '@nestjs/common';
import { eq, and, ne, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  SignupResponseDto,
  EventRosterDto,
  RosterWithAssignments,
  RosterAssignmentResponse,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import {
  buildSignupResponse,
  buildAnonymousSignupResponse,
  buildRosterAssignmentResponse,
} from './signup-response.helpers';

const logger = new Logger('SignupRoster');

export async function getCharacterById(
  db: PostgresJsDatabase<typeof schema>,
  characterId: string,
): Promise<typeof schema.characters.$inferSelect | null> {
  const [character] = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, characterId))
    .limit(1);
  return character ?? null;
}

async function fetchSignupRows(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
) {
  return db
    .select()
    .from(schema.eventSignups)
    .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
    .leftJoin(
      schema.characters,
      eq(schema.eventSignups.characterId, schema.characters.id),
    )
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        ne(schema.eventSignups.status, 'roached_out'),
        ne(schema.eventSignups.status, 'declined'),
      ),
    )
    .orderBy(schema.eventSignups.signedUpAt);
}

function mapSignupResponses(
  signups: Awaited<ReturnType<typeof fetchSignupRows>>,
): SignupResponseDto[] {
  return signups.map((row) => {
    if (!row.event_signups.userId) {
      return buildAnonymousSignupResponse(row.event_signups);
    }
    return buildSignupResponse(
      row.event_signups,
      row.users ?? undefined,
      row.characters,
    );
  });
}

async function ensureEventExists(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<void> {
  const [event] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) {
    throw new NotFoundException(`Event with ID ${eventId} not found`);
  }
}

export async function getRoster(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<EventRosterDto> {
  const signups = await fetchSignupRows(db, eventId);
  if (signups.length === 0) await ensureEventExists(db, eventId);
  const signupResponses = mapSignupResponses(signups);
  return { eventId, signups: signupResponses, count: signupResponses.length };
}

async function fetchSignupsWithAssignments(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
) {
  return db
    .select()
    .from(schema.eventSignups)
    .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
    .leftJoin(
      schema.characters,
      eq(schema.eventSignups.characterId, schema.characters.id),
    )
    .leftJoin(
      schema.rosterAssignments,
      and(
        eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
        eq(schema.rosterAssignments.eventId, eventId),
      ),
    )
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        ne(schema.eventSignups.status, 'roached_out'),
        ne(schema.eventSignups.status, 'declined'),
      ),
    )
    .orderBy(schema.eventSignups.signedUpAt);
}

async function fetchEventForRoster(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<{
  id: number;
  slotConfig: unknown;
  maxAttendees: number | null;
  gameId: number | null;
}> {
  const [event] = await db
    .select({
      id: schema.events.id,
      slotConfig: schema.events.slotConfig,
      maxAttendees: schema.events.maxAttendees,
      gameId: schema.events.gameId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) throw new NotFoundException(`Event with ID ${eventId} not found`);
  return event;
}

function partitionAssignments(
  rows: Awaited<ReturnType<typeof fetchSignupsWithAssignments>>,
): { pool: RosterAssignmentResponse[]; assigned: RosterAssignmentResponse[] } {
  const pool: RosterAssignmentResponse[] = [];
  const assigned: RosterAssignmentResponse[] = [];
  for (const row of rows) {
    const assignment = row.roster_assignments ?? undefined;
    const response = buildRosterAssignmentResponse(
      {
        event_signups: row.event_signups,
        users: row.users,
        characters: row.characters,
      },
      assignment,
    );
    if (assignment) assigned.push(response);
    else pool.push(response);
  }
  return { pool, assigned };
}

async function resolveSlots(
  db: PostgresJsDatabase<typeof schema>,
  event: {
    slotConfig: unknown;
    maxAttendees: number | null;
    gameId: number | null;
  },
  assigned: RosterAssignmentResponse[],
): Promise<RosterWithAssignments['slots']> {
  if (event.slotConfig)
    return slotConfigFromEvent(event.slotConfig as Record<string, unknown>);
  if (event.maxAttendees) {
    const benchedCount = assigned.filter((a) => a.slot === 'bench').length;
    return { player: event.maxAttendees, bench: Math.max(benchedCount, 2) };
  }
  return getSlotConfigFromGenre(db, event.gameId);
}

export async function getRosterWithAssignments(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<RosterWithAssignments> {
  const [event, rows] = await Promise.all([
    fetchEventForRoster(db, eventId),
    fetchSignupsWithAssignments(db, eventId),
  ]);
  const { pool, assigned } = partitionAssignments(rows);
  const slots = await resolveSlots(db, event, assigned);
  return { eventId, pool, assignments: assigned, slots };
}

export function slotConfigFromEvent(
  config: Record<string, unknown>,
): RosterWithAssignments['slots'] {
  const type = config.type as string;
  if (type === 'mmo') {
    return {
      tank: (config.tank as number) ?? 2,
      healer: (config.healer as number) ?? 4,
      dps: (config.dps as number) ?? 14,
      flex: (config.flex as number) ?? 5,
      bench: (config.bench as number) ?? 0,
    };
  }
  return {
    player: (config.player as number) ?? 10,
    bench: (config.bench as number) ?? 5,
  };
}

export async function getSlotConfigFromGenre(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number | null,
): Promise<RosterWithAssignments['slots']> {
  const MMO_GENRE_ID = 36;
  if (!gameId) return { player: 10, bench: 5 };

  const [game] = await db
    .select({ genres: schema.games.genres })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);

  const genres = (game?.genres as number[]) ?? [];
  return genres.includes(MMO_GENRE_ID)
    ? { tank: 2, healer: 4, dps: 14, flex: 5 }
    : { player: 10, bench: 5 };
}

export async function cleanupMatchingPugSlots(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
): Promise<void> {
  const discordId = await getUserDiscordId(db, userId);
  if (!discordId) return;
  await deletePugSlotsByDiscord(db, eventId, discordId, userId);
}

async function getUserDiscordId(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
): Promise<{ discordId: string; username: string } | null> {
  const [user] = await db
    .select({
      discordId: schema.users.discordId,
      username: schema.users.username,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user?.discordId) return null;
  return { discordId: user.discordId, username: user.username };
}

async function deletePugSlotsByDiscord(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  user: { discordId: string; username: string },
  userId: number,
): Promise<void> {
  const result = await db
    .delete(schema.pugSlots)
    .where(
      and(
        eq(schema.pugSlots.eventId, eventId),
        or(
          eq(schema.pugSlots.discordUserId, user.discordId),
          eq(schema.pugSlots.discordUsername, user.username),
        ),
      ),
    )
    .returning({ id: schema.pugSlots.id });

  if (result.length > 0) {
    logger.log(
      'Cleaned up %d stale PUG slot(s) for user %d (discord: %s) on event %d',
      result.length,
      userId,
      user.discordId,
      eventId,
    );
  }
}
