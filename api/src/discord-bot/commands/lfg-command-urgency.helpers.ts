/**
 * ROK-1656 — which horizon a `/lfg` hand is raised on.
 *
 * Kept out of `lfg.command.helpers.ts`, which is pure copy and components by
 * design: this one reads the database.
 */
import {
  horizonJoinRequest,
  readOpenGroupHorizon,
} from '../../lfg/lfg-group-horizon.helpers';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { LfgUrgencyRequest } from '../../lfg/lfg-write.helpers';
import { parseUrgencyChoice } from './lfg.command.helpers';

/**
 * Resolve the urgency a `/lfg <game>` hand is written with.
 *
 * The rule, in order:
 * 1. **An explicit `urgency:` always wins** and is read exactly as before
 *    ({@link parseUrgencyChoice}); the group is not even consulted (AC3).
 * 2. **No urgency, and the game has an open group** (at least one live hand):
 *    the hand joins it on the group's horizon and TTL bucket — the SAME two
 *    calls the board `+1` makes (`lfg-join.listener.ts`, ROK-1614), so a bare
 *    `/lfg` and a `+1` on that group can never write different hands. A game
 *    has ONE group, so "several open groups" means a group holding hands on
 *    several horizons; it resolves most-urgent-first, now > tonight > week
 *    (`readGroupHorizon`), which is also the order the board surfaces them in.
 * 3. **No urgency, no open group:** a fresh `tonight` hand (ROK-1656 AC1).
 *
 * The caller's OWN live hand counts toward "open": re-running a bare `/lfg`
 * then re-asserts the horizon the caller is already on rather than flipping it.
 *
 * @param db - Drizzle handle.
 * @param gameId - The resolved game.
 * @param raw - The raw `urgency` option value; null when the player gave none.
 * @returns The urgency part of the `createIntent` request.
 */
export async function resolveLfgCommandUrgency(
  db: LfgDb,
  gameId: number,
  raw: string | null,
): Promise<LfgUrgencyRequest> {
  if (raw !== null) return parseUrgencyChoice(raw);
  const open = await readOpenGroupHorizon(db, gameId);
  return open ? horizonJoinRequest(open) : parseUrgencyChoice(null);
}
