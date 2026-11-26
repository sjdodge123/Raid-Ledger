/**
 * ROK-2352 — attach the active `lfg-grouping` adapter's per-member detail
 * (`LfgMemberDto.pluginDetail`) to a group roster. Core never interprets the
 * detail; the plugin's web `MemberBadges` renders it (WoW: roles + character).
 */
import type { LfgMemberDto } from '@raid-ledger/contract';
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import { liveIntent, type LfgDb } from './lfg-query.helpers';
import type { LfgGroupScope } from './lfg-group-scope.helpers';

/** userId → the live hand id in `scope` (one per user per group). */
async function liveHandIdsByUser(
  db: LfgDb,
  gameId: number,
  scope: string,
  userIds: number[],
): Promise<Map<number, number>> {
  const rows = await db
    .select({ id: schema.lfgIntents.id, userId: schema.lfgIntents.userId })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        inArray(schema.lfgIntents.userId, userIds),
        liveIntent(new Date(), scope),
      ),
    );
  return new Map(rows.map((r) => [r.userId, r.id]));
}

/**
 * The roster with each member's adapter detail. Unchanged without an adapter,
 * on the folded read (`scope` null) or for an empty roster.
 *
 * @param db - Drizzle handle.
 * @param adapter - The game's active grouping adapter, or null.
 * @param gameId - The group's game.
 * @param scope - The group key read, or null = the fold.
 * @param members - The roster `listGroupMembers` returned.
 */
export async function attachMemberDetails(
  db: LfgDb,
  adapter: LfgGroupingAdapter | null,
  gameId: number,
  scope: LfgGroupScope,
  members: LfgMemberDto[],
): Promise<LfgMemberDto[]> {
  if (!adapter || scope === null || members.length === 0) return members;
  const handByUser = await liveHandIdsByUser(
    db,
    gameId,
    scope,
    members.map((m) => m.userId),
  );
  if (handByUser.size === 0) return members;
  const details = await adapter.readMemberDetails({
    intentIds: [...handByUser.values()],
  });
  return members.map((m) => {
    const handId = handByUser.get(m.userId);
    const detail = handId === undefined ? undefined : details.get(handId);
    return detail ? { ...m, pluginDetail: detail } : m;
  });
}
