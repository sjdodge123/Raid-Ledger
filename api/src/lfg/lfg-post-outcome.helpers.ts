/**
 * What `LfgService.insertOrSettle`'s advisory-lock transaction settled on, and the
 * two disjoint predicates `announcePost` branches on. Split out of
 * `lfg.service.ts` to keep that file under the 300-line limit.
 */
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import type { LfgIntentRow } from './lfg-write.helpers';

/** What the serialised insert-then-count transaction settled on. */
export interface GroupPostOutcome {
  inserted: LfgIntentRow | null;
  row: LfgIntentRow;
  group: LfgGroupSummaryDto;
  refreshed: boolean;
  /** A re-heart moved the caller's OWN row onto a different clock (AC2). */
  bumped: boolean;
}

/** The surviving row a conflicting post settled on, and how it got there. */
export interface ResolvedExisting {
  row: LfgIntentRow;
  bumped: boolean;
}

/**
 * ROK-1494 AC1 — a hand posted while the group's session is ALREADY open.
 *
 * The spawn converts every earlier intent, so a hand arriving after it is a
 * SOLO hand by count (`activeCount` back to 1): neither the `=== 2` nor the
 * `>= 3` branch of {@link LfgService.announcePost} fires, nothing reaches
 * `LfgNowSpawnService`, and the attach pass that writes
 * `converted_to_event_id` never runs — the newcomer sits at `null` forever
 * while everyone else is in the session.
 *
 * `playingNow` is exactly the state D8's `>= 2` floor was guarding against
 * ("a group nobody else has joined has no Discord post to re-render"): an open
 * session means the LFM post exists and is rendering PLAYING NOW, so a
 * re-render is warranted.
 *
 * The `< 2` clause keeps this DISJOINT from the `LFM_REACHED` branch, so the
 * "never both" contract (ROK-1454 AC11) still holds for a hand that lands on
 * the pair boundary before an attach pass has converted the group.
 *
 * @param outcome - What the advisory-lock transaction settled on.
 */
export function joinsOpenSession(outcome: GroupPostOutcome): boolean {
  return outcome.group.playingNow !== null && outcome.group.activeCount < 2;
}

/**
 * ROK-1505 D1 — the game's FIRST live hand, and nothing else.
 *
 * `activeCount === 1` alone is not enough: a solo-by-count hand landing on a
 * game whose session is open is a `joined` ({@link joinsOpenSession}) — the
 * post already exists and is rendering PLAYING NOW — so the two predicates
 * are kept DISJOINT the same way `=== 2` and `>= 3` are.
 *
 * @param outcome - What the advisory-lock transaction settled on.
 */
export function isFirstHand(outcome: GroupPostOutcome): boolean {
  return (
    outcome.inserted !== null &&
    outcome.group.activeCount === 1 &&
    outcome.group.playingNow === null
  );
}
