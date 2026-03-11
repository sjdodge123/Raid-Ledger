/**
 * Roster query helpers for SignupsService.
 * Contains getRoster, getRosterWithAssignments, slot config resolution.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import { NotFoundException } from '@nestjs/common';
import { eq, and, ne } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type {
  RosterWithAssignments,
  RosterAssignmentResponse,
  EventRosterDto,
} from '@raid-ledger/contract';
import type { Tx } from './signups.service.types';
import {
  buildRosterAssignmentResponseDto,
  buildSignupResponseDto,
  buildAnonymousSignupResponseDto,
} from './signups-roster.helpers';
import { MMO_SLOT_DEFAULTS } from './signups-signup.helpers';

export async function fetchRosterSignups(db: Tx, eventId: number) {
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

export async function verifyEventExists(db: Tx, eventId: number) {
  const [event] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) throw new NotFoundException(`Event with ID ${eventId} not found`);
}

export async function fetchEventForRoster(db: Tx, eventId: number) {
  return db
    .select({
      id: schema.events.id,
      slotConfig: schema.events.slotConfig,
      maxAttendees: schema.events.maxAttendees,
      gameId: schema.events.gameId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
}

export async function fetchSignupsWithAssignments(db: Tx, eventId: number) {
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

export function partitionAssignments(
  rows: Array<{
    event_signups: typeof schema.eventSignups.$inferSelect;
    users: typeof schema.users.$inferSelect | null;
    characters: typeof schema.characters.$inferSelect | null;
    roster_assignments: typeof schema.rosterAssignments.$inferSelect | null;
  }>,
) {
  const pool: RosterAssignmentResponse[] = [];
  const assigned: RosterAssignmentResponse[] = [];
  for (const row of rows) {
    const assignment = row.roster_assignments ?? undefined;
    const response = buildRosterAssignmentResponseDto(
      {
        event_signups: row.event_signups,
        users: row.users,
        characters: row.characters,
      },
      assignment,
    );
    (assignment ? assigned : pool).push(response);
  }
  return { pool, assigned };
}

/** Extract slot counts from a per-event slot_config jsonb value. */
export function slotConfigFromEvent(
  config: Record<string, unknown>,
): RosterWithAssignments['slots'] {
  const type = config.type as string;
  if (type === 'mmo') {
    return {
      tank: (config.tank as number) ?? MMO_SLOT_DEFAULTS.tank,
      healer: (config.healer as number) ?? MMO_SLOT_DEFAULTS.healer,
      dps: (config.dps as number) ?? MMO_SLOT_DEFAULTS.dps,
      ...(config.flex != null ? { flex: config.flex as number } : {}),
      bench: (config.bench as number) ?? MMO_SLOT_DEFAULTS.bench,
    };
  }
  return {
    player: (config.player as number) ?? 10,
    bench: (config.bench as number) ?? 5,
  };
}

/** ROK-183: Get slot configuration based on game type (fallback). */
export async function getSlotConfigFromGenre(
  db: Tx,
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
    ? { tank: MMO_SLOT_DEFAULTS.tank, healer: MMO_SLOT_DEFAULTS.healer, dps: MMO_SLOT_DEFAULTS.dps, bench: MMO_SLOT_DEFAULTS.bench }
    : { player: 10, bench: 5 };
}

export async function resolveSlotConfig(
  db: Tx,
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

/** ROK-451: Resolve generic slot role. */
export async function resolveGenericSlotRole(
  tx: Tx,
  event: { slotConfig: unknown; maxAttendees: number | null },
  eventId: number,
): Promise<string | null> {
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  if (slotConfig?.type === 'mmo') return null;
  let maxPlayers: number | null = null;
  if (slotConfig) {
    maxPlayers = (slotConfig.player as number) ?? null;
  } else if (event.maxAttendees) {
    maxPlayers = event.maxAttendees;
  }
  if (maxPlayers === null) return null;
  const currentAssignments = await tx
    .select({ position: schema.rosterAssignments.position })
    .from(schema.rosterAssignments)
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, 'player'),
      ),
    );
  if (currentAssignments.length >= maxPlayers) return null;
  return 'player';
}

/** Look up the assigned roster slot for a signup (ROK-626). */
export async function getAssignedSlotRole(
  db: Tx,
  signupId: number,
): Promise<string | null> {
  const [assignment] = await db
    .select({ role: schema.rosterAssignments.role })
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signupId))
    .limit(1);
  return assignment?.role ?? null;
}

/** Find next position for a slot role. */
export async function findNextPosition(
  tx: Tx,
  eventId: number,
  slotRole: string,
  explicitPosition?: number,
  autoBench = false,
) {
  if (!autoBench && explicitPosition) return explicitPosition;
  const positions = await tx
    .select({ position: schema.rosterAssignments.position })
    .from(schema.rosterAssignments)
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, slotRole),
      ),
    );
  return positions.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

/** Build the full EventRosterDto from fetched signup rows. */
export async function buildRosterResponse(
  db: Tx,
  eventId: number,
): Promise<EventRosterDto> {
  const signups = await fetchRosterSignups(db, eventId);
  if (signups.length === 0) await verifyEventExists(db, eventId);
  const responses = signups.map((row) =>
    row.event_signups.userId
      ? buildSignupResponseDto(
          row.event_signups,
          row.users ?? undefined,
          row.characters,
        )
      : buildAnonymousSignupResponseDto(row.event_signups),
  );
  return { eventId, signups: responses, count: responses.length };
}

/** Build the full RosterWithAssignments from DB queries. */
export async function buildRosterWithAssignments(
  db: Tx,
  eventId: number,
): Promise<RosterWithAssignments> {
  const [eventResult, rows] = await Promise.all([
    fetchEventForRoster(db, eventId),
    fetchSignupsWithAssignments(db, eventId),
  ]);
  const event = eventResult[0];
  if (!event) throw new NotFoundException(`Event with ID ${eventId} not found`);
  const { pool, assigned } = partitionAssignments(rows);
  const slots = await resolveSlotConfig(db, event, assigned);
  return { eventId, pool, assignments: assigned, slots };
}
