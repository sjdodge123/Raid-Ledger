/**
 * Admin-actions audit helpers (ROK-313 §3c).
 * Writes to and reads from `admin_actions`. Both `actorId` and `targetId` are
 * `ON DELETE SET NULL` (§9.9): once a moderated user is later HARD-deleted their
 * audit rows survive but become unreachable via `getAdminActionsForUser` because
 * `target_id` is NULL. Accepted tradeoff — the audit trail is preserved, just no
 * longer target-addressable.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { alias } from 'drizzle-orm/pg-core';
import { desc, eq, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { AdminActionDto, AdminActionsListResponseDto } from '@raid-ledger/contract';

type Db = PostgresJsDatabase<typeof schema>;

/** Moderation action kinds recorded in `admin_actions.action`. */
export type AdminActionKind = 'kick' | 'unkick' | 'ban' | 'unban' | 'role_change';

export interface InsertAdminActionInput {
  action: AdminActionKind;
  actorId: number | null;
  targetId: number | null;
  reason?: string | null;
  /** JSON string, e.g. `{"dataWiped":true,"discordKicked":false}`. */
  metadata?: string | null;
}

/** Insert one audit row. Callers gate this on a moderation write RETURNING a row
 * so a retry does not append a duplicate (§9.10 #4). */
export async function insertAdminAction(
  db: Db,
  input: InsertAdminActionInput,
): Promise<void> {
  await db.insert(schema.adminActions).values({
    action: input.action,
    actorId: input.actorId,
    targetId: input.targetId,
    reason: input.reason ?? null,
    metadata: input.metadata ?? null,
  });
}

interface AdminActionRow {
  id: number;
  action: string;
  actorId: number | null;
  targetId: number | null;
  actorUsername: string | null;
  targetUsername: string | null;
  reason: string | null;
  metadata: string | null;
  createdAt: Date;
}

function mapAdminActionRow(row: AdminActionRow): AdminActionDto {
  return {
    id: row.id,
    action: row.action as AdminActionDto['action'],
    actorId: row.actorId,
    targetId: row.targetId,
    actorUsername: row.actorUsername,
    targetUsername: row.targetUsername,
    reason: row.reason,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Paginated audit history for one target user, newest first, with actor/target
 * usernames joined (§3c). */
export async function getAdminActionsForUser(
  db: Db,
  targetId: number,
  page: number,
  limit: number,
): Promise<AdminActionsListResponseDto> {
  const actor = alias(schema.users, 'actor');
  const target = alias(schema.users, 'target');
  const offset = (page - 1) * limit;
  const where = eq(schema.adminActions.targetId, targetId);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.adminActions)
    .where(where);
  const rows = await db
    .select({
      id: schema.adminActions.id,
      action: schema.adminActions.action,
      actorId: schema.adminActions.actorId,
      targetId: schema.adminActions.targetId,
      actorUsername: actor.username,
      targetUsername: target.username,
      reason: schema.adminActions.reason,
      metadata: schema.adminActions.metadata,
      createdAt: schema.adminActions.createdAt,
    })
    .from(schema.adminActions)
    .leftJoin(actor, eq(schema.adminActions.actorId, actor.id))
    .leftJoin(target, eq(schema.adminActions.targetId, target.id))
    .where(where)
    .orderBy(desc(schema.adminActions.createdAt))
    .limit(limit)
    .offset(offset);
  const total = Number(countRow.count);
  return {
    data: rows.map(mapAdminActionRow),
    meta: { total, page, limit, hasMore: offset + rows.length < total },
  };
}
