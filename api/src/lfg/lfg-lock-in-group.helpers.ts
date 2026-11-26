/**
 * ROK-2352 §3.2 / §3.8 — which hands a Lock-in converts, what the grouping
 * adapter adds to the event, and the `now`-only sibling rule (Q1).
 *
 * Every function that takes a `tx` must run on the transaction holding the
 * per-GAME advisory lock (`lfgGroupLockKey(gameId)`): two Lock-ins of
 * different groups of one game are serialized, so the second re-reads live
 * hands after the first cleared its members' `now` siblings (AC6).
 */
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type {
  LfgGroupingAdapter,
  LfgLockInPatch,
} from '../plugins/plugin-host/lfg-grouping.adapter';
import {
  groupScopeFilter,
  type LfgGroupScope,
} from './lfg-group-scope.helpers';
import { LFG_ANY_GROUP_KEY } from '@raid-ledger/contract';
import {
  resolveLfgGrouping,
  resolveWriteGroupKey,
  type LfgGroupingRegistry,
} from './lfg-grouping.helpers';
import type { LfgDb } from './lfg-query.helpers';
import { liveGroupRow } from './lfg-write.helpers';

/** The group a Lock-in converts, as resolved before the lock is taken. */
export interface LfgLockInGroup {
  /** One group key, or null = every live hand of the game (the fold). */
  scope: LfgGroupScope;
  /** The game's active grouping adapter; null when folded. */
  adapter: LfgGroupingAdapter | null;
  /** ROK-2352: the instance picked when locking in the Any (`''`) group. */
  chosenGroupKey?: string;
}

/** No adapter: today's behaviour — the whole game is one group. */
export const LFG_FOLD_LOCK_IN: LfgLockInGroup = { scope: null, adapter: null };

/**
 * Resolve the group a Lock-in names. No active adapter (or no such game) →
 * the fold, whatever was asked (§3.7). With an adapter, absent / `''` → the
 * "any" group and an unknown key → 400 (same rule as writes).
 *
 * @param db - Drizzle handle.
 * @param registry - Plugin registry (suspended adapters are not returned).
 * @param gameId - The `lfgGameId`.
 * @param requested - The `lfgGroupKey` from the body.
 * @param chosen - The `lfgChosenGroupKey` from the body: only read when the
 *   Lock-in is the Any (`''`) group; a keyed group IS its instance.
 * @throws BadRequestException on a key the active adapter does not know.
 */
export async function resolveLockInGroup(
  db: LfgDb,
  registry: LfgGroupingRegistry,
  gameId: number,
  requested: string | undefined,
  chosen?: string,
): Promise<LfgLockInGroup> {
  const [game] = await db
    .select({ slug: schema.games.slug })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  if (!game) return LFG_FOLD_LOCK_IN;
  const adapter = resolveLfgGrouping(registry, game.slug);
  if (adapter === null) return LFG_FOLD_LOCK_IN;
  const ctx = { gameId, gameSlug: game.slug };
  const scope = await resolveWriteGroupKey(adapter, ctx, requested);
  if (scope !== LFG_ANY_GROUP_KEY || !chosen) return { scope, adapter };
  const chosenGroupKey = await resolveWriteGroupKey(adapter, ctx, chosen);
  return { scope, adapter, chosenGroupKey };
}

/**
 * The live hands a Lock-in of `scope` converts (read-side liveness, Codex
 * P2-a, narrowed to the group).
 */
export function liveLockInRows(
  db: LfgDb,
  gameId: number,
  scope: LfgGroupScope,
  now: Date,
): SQL | undefined {
  return and(liveGroupRow(db, gameId, now), groupScopeFilter(scope));
}

/** Intent ids of the group's live hands, read inside the lock. */
async function liveGroupIntentIds(
  tx: LfgDb,
  gameId: number,
  scope: LfgGroupScope,
): Promise<number[]> {
  const rows = await tx
    .select({ id: schema.lfgIntents.id })
    .from(schema.lfgIntents)
    .where(liveLockInRows(tx, gameId, scope, new Date()));
  return rows.map((r) => r.id);
}

/**
 * The adapter's roster / instance / title / carryover for the group about to
 * convert; undefined when the game is folded (generic roster, no carryover).
 *
 * @param tx - The locked transaction.
 * @param gameId - Game locking in.
 * @param group - From {@link resolveLockInGroup}.
 */
export async function buildGroupLockInPatch(
  tx: LfgDb,
  gameId: number,
  group: LfgLockInGroup,
): Promise<LfgLockInPatch | undefined> {
  if (group.adapter === null || group.scope === null) return undefined;
  const memberIntentIds = await liveGroupIntentIds(tx, gameId, group.scope);
  return group.adapter.buildLockInPatch(tx, {
    gameId,
    groupKey: group.scope,
    memberIntentIds,
    ...(group.chosenGroupKey ? { chosenGroupKey: group.chosenGroupKey } : {}),
  });
}

/**
 * Q1 — the converted members' OTHER live hands in the game with urgency
 * `now` are cleared in the same transaction; `tonight` and `week` hands stay
 * up ("tonight could still mean later"). Runs after the group converted, so
 * the group's own rows are no longer `active` and are never touched.
 *
 * @param tx - The locked transaction.
 * @param gameId - Game locking in.
 * @param userIds - The converted members.
 * @returns The users whose sibling hand was cleared.
 */
export async function clearNowSiblings(
  tx: LfgDb,
  gameId: number,
  userIds: readonly number[],
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = await tx
    .update(schema.lfgIntents)
    .set({ status: 'cleared' })
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'active'),
        eq(schema.lfgIntents.urgency, 'now'),
        inArray(schema.lfgIntents.userId, [...userIds]),
      ),
    )
    .returning({ userId: schema.lfgIntents.userId });
  return [...new Set(rows.map((r) => r.userId))];
}
