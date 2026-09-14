/**
 * ROK-1499 — the flush's two occupancy-ledger errands.
 *
 * Split out of `channel-presence-flush.ts` only to keep that file under the
 * 300-line cap; both are called from the live and empty ladders there and
 * neither has meaning apart from them.
 */
import type { ChannelFlush } from './channel-presence-flush';
import { reconcileOccupancy } from './channel-presence-occupancy.helpers';
import { hydrateRoomRecap } from './channel-presence-room-recap.hydrate';
import type { RoomRecap } from './channel-presence-room-recap.helpers';
import type { ResolvedRoom } from './channel-presence-room.helpers';
import type { PresenceRow } from './channel-presence-store.helpers';

/**
 * Level the occupancy ledger with the room this flush just resolved (ROK-1499).
 *
 * Runs on EVERY live flush, including the one that opens the message: the
 * ledger is the only record of who was in voice, and a room that empties one
 * tick after it opened would otherwise recap as though nobody had been there.
 */
export async function recordOccupancy(
  flush: ChannelFlush,
  rowId: string,
  room: ResolvedRoom,
  now: number,
): Promise<void> {
  if (!room.members) {
    // `resolveRoom` always fills this; a room that reaches here without it was
    // hand-built, and reconciling an empty map would close every stay and
    // recap the room as deserted — precisely the prod bug this story closes.
    // Say so rather than write the wrong thing quietly.
    flush.logger.warn(
      `Room ${flush.channelId} resolved without a member map; skipping occupancy (ROK-1499)`,
    );
    return;
  }
  await reconcileOccupancy(flush.deps.db, rowId, room.members, new Date(now));
}

/**
 * Summarise who was in the room and what they played (ROK-1499).
 *
 * @param endedAt - `empty_since`, never `now` — the recap's payload hash has
 *   to hold still for the whole grace window (S-5).
 */
export async function roomRecapFor(
  flush: ChannelFlush,
  row: PresenceRow,
  endedAt: Date,
): Promise<RoomRecap> {
  const cached = flush.roomRecaps?.get(row.id);
  if (cached && cached.endedAt === endedAt.getTime()) return cached.recap;
  const recap = await hydrateRoomRecap(flush.deps.db, row, endedAt);
  flush.roomRecaps?.set(row.id, { endedAt: endedAt.getTime(), recap });
  return recap;
}
