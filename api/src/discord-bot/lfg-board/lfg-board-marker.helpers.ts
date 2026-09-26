/**
 * ROK-1522 — WHOSE board a marked forum is.
 *
 * The ROK-1492 sentinel said only "this is a Raid Ledger board". One guild can
 * host several Raid Ledger instances at once — prod, a dev laptop, every fleet
 * env and every concurrent CI smoke run share the test guild — and a board
 * with no stored forum adopted ANY marked forum. So run B's API took over run
 * A's board, and run B's smoke cleanup then deleted it under run A.
 *
 * The mark now carries the owning bot's user id:
 * `· raid-ledger:lfg-board:<botUserId>`. Adoption takes only our own mark.
 *
 * **Legacy marks** (no id, written before this change) are still adopted, but
 * ONLY when no forum carries our own mark, and the adopted forum's mark is
 * upgraded to ours on the spot (`topicMarkedFor`). That keeps a restored real
 * install finding its pre-ROK-1522 board (one bot per production guild, so a
 * legacy mark there is ours), while a forum another instance has already
 * tagged is never taken: its id does not match.
 */
import {
  LFG_BOARD_TOPIC,
  LFG_BOARD_TOPIC_GUIDELINES,
  LFG_BOARD_TOPIC_SENTINEL,
} from './lfg-board-permissions.helpers';

/** Who a topic's board mark belongs to, relative to the asking bot. */
export type BoardMarkOwner = 'own' | 'legacy' | 'foreign' | 'none';

const ESCAPED = LFG_BOARD_TOPIC_SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The sentinel, optionally followed by `:<owner id>`. */
const MARK = new RegExp(`${ESCAPED}(?::(\\S+))?`);

/**
 * The sentinel line owned by `ownerId`.
 *
 * @param ownerId - The bot's own user id.
 * @returns The id-tagged sentinel.
 */
export function ownedSentinel(ownerId: string): string {
  return `${LFG_BOARD_TOPIC_SENTINEL}:${ownerId}`;
}

/**
 * The full topic a bot-created forum is born with.
 *
 * @param ownerId - The bot's own user id; null when the member cache cannot
 *   say, in which case the legacy (untagged) topic is written and upgraded on
 *   the next resolve that knows the id.
 * @returns Guidelines + the (owned when possible) sentinel.
 */
export function boardTopic(ownerId: string | null): string {
  if (!ownerId) return LFG_BOARD_TOPIC;
  return `${LFG_BOARD_TOPIC_GUIDELINES}\n\n${ownedSentinel(ownerId)}`;
}

/**
 * Classify a topic's board mark.
 *
 * @param topic - `ForumChannel.topic`.
 * @param ownerId - The asking bot's user id; null makes every tagged mark
 *   `foreign`, since ownership cannot be proven.
 * @returns `own`, `legacy` (untagged), `foreign` (another bot's) or `none`.
 */
export function markOwner(
  topic: string | null | undefined,
  ownerId: string | null,
): BoardMarkOwner {
  const match = MARK.exec(topic ?? '');
  if (!match) return 'none';
  const tagged = match[1];
  if (tagged === undefined) return 'legacy';
  return tagged === ownerId ? 'own' : 'foreign';
}

/**
 * The topic to write so the forum carries OUR mark, preserving operator text.
 *
 * @param topic - The forum's current topic.
 * @param ownerId - The bot's own user id (null: legacy behaviour).
 * @returns The topic unchanged when already ours — or another bot's, which is
 *   never rewritten (a bound or stored forum stays shared, not stolen); a
 *   legacy mark upgraded in place; otherwise the mark appended (or the full
 *   guidelines when the topic is empty).
 */
export function topicMarkedFor(
  topic: string | null | undefined,
  ownerId: string | null,
): string {
  const current = topic ?? '';
  const owner = markOwner(current, ownerId);
  if (owner === 'own' || owner === 'foreign') return current;
  if (owner === 'legacy') {
    return ownerId ? current.replace(MARK, ownedSentinel(ownerId)) : current;
  }
  if (current.trim() === '') return boardTopic(ownerId);
  const mark = ownerId ? ownedSentinel(ownerId) : LFG_BOARD_TOPIC_SENTINEL;
  return `${current.trimEnd()}\n\n${mark}`;
}

/**
 * The marked channels this bot may adopt: its own, else the legacy ones.
 *
 * @param channels - Candidate channels (already narrowed to forums).
 * @param ownerId - The bot's own user id.
 * @returns Own-marked channels when any exist, otherwise legacy-marked ones;
 *   never a channel another bot has tagged.
 */
export function adoptableMarked<T extends { topic: string | null }>(
  channels: readonly T[],
  ownerId: string | null,
): T[] {
  const own = channels.filter((c) => markOwner(c.topic, ownerId) === 'own');
  if (own.length > 0) return own;
  return channels.filter((c) => markOwner(c.topic, ownerId) === 'legacy');
}
