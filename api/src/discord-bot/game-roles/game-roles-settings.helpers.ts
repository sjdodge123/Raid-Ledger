/**
 * ROK-1767: queries behind the game-roles admin controller.
 */
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { Guild } from 'discord.js';
import type {
  GameRoleAuditEntryDto,
  GameRoleSummaryDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  GAME_ROLE_ENTITY_TYPE,
  type GameRoleDb,
} from './game-role-reconcile.helpers';

/** Every linked game with its live role name and bot-grant count. */
export async function listGameRoleSummaries(
  db: GameRoleDb,
  guild: Guild | null,
  gameId?: number,
): Promise<GameRoleSummaryDto[]> {
  const r = schema.discordGameRoles;
  const g = schema.discordGameRoleGrants;
  const rows = await db
    .select({ row: r, gameName: schema.games.name, granted: count(g.userId) })
    .from(r)
    .innerJoin(schema.games, eq(schema.games.id, r.gameId))
    .leftJoin(g, eq(g.gameRoleId, r.id))
    .where(gameId === undefined ? undefined : eq(r.gameId, gameId))
    .groupBy(r.id, schema.games.name)
    .orderBy(schema.games.name);
  return rows.map(({ row, gameName, granted }) => ({
    gameId: row.gameId,
    gameName,
    roleId: row.roleId,
    roleName: guild?.roles.cache.get(row.roleId)?.name ?? null,
    botCreated: row.botCreated,
    windowDays: row.windowDays,
    enabled: row.enabled,
    lastReconciledAt: row.lastReconciledAt?.toISOString() ?? null,
    grantedCount: Number(granted),
  }));
}

export async function findGameName(
  db: GameRoleDb,
  gameId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ name: schema.games.name })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return row?.name ?? null;
}

export interface SaveGameRoleInput {
  gameId: number;
  roleId: string;
  botCreated: boolean;
  windowDays: number;
  enabled: boolean;
}

/** Upsert the link; a changed role id forgets the old role's grants. */
export async function saveGameRole(
  db: GameRoleDb,
  input: SaveGameRoleInput,
): Promise<void> {
  const r = schema.discordGameRoles;
  const [prev] = await db
    .select({ id: r.id, roleId: r.roleId })
    .from(r)
    .where(eq(r.gameId, input.gameId))
    .limit(1);
  if (prev && prev.roleId !== input.roleId) {
    await db
      .delete(schema.discordGameRoleGrants)
      .where(eq(schema.discordGameRoleGrants.gameRoleId, prev.id));
  }
  const { gameId, ...rest } = input;
  await db
    .insert(r)
    .values({ gameId, ...rest })
    .onConflictDoUpdate({
      target: r.gameId,
      set: { ...rest, updatedAt: new Date() },
    });
}

/** Stop managing a game (grants cascade; Discord roles stay — spec D2). */
export async function deleteGameRole(
  db: GameRoleDb,
  gameId: number,
): Promise<boolean> {
  const rows = await db
    .delete(schema.discordGameRoles)
    .where(eq(schema.discordGameRoles.gameId, gameId))
    .returning({ id: schema.discordGameRoles.id });
  return rows.length > 0;
}

const auditUserId = sql<number>`(${schema.activityLog.metadata}->>'userId')::int`;

const AUDIT_COLUMNS = {
  userId: auditUserId,
  username: schema.users.username,
  action: schema.activityLog.action,
  reason: sql<string>`COALESCE(${schema.activityLog.metadata}->>'reason', '')`,
  at: schema.activityLog.createdAt,
};

/** Latest audit rows for one game's role, newest first. */
export async function listGameRoleAudit(
  db: GameRoleDb,
  gameId: number,
  limit: number,
): Promise<GameRoleAuditEntryDto[]> {
  const a = schema.activityLog;
  const r = schema.discordGameRoles;
  const rows = await db
    .select(AUDIT_COLUMNS)
    .from(a)
    .innerJoin(r, eq(r.id, a.entityId))
    .leftJoin(schema.users, eq(schema.users.id, auditUserId))
    .where(and(eq(a.entityType, GAME_ROLE_ENTITY_TYPE), eq(r.gameId, gameId)))
    .orderBy(desc(a.createdAt), desc(a.id))
    .limit(limit);
  return rows.map((row) => ({
    userId: Number(row.userId),
    username: row.username ?? 'Unknown user',
    action: row.action === 'role_removed' ? 'role_removed' : 'role_added',
    reason: row.reason,
    at: row.at.toISOString(),
  }));
}
