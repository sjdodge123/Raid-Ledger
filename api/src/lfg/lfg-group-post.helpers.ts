/**
 * ROK-2352 — the group half of `POST /lfg`: which group a hand lands in
 * (folded by `resolveLfgGrouping`) and the plugin detail stored with it.
 */
import type * as schema from '../drizzle/schema';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import type { LfgDb } from './lfg-query.helpers';
import type { LfgUrgencyRequest } from './lfg-write.helpers';
import {
  resolveLfgGrouping,
  resolveWriteGroupKey,
  type LfgGroupingRegistry,
} from './lfg-grouping.helpers';

/** A post's class + group, plus the plugin detail for the hand. */
export interface LfgPostRequest extends LfgUrgencyRequest {
  /** Validated and stored by the active grouping adapter; ignored on fold. */
  handDetail?: Record<string, unknown>;
}

/** The request with its group key folded, and the adapter that owns it. */
export interface ResolvedLfgPost {
  grouping: LfgGroupingAdapter | null;
  opts: LfgPostRequest & { groupKey: string };
}

/**
 * Resolve the adapter and fold/validate the requested group (§3.7).
 *
 * @param registry - Plugin registry.
 * @param game - The (visible) game being posted to.
 * @param opts - The parsed request.
 */
export async function resolvePostGroup(
  registry: LfgGroupingRegistry,
  game: typeof schema.games.$inferSelect,
  opts: LfgPostRequest,
): Promise<ResolvedLfgPost> {
  const grouping = resolveLfgGrouping(registry, game.slug);
  const ctx = { gameId: game.id, gameSlug: game.slug };
  const groupKey = await resolveWriteGroupKey(grouping, ctx, opts.groupKey);
  return { grouping, opts: { ...opts, groupKey } };
}

/**
 * Store the hand's plugin detail on the locked tx; skipped on fold (no
 * adapter) or when the client sent none.
 *
 * @param tx - The transaction holding the per-game lock.
 * @param post - From {@link resolvePostGroup}.
 * @param hand - The hand that landed.
 */
export async function saveHandDetailIfAny(
  tx: LfgDb,
  post: ResolvedLfgPost,
  hand: { intentId: number; userId: number; gameId: number },
): Promise<void> {
  if (post.grouping === null || post.opts.handDetail === undefined) return;
  await post.grouping.saveHandDetail(tx, hand, post.opts.handDetail);
}
