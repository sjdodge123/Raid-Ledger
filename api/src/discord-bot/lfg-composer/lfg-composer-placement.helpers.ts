/**
 * ROK-1612 AC1 — "the composer stays last", decided without a Discord client.
 *
 * Discord has no sticky message, so the only way to keep a card at the bottom
 * of a channel is to delete it and repost it. That is a write per burst of
 * chatter if it is done naively, so the decision is a PURE predicate here and
 * the API calls live in the caller — which is also what makes the three things
 * that can go wrong testable:
 *
 *  1. **A burst must cost one repost, not ten.** Chatter arrives as N message
 *     events in a second; the debounce window collapses them.
 *  2. **It must never race the board's own re-render.** `flushAll` / `editThread`
 *     already write to this channel; a repost issued while one is in flight can
 *     interleave into two visible composers. `renderInFlight` short-circuits.
 *  3. **Exactly one composer exists.** Any composer that is not the tracked one
 *     is a leak from a crashed repost and must be swept, not left.
 */

/**
 * How long a burst of chatter is collapsed into one repost.
 *
 * Long enough that a conversation costs one write rather than one per message;
 * short enough that the card is back at the bottom before anyone looks for it.
 */
export const LFG_COMPOSER_REPOST_DEBOUNCE_MS = 5_000;

/** Everything the decision needs. All of it is already known to the caller. */
export interface ComposerPlacement {
  /** The composer we believe is posted, or null when there is none. */
  composerMessageId: string | null;
  /** The channel's current last message id, or null when the channel is empty. */
  lastMessageId: string | null;
  /** When we last reposted, as epoch ms; null when we never have. */
  lastRepostAt: number | null;
  /** Now, as epoch ms. Injected so the test does not own a clock. */
  now: number;
  /** True while the board's own render is writing to this channel. */
  renderInFlight?: boolean;
  /** False when the guild has not opted in (AC6) or a permission is missing (AC7). */
  enabled?: boolean;
}

/** Why the composer is or is not being reposted — logged, and asserted on. */
export type ComposerPlacementReason =
  | 'disabled'
  | 'render-in-flight'
  | 'already-last'
  | 'debounced'
  | 'missing'
  | 'not-last';

/** The decision. `repost` is the only thing the caller acts on. */
export interface ComposerPlacementDecision {
  repost: boolean;
  reason: ComposerPlacementReason;
}

/**
 * Should the composer be reposted right now?
 *
 * The order of the guards is the contract. `disabled` outranks everything so an
 * opted-out guild is never written to; `render-in-flight` outranks the debounce
 * so a concurrent board render can never be interleaved into a duplicate; and
 * `already-last` outranks the debounce so the common case — chatter that the
 * composer already sits below — costs nothing at all.
 *
 * A MISSING composer is reposted even inside the debounce window: the window
 * exists to collapse chatter, not to leave a channel with no card in it.
 *
 * @param placement - The observed state.
 * @returns Whether to repost, and the reason for the log line.
 */
export function decideComposerPlacement(
  placement: ComposerPlacement,
): ComposerPlacementDecision {
  if (placement.enabled === false) return no('disabled');
  if (placement.renderInFlight) return no('render-in-flight');
  if (placement.composerMessageId === null) return yes('missing');
  if (placement.composerMessageId === placement.lastMessageId) {
    return no('already-last');
  }
  if (withinDebounce(placement)) return no('debounced');
  return yes('not-last');
}

/** True while the previous repost is still inside its debounce window. */
function withinDebounce(placement: ComposerPlacement): boolean {
  if (placement.lastRepostAt === null) return false;
  return (
    placement.now - placement.lastRepostAt < LFG_COMPOSER_REPOST_DEBOUNCE_MS
  );
}

function yes(reason: ComposerPlacementReason): ComposerPlacementDecision {
  return { repost: true, reason };
}

function no(reason: ComposerPlacementReason): ComposerPlacementDecision {
  return { repost: false, reason };
}

/**
 * Composer messages that should be deleted to restore the exactly-one rule.
 *
 * A crashed repost (posted, then died before recording the id) leaves an orphan
 * that no later run would ever clean up, because the tracker only knows about
 * the one it recorded. Everything the bot authored that is not the tracked
 * composer is an orphan.
 *
 * @param authored - Composer-looking messages the bot authored in the channel,
 *   newest first.
 * @param keepMessageId - The composer being kept, or null to sweep them all.
 * @returns The ids to delete, in the order given.
 */
export function orphanComposerIds(
  authored: ReadonlyArray<{ id: string }>,
  keepMessageId: string | null,
): string[] {
  return authored
    .map((message) => message.id)
    .filter((id) => id !== keepMessageId);
}
