import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { GuildProfileSelect } from '../drizzle/schema/guild-profiles';
import type { ProfilePatch } from './guild-profile.helpers';

/** ROK-1786 — `guild_profiles` reads/writes (no access logic). */

type Db = PostgresJsDatabase<typeof schema>;

const { guildProfiles, users } = schema;

/** Longest headline shown on the Players card. */
export const GM_POST_HEADLINE_MAX = 120;

/** First non-blank line of the GM post, capped with an ellipsis. */
export function gmPostHeadline(body: string | null): string | null {
  if (!body) return null;
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  if (!line) return null;
  if (line.length <= GM_POST_HEADLINE_MAX) return line;
  return `${line.slice(0, GM_POST_HEADLINE_MAX - 1).trimEnd()}…`;
}

export async function findProfileRow(
  db: Db,
  guildId: number,
): Promise<GuildProfileSelect | undefined> {
  const [row] = await db
    .select()
    .from(guildProfiles)
    .where(eq(guildProfiles.guildId, guildId))
    .limit(1);
  return row;
}

/** Username of the GM post's last editor (null when unknown/deleted). */
export async function findUsername(
  db: Db,
  userId: number | null,
): Promise<string | null> {
  if (userId === null) return null;
  const [row] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.username ?? null;
}

/** Insert-or-update the guild's profile row with only the sent columns. */
export async function upsertProfile(
  db: Db,
  guildId: number,
  patch: ProfilePatch,
): Promise<void> {
  await db
    .insert(guildProfiles)
    .values({ guildId, ...patch })
    .onConflictDoUpdate({ target: guildProfiles.guildId, set: patch });
}

/** guildId → GM post headline, for the guilds that have one. */
export async function gmPostHeadlines(
  db: Db,
  guildIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (guildIds.length === 0) return out;
  const rows = await db
    .select({ guildId: guildProfiles.guildId, gmPost: guildProfiles.gmPost })
    .from(guildProfiles)
    .where(inArray(guildProfiles.guildId, guildIds));
  for (const row of rows) {
    const headline = gmPostHeadline(row.gmPost);
    if (headline) out.set(row.guildId, headline);
  }
  return out;
}
