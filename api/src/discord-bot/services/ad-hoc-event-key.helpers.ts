/**
 * The `activeEvents` map's key scheme, extracted from `AdHocEventService`
 * (ROK-1505 AC10a kept that file at its 300-line ceiling).
 *
 * Pure functions over the map rather than methods, so the key shape has ONE
 * definition and a caller cannot accidentally build a near-miss key: a fixed
 * game binding keys `bindingId:gameId`, the ROK-1394 degrade path keys
 * `bindingId:null`, and a binding with no game at all keys the bare id.
 */
import type { ActiveAdHocState } from './ad-hoc-event.handlers';

/** The map an ad-hoc service keeps its live events in. */
export type ActiveEventMap = Map<string, ActiveAdHocState>;

/**
 * Build the `activeEvents` key for a binding + game pair.
 *
 * @param bindingId - Channel binding the event belongs to.
 * @param gameId - Resolved game, `null` for the degrade path, omitted when the
 *   binding carries no game concept at all.
 * @returns The map key.
 */
export function buildEventKey(
  bindingId: string,
  gameId?: number | null,
): string {
  if (gameId !== undefined && gameId !== null) return `${bindingId}:${gameId}`;
  if (gameId === null) return `${bindingId}:null`;
  return bindingId;
}

/**
 * Find the key of the event a leaving member actually belongs to.
 *
 * Tries the game-keyed lookup first, then the bare binding, then falls back to
 * scanning the binding's keys for one whose roster holds the member — a leave
 * can arrive with a different resolved game than the join did.
 *
 * @param activeEvents - The live-event map.
 * @param bindingId - Channel binding the member left.
 * @param discordUserId - Who left.
 * @param gameId - Game resolved for the leave, when one was.
 * @returns The map key, or null when the binding has no event for them.
 */
export function findEventKeyForMember(
  activeEvents: ActiveEventMap,
  bindingId: string,
  discordUserId: string,
  gameId?: number | null,
): string | null {
  if (gameId !== undefined) {
    const key = buildEventKey(bindingId, gameId);
    if (activeEvents.has(key)) return key;
  }
  if (activeEvents.has(bindingId)) return bindingId;
  for (const [key, state] of activeEvents) {
    if (
      (key === bindingId || key.startsWith(`${bindingId}:`)) &&
      state.memberSet.has(discordUserId)
    )
      return key;
  }
  return null;
}
