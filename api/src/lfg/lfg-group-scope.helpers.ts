/**
 * ROK-2352 — which hands a group read or withdraw covers.
 *
 * A scope is one group key, or `null` = every live hand of the game: the fold
 * (§3.7 — no active `lfg-grouping` adapter, so keys are ignored) and
 * `DELETE ?group=*`. A non-WoW game only ever holds `''` hands, so `null` and
 * `''` read the same rows there — today's behaviour exactly.
 */
import { BadRequestException } from '@nestjs/common';
import { and, asc, eq, gt, ne, sql, type SQL } from 'drizzle-orm';
import {
  LFG_ALL_GROUPS_KEY,
  LFG_ANY_GROUP_KEY,
  type LfgGroupRefDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type {
  LfgGroupingAdapter,
  LfgGroupingGameContext,
} from '../plugins/plugin-host/lfg-grouping.adapter';
import {
  resolveLfgGrouping,
  type LfgGroupingRegistry,
} from './lfg-grouping.helpers';
import type { LfgDb } from './lfg-query.helpers';
import type { LfgIntentRow } from './lfg-write.helpers';

/** A group key, or null for "every hand of the game". */
export type LfgGroupScope = string | null;

/** The group a detail read is about, as the service resolved it. */
export interface LfgDetailGroup {
  scope: LfgGroupScope;
  label: string | null;
  /** Labels the caller's other groups; absent when the game is folded. */
  describe?: (groupKey: string) => Promise<string | null>;
}

/** Extra WHERE clause for a scope; undefined = the whole game. */
export function groupScopeFilter(scope: LfgGroupScope): SQL | undefined {
  return scope === null ? undefined : eq(schema.lfgIntents.groupKey, scope);
}

/**
 * The scope a read covers: no adapter → the fold (`null`), whatever was
 * asked; otherwise the requested key (default `''`).
 */
export function resolveReadGroupScope(
  adapter: LfgGroupingAdapter | null,
  requested: string | undefined,
): LfgGroupScope {
  if (adapter === null) return null;
  return requested ?? LFG_ANY_GROUP_KEY;
}

/**
 * {@link resolveReadGroupScope} straight from the registry — the one call the
 * group-page reads (overlap, suggestions) and invites make.
 *
 * @param registry - Plugin registry (suspended adapters fold).
 * @param gameSlug - The game's slug.
 * @param requested - `?group`, already grammar-checked.
 */
export function resolveGameReadScope(
  registry: LfgGroupingRegistry,
  gameSlug: string,
  requested: string | undefined,
): LfgGroupScope {
  return resolveReadGroupScope(
    resolveLfgGrouping(registry, gameSlug),
    requested,
  );
}

/**
 * The hands a withdraw clears. Folded game → every hand (the viewer sees one
 * group, so withdrawing it must empty it); `*` → every hand; else that group.
 */
export function resolveWithdrawScope(
  adapter: LfgGroupingAdapter | null,
  requested: string | undefined,
): LfgGroupScope {
  if (adapter === null || requested === LFG_ALL_GROUPS_KEY) return null;
  return requested ?? LFG_ANY_GROUP_KEY;
}

/**
 * Resolve `?group` for the detail read; an unknown key with an active
 * adapter is a 400, the same rule the write path applies.
 */
export async function resolveDetailGroup(
  adapter: LfgGroupingAdapter | null,
  ctx: LfgGroupingGameContext,
  requested: string | undefined,
): Promise<LfgDetailGroup> {
  if (adapter === null) return { scope: null, label: null };
  const describe = async (key: string): Promise<string | null> =>
    key === LFG_ANY_GROUP_KEY
      ? null
      : ((await adapter.describeGroup(ctx, key))?.label ?? null);
  const scope = requested ?? LFG_ANY_GROUP_KEY;
  if (scope === LFG_ANY_GROUP_KEY) return { scope, label: null, describe };
  const group = await adapter.describeGroup(ctx, scope);
  if (group === null) {
    throw new BadRequestException(`Unknown LFG group "${scope}"`);
  }
  return { scope, label: group.label, describe };
}

/** `count(DISTINCT user_id)` — one user may hold hands in several groups. */
export function distinctUsers(): SQL<number> {
  return sql<number>`count(distinct ${schema.lfgIntents.userId})`.mapWith(
    Number,
  );
}

/** Members of a scope; the fold keeps one row per user. */
export function membersForScope<
  T extends { userId: number; expiresAt: string },
>(rows: T[], scope: LfgGroupScope): T[] {
  return scope === null ? dedupeMembersByUser(rows) : rows;
}

/** Fold de-dupe: one member per user, the soonest-expiring hand wins. */
export function dedupeMembersByUser<
  T extends { userId: number; expiresAt: string },
>(rows: T[]): T[] {
  const best = new Map<number, T>();
  for (const row of rows) {
    const held = best.get(row.userId);
    if (!held || row.expiresAt < held.expiresAt) best.set(row.userId, row);
  }
  const seen = new Set<number>();
  return rows.flatMap((row) => {
    if (seen.has(row.userId)) return [];
    seen.add(row.userId);
    const kept = best.get(row.userId);
    return kept ? [kept] : [];
  });
}

/**
 * The caller's live hand in a scope; for the fold, the soonest-expiring one.
 *
 * @param db - Drizzle handle.
 * @param userId - Caller.
 * @param gameId - Game.
 * @param scope - Group key, or null for any group of the game.
 */
export async function findOwnLiveHand(
  db: LfgDb,
  userId: number,
  gameId: number,
  scope: LfgGroupScope,
): Promise<LfgIntentRow | null> {
  const t = schema.lfgIntents;
  const [row] = await db
    .select()
    .from(t)
    .where(and(ownLive(userId, gameId), groupScopeFilter(scope)))
    .orderBy(asc(t.expiresAt))
    .limit(1);
  return row ?? null;
}

/** The caller's live hands in OTHER groups of the game, labelled. */
export async function listOwnOtherGroups(
  db: LfgDb,
  userId: number,
  gameId: number,
  group: LfgDetailGroup,
): Promise<LfgGroupRefDto[]> {
  const { scope, describe } = group;
  if (scope === null || describe === undefined) return [];
  const t = schema.lfgIntents;
  const rows = await db
    .select({ groupKey: t.groupKey })
    .from(t)
    .where(and(ownLive(userId, gameId), ne(t.groupKey, scope)))
    .orderBy(asc(t.createdAt));
  return Promise.all(
    rows.map(async (r) => ({
      groupKey: r.groupKey,
      groupLabel: await describe(r.groupKey),
    })),
  );
}

/**
 * Withdraw: flip the caller's active row to `cleared`. Never touches anyone
 * else's row.
 *
 * @param db - Drizzle handle.
 * @param userId - Intent holder.
 * @param gameId - Game to withdraw from.
 * @param scope - ROK-2352: one group, or null = every hand in the game.
 * @returns True when a row was cleared, false when the caller held none.
 */
export async function clearIntent(
  db: LfgDb,
  userId: number,
  gameId: number,
  scope: LfgGroupScope = null,
): Promise<boolean> {
  const rows = await db
    .update(schema.lfgIntents)
    .set({ status: 'cleared' })
    .where(
      and(
        eq(schema.lfgIntents.userId, userId),
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'active'),
        groupScopeFilter(scope),
      ),
    )
    .returning({ id: schema.lfgIntents.id });
  return rows.length > 0;
}

function ownLive(userId: number, gameId: number): SQL | undefined {
  const t = schema.lfgIntents;
  return and(
    eq(t.userId, userId),
    eq(t.gameId, gameId),
    eq(t.status, 'active'),
    gt(t.expiresAt, new Date()),
  );
}
