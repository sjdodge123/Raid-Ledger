/**
 * ROK-1832 — `POST /admin/test/hub-member` helpers: make a user a LIVE member
 * of a hub through that kind's own membership tables, so the adapters'
 * `memberUserIds` / `isMember` predicates include them.
 *   - `game_server`: a manual `hub_server_members` row (joined, not left).
 *   - `wow_guild`: a character on the guild's game whose `addon_guid` matches
 *     a roster row stamped at the guild's latest snapshot.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const HubMemberSchema = z.object({
  guildId: z.number().int().positive(),
  userId: z.number().int().positive(),
});

export type HubMemberInput = z.infer<typeof HubMemberSchema>;

export interface HubMemberResult {
  guildId: number;
  userId: number;
  kind: 'wow_guild' | 'game_server';
}

interface HubRow {
  id: number;
  kind: 'wow_guild' | 'game_server';
  gameId: number;
  lastSnapshotAt: Date | null;
}

/** The hub row, 404 when unknown. */
export async function findHubOr404(db: Db, guildId: number): Promise<HubRow> {
  const g = schema.guilds;
  const [row] = await db
    .select({
      id: g.id,
      kind: g.kind,
      gameId: g.gameId,
      lastSnapshotAt: g.lastSnapshotAt,
    })
    .from(g)
    .where(eq(g.id, guildId))
    .limit(1);
  if (!row) throw new NotFoundException(`Guild ${guildId} not found`);
  // ROK-1870: community hubs have their own seed path (core membership table).
  if (row.kind === 'game_community') {
    throw new BadRequestException('Community hubs are not seeded here');
  }
  return { ...row, kind: row.kind };
}

/** 404 when the user does not exist. */
export async function assertUserExists(db: Db, userId: number): Promise<void> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) throw new NotFoundException(`User ${userId} not found`);
}

/** game_server: idempotent manual Join (clears any Leave). */
export async function joinServerHub(
  db: Db,
  guildId: number,
  userId: number,
  now: Date,
): Promise<void> {
  const m = schema.hubServerMembers;
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

/** The fixture's deterministic roster GUID for (guild, user). */
export function hubMemberGuid(guildId: number, userId: number): string {
  return `Player-HUB-${guildId}-${userId}`;
}

/** wow_guild: a linked character + a roster row in the latest snapshot. */
export async function joinWowGuild(
  db: Db,
  hub: HubRow,
  userId: number,
  now: Date,
): Promise<void> {
  const guid = hubMemberGuid(hub.id, userId);
  await ensureLinkedCharacter(db, hub.gameId, userId, guid);
  const lastSeenAt = hub.lastSnapshotAt ?? now;
  const gm = schema.guildMembers;
  await db
    .insert(gm)
    .values({
      guildId: hub.id,
      guid,
      characterName: `Hub${userId}`,
      level: 60,
      class: 'Warrior',
      source: 'addon_import',
      lastSeenAt,
    })
    .onConflictDoUpdate({
      target: [gm.guildId, gm.guid],
      targetWhere: sql`${gm.guid} IS NOT NULL`,
      set: { lastSeenAt },
    });
}

/** A region-less character carrying the GUID (region NULL matches any). */
async function ensureLinkedCharacter(
  db: Db,
  gameId: number,
  userId: number,
  guid: string,
): Promise<void> {
  const c = schema.characters;
  const [existing] = await db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.gameId, gameId), eq(c.addonGuid, guid), isNull(c.region)))
    .limit(1);
  if (existing) return;
  const [row] = await db
    .insert(c)
    .values({ userId, gameId, name: `Hub${userId}`, addonGuid: guid })
    .returning({ id: c.id });
  defined(row, `hub-member character ${guid}`);
}
