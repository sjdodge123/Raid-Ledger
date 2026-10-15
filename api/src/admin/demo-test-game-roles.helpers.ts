/**
 * ROK-1767 — fixtures behind `/admin/test/game-roles/*` (DEMO_MODE only).
 *
 * The companion bot has no GuildMembers intent, so the smoke reads and sets
 * member roles through the API's own bot, which is the one managing them.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Guild } from 'discord.js';
import * as schema from '../drizzle/schema';
import type { GameRoleDb } from '../discord-bot/game-roles/game-role-reconcile.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SMOKE_ROLE_PREFIX = 'smoke-gr-';
/** A smoke role younger than this may belong to a concurrent run. */
const SWEEP_MIN_AGE_MS = 30 * 60 * 1000;

async function upsertSnowflakeUser(
  db: GameRoleDb,
  discordUserId: string,
): Promise<number> {
  const u = schema.users;
  const [found] = await db
    .select({ id: u.id })
    .from(u)
    .where(eq(u.discordId, discordUserId))
    .limit(1);
  if (found) return found.id;
  const [row] = await db
    .insert(u)
    .values({
      username: `${SMOKE_ROLE_PREFIX}${discordUserId}`,
      discordId: discordUserId,
      guildMemberSeenAt: new Date(),
    })
    .returning({ id: u.id });
  if (!row) throw new Error('fixture user insert returned no row');
  return row.id;
}

/**
 * Replace the member's presence history for `gameId` with ONE closed session
 * that started `daysAgo` days ago. `voicePlays` counts event-voice rows for
 * the same game in the last 30 days — they also count as play, so a smoke
 * can fail with a clear message instead of a mysterious "still has role".
 */
export async function seedGameSession(
  db: GameRoleDb,
  input: { discordUserId: string; gameId: number; daysAgo: number },
): Promise<{ userId: number; voicePlays: number }> {
  const userId = await upsertSnowflakeUser(db, input.discordUserId);
  const s = schema.gameActivitySessions;
  await db
    .delete(s)
    .where(and(eq(s.userId, userId), eq(s.gameId, input.gameId)));
  const startedAt = new Date(Date.now() - input.daysAgo * DAY_MS);
  await db.insert(s).values({
    userId,
    gameId: input.gameId,
    discordActivityName: `${SMOKE_ROLE_PREFIX}session`,
    startedAt,
    endedAt: new Date(startedAt.getTime() + 3600_000),
    durationSeconds: 3600,
  });
  const [voice] = await db.execute<{ n: number } & Record<string, unknown>>(sql`
    SELECT COUNT(*)::int AS n FROM event_voice_sessions v
      JOIN events e ON e.id = v.event_id
     WHERE v.user_id = ${userId} AND e.game_id = ${input.gameId}
       AND COALESCE(v.last_leave_at, now()) >= now() - interval '30 days'`);
  return { userId, voicePlays: Number(voice?.n ?? 0) };
}

/** Role ids the member holds; null when they are not in the guild. */
export async function readMemberRoles(
  guild: Guild,
  discordUserId: string,
): Promise<string[] | null> {
  try {
    const member = await guild.members.fetch({
      user: discordUserId,
      force: true,
    });
    return [...member.roles.cache.keys()];
  } catch {
    return null;
  }
}

/**
 * Delete smoke roles: the one named `name`, or else every `smoke-gr-*` role
 * older than 30 minutes (a concurrent run's fresh role is left alone).
 */
export async function sweepSmokeRoles(
  db: GameRoleDb,
  guild: Guild,
  name?: string,
): Promise<number> {
  const roles = await guild.roles.fetch();
  const now = Date.now();
  const doomed = [...roles.values()].filter((r) =>
    name !== undefined
      ? r.name === name
      : r.name.startsWith(SMOKE_ROLE_PREFIX) &&
        now - r.createdTimestamp > SWEEP_MIN_AGE_MS,
  );
  for (const role of doomed) {
    await db
      .delete(schema.discordGameRoles)
      .where(eq(schema.discordGameRoles.roleId, role.id));
    await role.delete('Raid Ledger smoke sweep');
  }
  return doomed.length;
}
