import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

/**
 * ROK-1870 L2a — the write/read primitives of `hub_community_members`. Each
 * takes a db OR a transaction handle so the L3 service can compose them
 * inside one transaction (`swapLeader` MUST run in one).
 */

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** A db or an open transaction. */
export type DbOrTx = Db | Tx;

/** One `hub_community_members` row. */
export type HubCommunityMemberRow = schema.HubCommunityMemberSelect;
/** The D4 role of a live member. */
export type CommunityRole = HubCommunityMemberRow['role'];

const m = schema.hubCommunityMembers;

/** Live = not left/removed and not banned. */
export function liveMemberPredicate(): SQL {
  return sql`${m.leftAt} IS NULL AND ${m.bannedAt} IS NULL`;
}

function rowKey(guildId: number, userId: number): SQL | undefined {
  return and(eq(m.guildId, guildId), eq(m.userId, userId));
}

/** The user's row in the hub (live, left or banned), or null. */
export async function findMembership(
  db: DbOrTx,
  guildId: number,
  userId: number,
): Promise<HubCommunityMemberRow | null> {
  const [row] = await db.select().from(m).where(rowKey(guildId, userId));
  return row ?? null;
}

/**
 * Join (idempotent). Inserts a live row, or revives a left/removed one
 * (same `id`, fresh `joined_at`). A banned row and an already-live row are
 * left untouched. Always resolves to the row as it now stands — the caller
 * checks `bannedAt` (banned ⇒ refuse).
 */
export async function upsertJoin(
  db: DbOrTx,
  guildId: number,
  userId: number,
  role: CommunityRole = 'member',
): Promise<HubCommunityMemberRow> {
  const now = new Date();
  const [row] = await db
    .insert(m)
    .values({ guildId, userId, role, joinedAt: now })
    .onConflictDoUpdate({
      target: [m.guildId, m.userId],
      set: {
        role,
        leftAt: null,
        removedBy: null,
        joinedAt: now,
        updatedAt: now,
      },
      setWhere: sql`${m.bannedAt} IS NULL AND ${m.leftAt} IS NOT NULL`,
    })
    .returning();
  if (row) return row;
  const current = await findMembership(db, guildId, userId);
  if (!current) throw new Error(`hub ${guildId} member ${userId} vanished`);
  return current;
}

/** Leave (`removedBy` null) or remove; false when the user was not live. */
export async function markLeft(
  db: DbOrTx,
  guildId: number,
  userId: number,
  removedBy: number | null,
): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(m)
    .set({ leftAt: now, removedBy, updatedAt: now })
    .where(and(rowKey(guildId, userId), liveMemberPredicate()))
    .returning({ id: m.id });
  return rows.length > 0;
}

/** Inputs of `ban`. */
export interface BanInput {
  guildId: number;
  userId: number;
  bannedBy: number;
  reason: string | null;
}

/** The awaitable, SQL-renderable upsert `ban` runs. */
export type BanStatement = PromiseLike<unknown> & {
  toSQL(): { sql: string; params: unknown[] };
};

/**
 * The ban upsert. Every timestamp is bound through column typing — a raw
 * `Date` inside a `sql` fragment reaches postgres.js unserialised and throws
 * (M2). On conflict `left_at` keeps its value, else takes the inserted one.
 */
export function banUpsert(
  db: DbOrTx,
  input: BanInput,
  now: Date,
): BanStatement {
  const fields = {
    bannedAt: now,
    bannedBy: input.bannedBy,
    banReason: input.reason,
    updatedAt: now,
  };
  return db
    .insert(m)
    .values({
      guildId: input.guildId,
      userId: input.userId,
      role: 'member',
      leftAt: now,
      ...fields,
    })
    .onConflictDoUpdate({
      target: [m.guildId, m.userId],
      set: { ...fields, leftAt: sql`COALESCE(${m.leftAt}, excluded.left_at)` },
    });
}

/** D7 ban (idempotent) — ends a live membership; pre-bans a non-member. */
export async function ban(db: DbOrTx, input: BanInput): Promise<void> {
  await banUpsert(db, input, new Date());
}

/** Clear the ban only — the user must Join again. False when not banned. */
export async function unban(
  db: DbOrTx,
  guildId: number,
  userId: number,
): Promise<boolean> {
  const rows = await db
    .update(m)
    .set({
      bannedAt: null,
      bannedBy: null,
      banReason: null,
      updatedAt: new Date(),
    })
    .where(and(rowKey(guildId, userId), isNotNull(m.bannedAt)))
    .returning({ id: m.id });
  return rows.length > 0;
}

/** Set a live member's role; null when the user is not live. */
export async function setRole(
  db: DbOrTx,
  guildId: number,
  userId: number,
  role: CommunityRole,
): Promise<HubCommunityMemberRow | null> {
  const [row] = await db
    .update(m)
    .set({ role, updatedAt: new Date() })
    .where(and(rowKey(guildId, userId), liveMemberPredicate()))
    .returning();
  return row ?? null;
}

/**
 * D5 transfer: demote the live Leader to officer, then promote `toUserId`.
 * Run inside a transaction — false (target not live) means roll back.
 */
export async function swapLeader(
  tx: DbOrTx,
  guildId: number,
  toUserId: number,
): Promise<boolean> {
  const target = await findMembership(tx, guildId, toUserId);
  if (!target || target.leftAt !== null || target.bannedAt !== null) {
    return false;
  }
  await tx
    .update(m)
    .set({ role: 'officer', updatedAt: new Date() })
    .where(
      and(
        eq(m.guildId, guildId),
        eq(m.role, 'leader'),
        isNull(m.leftAt),
        isNull(m.bannedAt),
      ),
    );
  return (await setRole(tx, guildId, toUserId, 'leader')) !== null;
}

/** Recount live members on active accounts into `guilds.member_count` (M11). */
export async function refreshMemberCount(
  db: DbOrTx,
  guildId: number,
): Promise<number> {
  const g = schema.guilds;
  const [row] = await db
    .update(g)
    .set({
      memberCount: sql`(SELECT count(*)::int FROM ${m} JOIN ${schema.users} ON ${schema.users.id} = ${m.userId} WHERE ${m.guildId} = ${guildId} AND ${liveMemberPredicate()} AND ${schema.users.deactivatedAt} IS NULL)`,
      updatedAt: new Date(),
    })
    .where(eq(g.id, guildId))
    .returning({ memberCount: g.memberCount });
  return row?.memberCount ?? 0;
}
