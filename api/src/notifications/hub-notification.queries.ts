/**
 * ROK-1832 — reads behind `HubNotificationService` (no notification logic).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { notHubMutedSql } from './hub-notification-mute.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The event fields a late group tag needs. */
export interface LateTagEvent {
  id: number;
  title: string;
  gameId: number | null;
  guildId: number | null;
  creatorId: number;
  startTime: Date;
  endTime: Date;
  cancelledAt: Date | null;
}

/** The group's display name, or null when the group is gone. */
export async function findGuildName(
  db: Db,
  guildId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ name: schema.guilds.name })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);
  return row?.name ?? null;
}

/** D3: keep only active users who have not muted the group. */
export async function filterGroupRecipients(
  db: Db,
  userIds: readonly number[],
  guildId: number,
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const u = schema.users;
  const rows = await db
    .select({ id: u.id })
    .from(u)
    .where(
      and(
        inArray(u.id, [...userIds]),
        isNull(u.deactivatedAt),
        notHubMutedSql(guildId, sql`${u.id}`),
      ),
    );
  return rows.map((r) => r.id);
}

/** D5: users who switched both `hub_event_tagged` channels off. */
export async function findGroupTypeOff(
  db: Db,
  userIds: readonly number[],
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const t = schema.userNotificationPreferences;
  const rows = await db
    .select({ userId: t.userId, prefs: t.channelPrefs })
    .from(t)
    .where(inArray(t.userId, [...userIds]));
  const off = rows.filter((r) => {
    const p = r.prefs.hub_event_tagged;
    return p?.inApp === false && p.discord === false;
  });
  return new Set(off.map((r) => r.userId));
}

/** The event a late tag fires for, or null when it does not exist. */
export async function findLateTagEvent(
  db: Db,
  eventId: number,
): Promise<LateTagEvent | null> {
  const e = schema.events;
  const [row] = await db
    .select({
      id: e.id,
      title: e.title,
      gameId: e.gameId,
      guildId: e.guildId,
      creatorId: e.creatorId,
      duration: e.duration,
      cancelledAt: e.cancelledAt,
    })
    .from(e)
    .where(eq(e.id, eventId))
    .limit(1);
  if (!row) return null;
  const { duration, ...rest } = row;
  return { ...rest, startTime: duration[0], endTime: duration[1] };
}
