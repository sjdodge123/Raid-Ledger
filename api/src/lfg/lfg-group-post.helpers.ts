/**
 * ROK-2352 — the group half of `POST /lfg`: which group a hand lands in
 * (folded by `resolveLfgGrouping`) and the plugin detail stored with it.
 */
import { BadRequestException } from '@nestjs/common';
import { LFG_ANY_GROUP_KEY } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import type { LfgDb } from './lfg-query.helpers';
import { findActiveIntent, type LfgUrgencyRequest } from './lfg-write.helpers';
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
  /**
   * The write must carry `handDetail` unless the user already holds a live
   * hand in this group — checked under the lock by {@link assertHandDetailIfNew}.
   */
  detailRequired: boolean;
}

/** How strict a write is about the hand's plugin detail. */
export interface LfgPostWriteOptions {
  /**
   * Spec §3.3 / AC3: an HTTP hand in a plugin group (adapter active, key not
   * `''`) must carry `handDetail` (WoW: roles). Discord callers leave it off —
   * their hands legitimately have none (Q8).
   */
  requireHandDetail?: boolean;
}

/**
 * Resolve the adapter and fold/validate the requested group (§3.7).
 *
 * @param registry - Plugin registry.
 * @param game - The (visible) game being posted to.
 * @param opts - The parsed request.
 * @param write - {@link LfgPostWriteOptions}.
 */
export async function resolvePostGroup(
  registry: LfgGroupingRegistry,
  game: typeof schema.games.$inferSelect,
  opts: LfgPostRequest,
  write: LfgPostWriteOptions = {},
): Promise<ResolvedLfgPost> {
  const grouping = resolveLfgGrouping(registry, game.slug);
  const ctx = { gameId: game.id, gameSlug: game.slug };
  const groupKey = await resolveWriteGroupKey(grouping, ctx, opts.groupKey);
  const keyed = grouping !== null && groupKey !== LFG_ANY_GROUP_KEY;
  const detailRequired =
    write.requireHandDetail === true && keyed && opts.handDetail === undefined;
  return { grouping, opts: { ...opts, groupKey }, detailRequired };
}

/**
 * §3.3 on the locked tx: a NEW keyed HTTP hand must carry `handDetail`. A
 * re-post into a group the user already holds a live hand in (the Manage
 * dialog's urgency change) keeps the stored detail, so it needs none — and a
 * Discord-raised hand never had one to resend (review r2 MAJOR-A).
 *
 * @param tx - The transaction holding the per-game lock.
 * @param userId - Caller.
 * @param gameId - Game being posted to.
 * @param post - From {@link resolvePostGroup}.
 * @throws BadRequestException when the detail is required and missing.
 */
export async function assertHandDetailIfNew(
  tx: LfgDb,
  userId: number,
  gameId: number,
  post: ResolvedLfgPost,
): Promise<void> {
  if (!post.detailRequired) return;
  const existing = await findActiveIntent(tx, userId, gameId, post.opts.groupKey);
  if (existing !== null) return;
  throw new BadRequestException({
    handDetail: ['Required when raising a hand in this group'],
  });
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
