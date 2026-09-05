/**
 * ROK-1471 AC6 — the two strings a forum post carries outside its embed.
 *
 * Both are derived from the SAME `LfmGroupView` the embed renders, so the
 * thread list, the tag filter and the author line cannot disagree: AC6 is
 * literally "the forum's tag filter and the embed's author line say the same
 * words", and `LFG_BOARD_TAGS` holds those words once.
 *
 * PURE, and deliberately split out of `LfgBoardService`: the service's job is
 * Discord I/O and the debounce, and neither is needed to prove that a state
 * maps to a tag.
 */
import { deriveViability } from '../../lfg/lfg-query.helpers';
import type { LfmGroupView } from '../lfm/lfm-embed.helpers';
import { LFG_BOARD_TAGS, type LfgBoardTag } from './lfg-board.constants';

/** Discord's hard cap on a thread name. Past it, `threads.create` fails. */
const THREAD_NAME_LIMIT = 100;

const SEP = '·';

/** Terminal render state to the word that replaces the head-count. */
const TERMINAL_WORD: Record<string, string> = {
  scheduled: 'scheduled',
  expired: 'expired',
  closed: 'closed',
};

/**
 * The forum tag for a group's current state.
 *
 * `deriveViability` is the ONE definition of viable — the same call
 * `buildLfmEmbed` makes for its author line — so the tag and the line can never
 * disagree about whether a group is ready. Without a threshold it is false
 * forever, which is why an unknown co-op cap never reads READY TO SCHEDULE.
 *
 * @param view - The group as the caller read it.
 * @returns Exactly one of the five board tags.
 */
export function tagFor(view: LfmGroupView): LfgBoardTag {
  const [needs, ready, scheduled, expired, closed] = LFG_BOARD_TAGS;
  if (view.state === 'scheduled') return scheduled;
  if (view.state === 'expired') return expired;
  if (view.state === 'closed') return closed;
  return deriveViability(view.memberCount, view.viabilityThreshold ?? null)
    ? ready
    : needs;
}

/**
 * The thread's name: the game, then either its head-count or its end state.
 *
 * A head-count on an archived thread reads as live, so terminal states carry
 * the state word instead. Truncated to Discord's limit — a long game name must
 * cost the post a few characters, never the post itself.
 *
 * @param view - The group as the caller read it.
 * @returns A name at most {@link THREAD_NAME_LIMIT} characters long.
 */
export function threadNameFor(view: LfmGroupView): string {
  const tail =
    TERMINAL_WORD[view.state] ?? `${String(view.memberCount)} looking`;
  const suffix = ` ${SEP} ${tail}`;
  const room = THREAD_NAME_LIMIT - suffix.length;
  const name =
    view.gameName.length > room
      ? `${view.gameName.slice(0, Math.max(room - 1, 1)).trimEnd()}…`
      : view.gameName;
  return `${name}${suffix}`;
}
