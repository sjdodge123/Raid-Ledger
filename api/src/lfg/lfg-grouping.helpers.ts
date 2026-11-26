/**
 * ROK-2352 §3.7 — the single home of the fold rule: with no ACTIVE
 * `lfg-grouping` adapter for a game's slug, every `group_key` is ignored and
 * the game is one `''` group. A suspended adapter (owner plugin off) is not
 * returned by the registry, so "plugin off" and "no plugin" fold the same.
 *
 * Also the per-user live-hand cap (Q2), checked under the per-game lock.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { LFG_ANY_GROUP_KEY } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type {
  LfgGroupingAdapter,
  LfgGroupingGameContext,
} from '../plugins/plugin-host/lfg-grouping.adapter';
import type { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import type { LfgDb } from './lfg-query.helpers';
import { LFG_HAND_CAP_CODE, LFG_MAX_HANDS_PER_GAME } from './lfg.constants';

/** The slice of the registry the fold needs. */
export type LfgGroupingRegistry = Pick<PluginRegistryService, 'getAdapter'>;

/**
 * The active grouping adapter for a game, or null (→ fold to `''`).
 *
 * @param registry - Plugin registry (suspended adapters are not returned).
 * @param gameSlug - The game's slug.
 */
export function resolveLfgGrouping(
  registry: LfgGroupingRegistry,
  gameSlug: string,
): LfgGroupingAdapter | null {
  return (
    registry.getAdapter<LfgGroupingAdapter>(
      EXTENSION_POINTS.LFG_GROUPING,
      gameSlug,
    ) ?? null
  );
}

/**
 * The group a write lands in. No adapter → `''` whatever was asked (fold,
 * never a 400); `''`/absent → `''`; a key the adapter does not know → 400.
 *
 * @param adapter - From {@link resolveLfgGrouping}.
 * @param ctx - The game being written to.
 * @param requested - The client's `groupKey`, already grammar-checked.
 */
export async function resolveWriteGroupKey(
  adapter: LfgGroupingAdapter | null,
  ctx: LfgGroupingGameContext,
  requested: string | undefined,
): Promise<string> {
  if (adapter === null || !requested) return LFG_ANY_GROUP_KEY;
  const group = await adapter.describeGroup(ctx, requested);
  if (group === null) {
    throw new BadRequestException(`Unknown LFG group "${requested}"`);
  }
  return requested;
}

/**
 * Q2 — refuse a hand that would be the user's 6th live hand in the game.
 * Counts live hands in OTHER groups, so re-posting into a group the user
 * already holds (bump / revive) is never refused. Must run on the tx that
 * holds the per-game advisory lock (count-then-insert, no catch-and-retry).
 *
 * @param db - The locked transaction handle.
 * @param userId - Caller.
 * @param gameId - Game being written to.
 * @param groupKey - The (folded) group being written to.
 * @param now - Liveness instant.
 */
export async function assertHandCap(
  db: LfgDb,
  userId: number,
  gameId: number,
  groupKey: string,
  now: Date = new Date(),
): Promise<void> {
  const t = schema.lfgIntents;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        eq(t.gameId, gameId),
        eq(t.status, 'active'),
        gt(t.expiresAt, now),
        ne(t.groupKey, groupKey),
      ),
    );
  if ((row?.n ?? 0) >= LFG_MAX_HANDS_PER_GAME) {
    // Spec AC3: 400, with a stable `code` so clients need not key on status.
    throw new BadRequestException({
      statusCode: 400,
      message: `You can be in up to ${LFG_MAX_HANDS_PER_GAME} groups for this game`,
      code: LFG_HAND_CAP_CODE,
    });
  }
}
