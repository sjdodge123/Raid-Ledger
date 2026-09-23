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
import { findOpenLfgNowEventId } from '../../lfg/lfg-playing.helpers';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { LfgUrgencyRequest } from '../../lfg/lfg-write.helpers';
import { LFG_DEFAULT_NOW_TTL_MINUTES } from '../../lfg/lfg.constants';
import { LFG_URGENCY_CHOICES, parseUrgencyChoice } from './lfg.command.helpers';

/**
 * Resolve the urgency a `/lfg <game>` hand is written with.
 *
 * The rule, in order:
 * 1. **An explicit `urgency:` always wins** and is read exactly as before
 *    ({@link parseUrgencyChoice}); the group is not even consulted (AC3).
 * 2. **No urgency, and the game has an open group** (at least one live hand):
 *    the hand joins it on the group's horizon and TTL bucket — the SAME two
 *    calls the board `+1` makes (`lfg-join.listener.ts`, ROK-1614), so on any
 *    post the board still accepts a `+1` on, the two write the same hand. A
 *    game has ONE group, so "several open groups" means a group holding hands
 *    on several horizons; it resolves most-urgent-first, now > tonight > week
 *    (`readGroupHorizon`), which is also the order the board surfaces them in.
 * 3. **No urgency, no live hand, but a session is PLAYING NOW:** a `now` hand
 *    on the default bucket (the same request an explicit `Right now` makes).
 *    The spawn converted every hand (`convertGroup`), so step 2 sees no group,
 *    yet the post is in its `playing` state. This is the one case the two
 *    surfaces differ: the board REFUSES a `+1` on a `playing` post
 *    (`isTerminalPost`), while a bare `/lfg` raises a `now` hand beside the
 *    session. "Playing" is {@link findOpenLfgNowEventId}, the same predicate
 *    as `readPlayingNow`.
 * 4. **No urgency, nothing open or playing:** a fresh `tonight` hand (AC1).
 *
 * The caller's OWN live hand counts toward "open": re-running a bare `/lfg`
 * then re-asserts the horizon the caller is already on rather than flipping it.
 * A banned or deactivated holder's hand never counts (`liveIntent`).
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
  if (open) return horizonJoinRequest(open);
  if ((await findOpenLfgNowEventId(db, gameId)) !== null) {
    return { urgency: 'now', ttlMinutes: LFG_DEFAULT_NOW_TTL_MINUTES };
  }
  return parseUrgencyChoice(null);
}

/**
 * ROK-1656 — the reply line naming the horizon a bare `/lfg` chose, since the
 * player never picked it: `**When:** Tonight`. The label is read from
 * {@link LFG_URGENCY_CHOICES}, so it is always the word the `urgency` option
 * itself offers (`Right now` / `Tonight` / `This week`). Null for a horizon the
 * vocabulary does not list — the reply then simply omits the line.
 *
 * @param urgency - The horizon the hand was written with.
 */
export function horizonReplyLine(
  urgency: LfgUrgencyRequest['urgency'],
): string | null {
  const choice = LFG_URGENCY_CHOICES.find(
    (c) => parseUrgencyChoice(c.value).urgency === urgency,
  );
  return choice ? `**When:** ${choice.name}` : null;
}
