/**
 * Per-group (hub) notification mute gate (ROK-1832).
 *
 * Mirrors the ROK-1797 per-game mute: one predicate, many readers. Every
 * group-scoped recipient read (leader post, event tagged to a group) MUST AND
 * `notHubMutedSql` as an OUTER filter on the user id. Muting drops the user at
 * recipient selection, so the in-app row, push and DM all go together.
 */
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubNotificationMuteListDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/**
 * SQL predicate: the user has NOT muted notifications for this group.
 *
 * @param guildId - Group (hub) the notice is about.
 * @param userCol - Outer-query user id column; defaults to `u.id`.
 * @returns A `NOT EXISTS` fragment to AND into a recipient `WHERE`.
 */
export function notHubMutedSql(
  guildId: number,
  userCol: SQL = sql.raw('u.id'),
): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM hub_notification_mutes hnm
    WHERE hnm.user_id = ${userCol} AND hnm.guild_id = ${guildId}
  )`;
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Mute or unmute a group's notifications for a user. Idempotent both ways:
 * a repeat mute is a no-op insert, an unmute with no row deletes nothing.
 */
export async function setHubMute(
  db: Db,
  userId: number,
  guildId: number,
  muted: boolean,
): Promise<void> {
  const t = schema.hubNotificationMutes;
  if (muted) {
    await db.insert(t).values({ userId, guildId }).onConflictDoNothing();
    return;
  }
  await db.delete(t).where(and(eq(t.userId, userId), eq(t.guildId, guildId)));
}

/** Whether the user has muted this group's notifications. */
export async function isHubMuted(
  db: Db,
  userId: number,
  guildId: number,
): Promise<boolean> {
  const t = schema.hubNotificationMutes;
  const rows = await db
    .select({ guildId: t.guildId })
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.guildId, guildId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * The user's muted groups, joined to `guilds` (+ `games.name`, nullable),
 * ordered by group name then id.
 */
export async function listHubMutes(
  db: Db,
  userId: number,
): Promise<HubNotificationMuteListDto> {
  const t = schema.hubNotificationMutes;
  const g = schema.guilds;
  const gm = schema.games;
  const rows = await db
    .select({
      guildId: g.id,
      name: g.name,
      kind: g.kind,
      gameName: gm.name,
      createdAt: t.createdAt,
    })
    .from(t)
    .innerJoin(g, eq(g.id, t.guildId))
    .leftJoin(gm, eq(gm.id, g.gameId))
    .where(eq(t.userId, userId))
    .orderBy(asc(g.name), asc(g.id));
  return {
    data: rows.map(({ createdAt, ...r }) => ({
      ...r,
      mutedAt: createdAt.toISOString(),
    })),
  };
}
