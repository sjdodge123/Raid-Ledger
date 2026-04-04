/**
 * Database query helpers for standalone scheduling polls (ROK-977).
 * Keeps the service layer thin by extracting all DB operations here.
 */
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Fetch a game by ID, returning name and cover URL. */
export async function findGameById(
  db: Db,
  gameId: number,
): Promise<{ id: number; name: string; coverUrl: string | null } | null> {
  const [game] = await db
    .select({
      id: schema.games.id,
      name: schema.games.name,
      coverUrl: schema.games.coverUrl,
    })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return game ?? null;
}

/** Check whether an event exists by ID. */
export async function eventExists(db: Db, eventId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return !!row;
}

/** Filter user IDs to those that exist in the users table. */
export async function filterValidUserIds(
  db: Db,
  userIds: number[],
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  return rows.map((r) => r.id);
}

/**
 * Insert a lineup in 'decided' status.
 * Uses direct db.insert() to bypass the active lineup conflict check.
 */
export async function insertDecidedLineup(
  db: Db,
  userId: number,
  linkedEventId: number | undefined,
  phaseDeadline: Date | null,
): Promise<{ id: number }> {
  const [row] = await db
    .insert(schema.communityLineups)
    .values({
      status: 'decided',
      createdBy: userId,
      linkedEventId: linkedEventId ?? null,
      phaseDeadline,
      /* Mark as standalone so community lineup queries exclude it.
         Uses existing JSONB column — no migration needed. */
      phaseDurationOverride: { standalone: true } as unknown as Record<string, number>,
    })
    .returning({ id: schema.communityLineups.id });
  return row;
}

/** Insert a match in 'scheduling' status with thresholdMet = true. */
export async function insertSchedulingMatch(
  db: Db,
  lineupId: number,
  gameId: number,
  linkedEventId: number | undefined,
): Promise<{ id: number }> {
  const [row] = await db
    .insert(schema.communityLineupMatches)
    .values({
      lineupId,
      gameId,
      status: 'scheduling',
      thresholdMet: true,
      voteCount: 0,
      linkedEventId: linkedEventId ?? null,
    })
    .returning({ id: schema.communityLineupMatches.id });
  return row;
}

/** Insert match member rows from a list of user IDs. */
export async function insertMatchMembers(
  db: Db,
  matchId: number,
  userIds: number[],
): Promise<void> {
  if (userIds.length === 0) return;
  const unique = [...new Set(userIds)];
  await db.insert(schema.communityLineupMatchMembers).values(
    unique.map((userId) => ({
      matchId,
      userId,
      source: 'voted' as const,
    })),
  );
}

/** Count members for a given match. */
export async function countMatchMembers(
  db: Db,
  matchId: number,
): Promise<number> {
  const rows = await db
    .select({ id: schema.communityLineupMatchMembers.id })
    .from(schema.communityLineupMatchMembers)
    .where(eq(schema.communityLineupMatchMembers.matchId, matchId));
  return rows.length;
}
