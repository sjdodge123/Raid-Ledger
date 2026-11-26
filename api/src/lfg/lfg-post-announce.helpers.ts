/**
 * What `POST /lfg` announces after its transaction commits — moved out of
 * `LfgService` (ROK-2352) to keep the service under its line budget.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { LfgUrgency, LfgNowTtl } from '@raid-ledger/contract';
import { LFG_EVENTS, type LfgLfmReachedPayload } from './lfg.constants';
import type { LfgIntentRow } from './lfg-write.helpers';
import {
  isFirstHand,
  joinsOpenSession,
  type GroupPostOutcome,
} from './lfg-post-outcome.helpers';

/**
 * The payload both hand-count transitions carry (ROK-1479 D7 / ROK-1505 D1).
 *
 * `urgency` is read off the row that actually landed, not off the request —
 * the request's `ttlMinutes` may be absent and the row is what the DB
 * committed, so the payload can never advertise a class the stored intent
 * does not hold. Same row, same reason for `ttlMinutes`: the DM quotes this
 * horizon, so it has to be the one that committed. A `week` row stores no
 * TTL and reports null.
 */
function handPayload(
  gameId: number,
  activeCount: number,
  inserted: LfgIntentRow,
): LfgLfmReachedPayload {
  return {
    gameId,
    activeCount,
    urgency: inserted.urgency as LfgUrgency,
    ttlMinutes: (inserted.ttlMinutes as LfgNowTtl | null) ?? null,
    userId: inserted.userId,
    // ROK-2352 P2-9 — the affinity DM links the group that reached LFM.
    ...(inserted.groupKey ? { groupKey: inserted.groupKey } : {}),
  };
}

/**
 * Announce what `POST /lfg` just did. Post-COMMIT by construction: the
 * transaction has landed before this runs, so a consumer reacting to any of
 * these events can never read a group that rolled back.
 *
 * The four branches are SIBLINGS, deliberately not chained. The first three
 * are disjoint by arithmetic (`=== 1` vs `=== 2` vs `>= 3`) and that
 * disjointness is what the "never both" test guards (ROK-1454 AC11) —
 * chaining them would make the boundary unreachable, so a later widening of
 * `>= 3` would ship silently past a green suite. The fourth is disjoint from
 * all of them because a bump only happens on the `inserted === null` path.
 *
 * @param emitter - Nest event bus.
 * @param gameId - Game whose group was posted to.
 * @param outcome - What the advisory-lock transaction settled on.
 */
export function announceLfgPost(
  emitter: EventEmitter2,
  gameId: number,
  outcome: GroupPostOutcome,
): void {
  if (isFirstHand(outcome) && outcome.inserted) {
    // ROK-1505 D1: the board's LOOKING post. Same payload as LFM_REACHED.
    emitter.emit(
      LFG_EVENTS.HAND_RAISED,
      handPayload(gameId, outcome.group.activeCount, outcome.inserted),
    );
  }
  if (outcome.inserted && outcome.group.activeCount === 2) {
    emitter.emit(
      LFG_EVENTS.LFM_REACHED,
      handPayload(gameId, outcome.group.activeCount, outcome.inserted),
    );
  }
  if (
    outcome.inserted &&
    (outcome.group.activeCount >= 3 || joinsOpenSession(outcome))
  ) {
    emitter.emit(LFG_EVENTS.GROUP_CHANGED, {
      gameId,
      reason: 'joined',
      userIds: [outcome.inserted.userId],
      // ROK-2352 P1-4 — a keyed joiner attaches to its own group's session.
      ...(outcome.inserted.groupKey
        ? { groupKey: outcome.inserted.groupKey }
        : {}),
    });
  }
  // D8: gated on `>= 2` to match `emitGroupChanged`'s contract — a group
  // nobody else has joined has no Discord post to re-render.
  if (outcome.bumped && outcome.group.activeCount >= 2) {
    emitter.emit(LFG_EVENTS.GROUP_CHANGED, { gameId, reason: 'bumped' });
  }
}
