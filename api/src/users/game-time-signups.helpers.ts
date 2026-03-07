/**
 * Signup preview helpers for the composite game-time view.
 * Extracted from game-time-composite.helpers.ts for file size compliance (ROK-719).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql, inArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

/** Signup preview map type. */
export type SignupsPreviewMap = Map<
  number,
  {
    preview: Array<{
      id: number;
      username: string;
      avatar: string | null;
      characters?: Array<{ gameId: number; avatarUrl: string | null }>;
    }>;
    count: number;
  }
>;

/** Fetch signups for the given events with preview data and character avatars. */
export async function fetchSignupsPreview(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
): Promise<SignupsPreviewMap> {
  const signupsMap: SignupsPreviewMap = new Map();
  if (eventIds.length === 0) return signupsMap;
  const { allSignups, countMap } = await fetchRawSignupData(db, eventIds);
  const allSignupUsers = buildSignupPreviewMap(
    eventIds,
    allSignups,
    countMap,
    signupsMap,
  );
  await attachCharactersToSignups(db, allSignupUsers, signupsMap);
  return signupsMap;
}

/** Fetch signup rows with row numbers for given event IDs. */
async function fetchSignupRows(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
) {
  return db
    .select({
      eventId: schema.eventSignups.eventId,
      signupId: schema.eventSignups.id,
      userId: schema.eventSignups.userId,
      username: schema.users.username,
      avatar: schema.users.avatar,
      rowNum:
        sql<number>`ROW_NUMBER() OVER (PARTITION BY ${schema.eventSignups.eventId} ORDER BY ${schema.eventSignups.id})`.as(
          'row_num',
        ),
    })
    .from(schema.eventSignups)
    .innerJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
    .where(inArray(schema.eventSignups.eventId, eventIds));
}

/** Fetch signup counts grouped by event ID. */
async function fetchSignupCounts(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
): Promise<Map<number, number>> {
  const allCounts = await db
    .select({
      eventId: schema.eventSignups.eventId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.eventSignups)
    .where(inArray(schema.eventSignups.eventId, eventIds))
    .groupBy(schema.eventSignups.eventId);
  return new Map(allCounts.map((c) => [c.eventId, c.count]));
}

/** Fetch raw signup rows and counts for given event IDs. */
async function fetchRawSignupData(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
) {
  const [allSignups, countMap] = await Promise.all([
    fetchSignupRows(db, eventIds),
    fetchSignupCounts(db, eventIds),
  ]);
  return { allSignups, countMap };
}

/** Build preview entries for a single event. */
function buildEventPreview(
  allSignups: Array<{
    eventId: number;
    userId: number | null;
    username: string;
    avatar: string | null;
    rowNum: number;
  }>,
  eventId: number,
) {
  const eventSignups = allSignups.filter(
    (s) => s.eventId === eventId && s.rowNum <= 6,
  );
  const userIds = eventSignups
    .filter((s) => s.userId !== null)
    .map((s) => s.userId as number);
  const preview = eventSignups
    .filter((s) => s.userId !== null)
    .map((s) => ({
      id: s.userId as number,
      username: s.username,
      avatar: s.avatar,
    }));
  return { userIds, preview };
}

/** Populate the signups preview map and return all signup user IDs. */
function buildSignupPreviewMap(
  eventIds: number[],
  allSignups: Array<{
    eventId: number;
    userId: number | null;
    username: string;
    avatar: string | null;
    rowNum: number;
  }>,
  countMap: Map<number, number>,
  signupsMap: SignupsPreviewMap,
): number[] {
  const allSignupUsers: number[] = [];
  for (const eventId of eventIds) {
    const { userIds, preview } = buildEventPreview(allSignups, eventId);
    allSignupUsers.push(...userIds);
    signupsMap.set(eventId, {
      preview,
      count: countMap.get(eventId) ?? 0,
    });
  }
  return allSignupUsers;
}

/** Build a map of userId -> character avatar data. */
async function fetchCharactersByUser(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<Map<number, Array<{ gameId: number; avatarUrl: string | null }>>> {
  const data = await db
    .select({
      userId: schema.characters.userId,
      gameId: schema.characters.gameId,
      avatarUrl: schema.characters.avatarUrl,
    })
    .from(schema.characters)
    .where(inArray(schema.characters.userId, userIds));
  const map = new Map<
    number,
    Array<{ gameId: number; avatarUrl: string | null }>
  >();
  for (const char of data) {
    if (!map.has(char.userId)) map.set(char.userId, []);
    map
      .get(char.userId)!
      .push({ gameId: char.gameId, avatarUrl: char.avatarUrl });
  }
  return map;
}

/** Attach character avatar data to signup preview entries. */
async function attachCharactersToSignups(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
  signupsMap: Map<
    number,
    {
      preview: Array<{
        id: number;
        characters?: Array<{ gameId: number; avatarUrl: string | null }>;
      }>;
    }
  >,
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) return;
  const charactersByUser = await fetchCharactersByUser(db, uniqueUserIds);
  for (const entry of signupsMap.values()) {
    for (const signup of entry.preview) {
      const chars = charactersByUser.get(signup.id);
      if (chars) signup.characters = chars;
    }
  }
}
