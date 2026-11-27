/**
 * ROK-2352 §3.2 — the once-only "your hand for X was withdrawn because you're
 * in Y now" notice. A lock-in / start that consumes a member's other `now`
 * hand stamps `cleared_reason` + `cleared_into_group_key`
 * (`clearNowSiblings`); this file reads the owner's unseen ones and marks
 * them seen. A user's own Withdraw writes no reason, so it never shows here.
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  LFG_ANY_GROUP_KEY,
  type LfgClearedHandNoticeDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import type { LfgGameRef } from './lfg-group-scope.helpers';
import type { LfgDb } from './lfg-query.helpers';

/** Most notices one read returns (a burst of lock-ins is still bounded). */
export const LFG_HAND_NOTICE_LIMIT = 20;

/** The owner's cleared-with-a-reason rows not yet acknowledged. */
function unseenNotice(userId: number) {
  const t = schema.lfgIntents;
  return and(
    eq(t.userId, userId),
    eq(t.status, 'cleared'),
    isNotNull(t.clearedReason),
    isNull(t.clearedNoticeSeenAt),
  );
}

/** Memoised key → instance name; `''` and unknown keys → null. */
function groupLabeller(
  adapter: LfgGroupingAdapter | null,
  game: LfgGameRef,
): (key: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  const ctx = { gameId: game.id, gameSlug: game.slug };
  return (key) => {
    if (adapter === null || key === LFG_ANY_GROUP_KEY) {
      return Promise.resolve(null);
    }
    const hit = cache.get(key);
    if (hit) return hit;
    const label = adapter
      .describeGroup(ctx, key)
      .then((g) => g?.label ?? null);
    cache.set(key, label);
    return label;
  };
}

/**
 * The viewer's unseen "hand withdrawn" notices on one game, oldest first.
 *
 * @param db - Drizzle handle.
 * @param game - The game being read.
 * @param viewerId - Whose notices.
 * @param adapter - The game's active grouping adapter (labels), or null.
 */
export async function listClearedHandNotices(
  db: LfgDb,
  game: LfgGameRef,
  viewerId: number,
  adapter: LfgGroupingAdapter | null,
): Promise<LfgClearedHandNoticeDto[]> {
  const t = schema.lfgIntents;
  const rows = await db
    .select({ id: t.id, from: t.groupKey, to: t.clearedIntoGroupKey })
    .from(t)
    .where(and(unseenNotice(viewerId), eq(t.gameId, game.id)))
    .orderBy(asc(t.id))
    .limit(LFG_HAND_NOTICE_LIMIT);
  const label = groupLabeller(adapter, game);
  return Promise.all(
    rows.map(async (r) => {
      const to = r.to ?? LFG_ANY_GROUP_KEY;
      return {
        intentId: r.id,
        fromGroupKey: r.from,
        fromLabel: await label(r.from),
        toGroupKey: to,
        toLabel: await label(to),
      };
    }),
  );
}

/**
 * Mark notices seen. Owner-only by construction: ids that are not the
 * caller's (or carry no notice, or were already seen) are silently skipped.
 *
 * @param db - Drizzle handle.
 * @param userId - The caller.
 * @param intentIds - Notices the caller has seen.
 * @returns How many notices were newly marked seen.
 */
export async function ackClearedHandNotices(
  db: LfgDb,
  userId: number,
  intentIds: readonly number[],
): Promise<number> {
  if (intentIds.length === 0) return 0;
  const t = schema.lfgIntents;
  const rows = await db
    .update(t)
    .set({ clearedNoticeSeenAt: sql`now()` })
    .where(and(unseenNotice(userId), inArray(t.id, [...intentIds])))
    .returning({ id: t.id });
  return rows.length;
}
