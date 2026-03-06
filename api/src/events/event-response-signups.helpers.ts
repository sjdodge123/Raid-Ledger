/**
 * Helpers for fetching signup preview data for event lists.
 */
import { eq, asc, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type SignupsPreviewItem = {
  id: number;
  discordId: string;
  username: string;
  avatar: string | null;
  customAvatarUrl?: string | null;
  characters?: { gameId: number; avatarUrl: string | null }[];
};

/** Fetches raw signup rows with user data for the given event IDs. */
async function fetchSignupRows(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
) {
  return db
    .select({
      eventId: schema.eventSignups.eventId,
      userId: schema.users.id,
      discordId: schema.users.discordId,
      username: schema.users.username,
      avatar: schema.users.avatar,
      customAvatarUrl: schema.users.customAvatarUrl,
      signedUpAt: schema.eventSignups.signedUpAt,
    })
    .from(schema.eventSignups)
    .innerJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
    .where(inArray(schema.eventSignups.eventId, eventIds))
    .orderBy(asc(schema.eventSignups.signedUpAt));
}

/** Builds a map of userId -> characters from the DB. */
async function fetchCharacterMap(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<Map<number, { gameId: number; avatarUrl: string | null }[]>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: schema.characters.userId,
      gameId: schema.characters.gameId,
      avatarUrl: schema.characters.avatarUrl,
    })
    .from(schema.characters)
    .where(inArray(schema.characters.userId, userIds));
  const map = new Map<number, { gameId: number; avatarUrl: string | null }[]>();
  for (const row of rows) {
    if (!map.has(row.userId)) map.set(row.userId, []);
    map.get(row.userId)!.push({ gameId: row.gameId, avatarUrl: row.avatarUrl });
  }
  return map;
}

/** Groups signups by event, limited to `limit` per event. */
function groupSignupsByEvent(
  signups: Awaited<ReturnType<typeof fetchSignupRows>>,
  charactersByUser: Map<number, { gameId: number; avatarUrl: string | null }[]>,
  limit: number,
): Map<number, SignupsPreviewItem[]> {
  const result = new Map<number, SignupsPreviewItem[]>();
  for (const signup of signups) {
    if (!result.has(signup.eventId)) result.set(signup.eventId, []);
    const list = result.get(signup.eventId)!;
    if (list.length < limit) {
      list.push({
        id: signup.userId,
        discordId: signup.discordId ?? '',
        username: signup.username,
        avatar: signup.avatar,
        customAvatarUrl: signup.customAvatarUrl,
        characters: charactersByUser.get(signup.userId),
      });
    }
  }
  return result;
}

/** Fetches signup preview items grouped by event ID. */
export async function getSignupsPreviewForEvents(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
  limit = 5,
): Promise<Map<number, SignupsPreviewItem[]>> {
  if (eventIds.length === 0) return new Map();
  const signups = await fetchSignupRows(db, eventIds);
  const userIds = [...new Set(signups.map((s) => s.userId))];
  const charactersByUser = await fetchCharacterMap(db, userIds);
  return groupSignupsByEvent(signups, charactersByUser, limit);
}
