import { eq } from 'drizzle-orm';
import { markdownToPlainText } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { GuildProfileSelect } from '../drizzle/schema/guild-profiles';
import type { ProfilePatch } from './guild-profile.helpers';
import { latestPostsByGuild } from './posts/hub-posts.queries';

/** ROK-1786 — `guild_profiles` reads/writes (no access logic). */

type Db = PostgresJsDatabase<typeof schema>;

const { guildProfiles, users } = schema;

/** Longest headline shown on the Players card. */
export const GM_POST_HEADLINE_MAX = 120;

/**
 * First non-blank line of the latest post, markdown-stripped (ROK-1868 D11 —
 * `**Raid**` reads "Raid" in a one-line slot), capped with an ellipsis.
 */
export function gmPostHeadline(body: string | null): string | null {
  if (!body) return null;
  const line = markdownToPlainText(body)
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

/** guildId → headline of the guild's newest hub post (ROK-1868 D11). */
export async function gmPostHeadlines(
  db: Db,
  guildIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const latest = await latestPostsByGuild(db, guildIds);
  for (const [guildId, post] of latest) {
    const headline = gmPostHeadline(post.body);
    if (headline) out.set(guildId, headline);
  }
  return out;
}
