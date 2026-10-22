import { NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../../guilds/hub-hidden.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const m = schema.hubServerMembers;

/**
 * A `game_server` hub's Pelican server id (null = server deleted); 404 when the
 * guild is missing or not a server hub. Visibility is NOT checked here: every
 * caller sits behind `HubVisibleGuard`, which 404s non-staff on a hidden hub and
 * lets staff through (ROK-1831 L-5) — so staff get the same answer as on a
 * visible hub (prod 2026-10-21: Quick Play 404'd staff on a hidden hub).
 */
export async function findServerHub(
  db: Db,
  guildId: number,
): Promise<{ pelicanServerId: number | null }> {
  const g = schema.guilds;
  const [row] = await db
    .select({ kind: g.kind, serverId: g.pelicanServerId })
    .from(g)
    .where(eq(g.id, guildId))
    .limit(1);
  if (!row || row.kind !== 'game_server') {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
  return { pelicanServerId: row.serverId };
}

/** Manual Join — idempotent; clears any Leave. */
export async function joinManual(
  db: Db,
  guildId: number,
  userId: number,
  now: Date,
): Promise<void> {
  await db
    .insert(m)
    .values({ guildId, userId, source: 'manual', joinedAt: now })
    .onConflictDoUpdate({
      target: [m.guildId, m.userId],
      set: {
        joinedAt: sql`COALESCE(${m.joinedAt}, excluded.joined_at)`,
        leftAt: null,
        source: 'manual',
        updatedAt: now,
      },
    });
}

/** Manual Leave: `left_at = now`, `joined_at = null`; presence re-adds on the next arrival. */
export async function leaveManual(
  db: Db,
  guildId: number,
  userId: number,
  now: Date,
): Promise<void> {
  await db
    .update(m)
    .set({ leftAt: now, joinedAt: null, updatedAt: now })
    .where(and(eq(m.guildId, guildId), eq(m.userId, userId)));
}
