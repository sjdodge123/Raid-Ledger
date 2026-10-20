import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { HUB_NOT_FOUND } from '../hub-hidden.helpers';
import { isInDiscordGuild } from './discord-guild-member.helpers';
import { loadDiscordFields } from './community-hub.reads';
import { conflictOnUnique } from './community-db-errors';
import {
  liveMemberPredicate,
  type DbOrTx,
  type HubCommunityMemberRow,
} from './community-membership.queries';

/** ROK-1870 L3 — hub lookups + status writes shared by the L3 services. */

const g = schema.guilds;
const m = schema.hubCommunityMembers;

/** 404 unless `id` is a `game_community` hub (and `active`, when asked). */
export async function requireCommunityHub(
  db: DbOrTx,
  id: number,
  activeOnly: boolean,
): Promise<schema.GuildSelect> {
  const [hub] = await db.select().from(g).where(eq(g.id, id)).limit(1);
  const ok =
    hub !== undefined &&
    hub.kind === 'game_community' &&
    (!activeOnly || hub.status === 'active');
  if (!ok) throw new NotFoundException(HUB_NOT_FOUND);
  return hub;
}

/** True when the row is a live membership. */
export function isLive(row: HubCommunityMemberRow | null): boolean {
  return row !== null && row.leftAt === null && row.bannedAt === null;
}

/** Live members on active accounts. */
export async function countLiveMembers(
  db: DbOrTx,
  id: number,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(m)
    .innerJoin(schema.users, eq(schema.users.id, m.userId))
    .where(
      and(
        eq(m.guildId, id),
        liveMemberPredicate(),
        isNull(schema.users.deactivatedAt),
      ),
    );
  return row?.n ?? 0;
}

/** Archive the hub (`admin` | `leader` | `empty`). */
export async function archiveHub(
  db: DbOrTx,
  id: number,
  reason: 'admin' | 'leader' | 'empty',
): Promise<void> {
  const now = new Date();
  await db
    .update(g)
    .set({
      status: 'archived',
      archivedAt: now,
      archivedReason: reason,
      updatedAt: now,
    })
    .where(eq(g.id, id));
}

/** D11: another non-archived hub on the game holds this hub's name. */
async function hasRestoreClash(
  db: DbOrTx,
  hub: schema.GuildSelect,
): Promise<boolean> {
  const [clash] = await db
    .select({ id: g.id })
    .from(g)
    .where(
      and(
        eq(g.kind, 'game_community'),
        eq(g.gameId, hub.gameId),
        eq(g.nameKey, hub.nameKey),
        ne(g.status, 'archived'),
        ne(g.id, hub.id),
      ),
    )
    .limit(1);
  return clash !== undefined;
}

/** D11 copy for a restore whose name an active hub now holds. */
export const RESTORE_NAME_CLASH =
  'A hub with that name already exists for this game';

/** Restore an archived hub; 409 when an active hub now holds its name (D11). */
export async function restoreHub(
  db: DbOrTx,
  hub: schema.GuildSelect,
): Promise<void> {
  if (await hasRestoreClash(db, hub)) {
    throw new ConflictException(RESTORE_NAME_CLASH);
  }
  // A concurrent restore can pass the pre-check too; the partial unique index
  // then rejects this UPDATE — surface it as the same 409 (Codex r3). Nothing
  // runs after the failed statement, so a poisoned tx is never reused.
  await conflictOnUnique(
    () =>
      db
        .update(g)
        .set({
          status: 'active',
          archivedAt: null,
          archivedReason: null,
          updatedAt: new Date(),
        })
        .where(eq(g.id, hub.id)),
    RESTORE_NAME_CLASH,
  );
}

/** A2: 403 unless the user is in the community Discord (staff bypass). */
export async function assertInDiscord(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  staff: boolean,
): Promise<void> {
  if (staff) return;
  const fields = await loadDiscordFields(db, userId);
  if (fields === null || !isInDiscordGuild(fields)) {
    throw new ForbiddenException(
      'Join the community Discord server to join hubs',
    );
  }
}

/** 404 when the user does not exist. */
export async function assertUserExists(
  db: DbOrTx,
  userId: number,
): Promise<void> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) throw new NotFoundException('User not found');
}
