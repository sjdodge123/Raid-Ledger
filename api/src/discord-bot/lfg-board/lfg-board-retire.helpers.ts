/**
 * ROK-1523 — classifying what Discord said "no" with, during the retire pass.
 *
 * The distinction is load-bearing, not tidiness. The retire pass closes the
 * `lfg_group_messages` row, and a closed row is invisible to
 * `LfmEmbedService.reconcileOpenRows` forever. So:
 *
 *  - a PERMANENT refusal (the channel is gone, the grant was revoked) means
 *    nobody will ever edit that post again — closing the row anyway is the
 *    only thing that stops it holding its game hostage to
 *    `uq_lfg_group_messages_game_open`, which is AC9's wedge class;
 *  - a TRANSIENT failure (the bot is disconnected, no guild yet, a 429, a 5xx)
 *    means the post is still there and still editable in a minute. Closing on
 *    one of those loses the farewell, the archive AND the tracking row in a
 *    single step, for an outage that resolves itself. Leaving the row OPEN
 *    hands it to the reconnect reconciliation, which is exactly the mechanism
 *    that exists for "the bot was down when it mattered".
 *
 * Default is TRANSIENT: an unrecognised error is much more likely to be an
 * outage than a revocation, and the transient branch is the recoverable one.
 *
 * **A numeric `code` is AUTHORITATIVE and ends the question.** Discord's REST
 * errors carry one, and round 3 of this story was rejected because the message
 * text was consulted anyway: `LfgBoardService.fetchThread` used to rephrase
 * every fetch rejection as `Unknown Message: ...`, so a 429 matched the
 * substring list and classified PERMANENT — the row closed, the post stayed
 * live and untracked, and a re-enable posted a second card for the game. The
 * substring list survives only for the errors WE construct, which carry no
 * code at all.
 */

import type { LfmGroupView } from '../lfm/lfm-embed.helpers';

/**
 * The farewell render: whatever the group actually is, ended and annotated.
 *
 * SHARED by the two writers that can retire a post — {@link
 * LfgBoardRetireService} on the disable itself, and
 * `LfmEmbedService.reconcileRow` when the disable's edit failed transiently and
 * the reconnect has to finish the job. One definition so the retry cannot
 * disagree with the original: `closed` is terminal (so `editThread` archives
 * and `persist` closes the row) and `boardRetired` is what puts
 * `LFG_BOARD_RETIRED_NOTE` on the card.
 *
 * @param view - The group as its caller read it (`currentView` / the reconcile).
 * @returns The same group, rendered as a board-off farewell.
 */
export function boardOffView(view: LfmGroupView): LfmGroupView {
  return { ...view, state: 'closed', boardRetired: true };
}

/** Discord codes meaning the thread/message itself no longer exists. */
const GONE_CODES = new Set([
  10003, // Unknown Channel — the forum or thread is gone
  10008, // Unknown Message — the starter message is gone
]);

/** Discord codes proving the post is unreachable: gone, or walled off. */
const PERMANENT_CODES = new Set([
  ...GONE_CODES,
  50001, // Missing Access
  50013, // Missing Permissions
]);

/** The gone pair, as the message text an error we built may carry. */
const GONE_MESSAGES = ['Unknown Channel', 'Unknown Message'];

/** The same four, as the message text a non-`DiscordAPIError` may carry. */
const PERMANENT_MESSAGES = [
  ...GONE_MESSAGES,
  'Missing Access',
  'Missing Permissions',
];

/** Code-first classification. A numeric code is the whole answer (see above). */
function matches(err: Error, codes: Set<number>, messages: string[]): boolean {
  const { code } = err as Error & { code?: unknown };
  if (typeof code === 'number') return codes.has(code);
  return messages.some((m) => err.message.includes(m));
}

/**
 * Does this rejection prove the thread is GONE, rather than merely unreadable?
 *
 * Narrower than {@link isPermanentRefusal} on purpose: only "gone" justifies
 * translating an error into the vocabulary `isUnknownMessageError` matches,
 * because that predicate makes `LfmEmbedService.editRow` DELETE the row and
 * post a replacement. A revoked grant or a rate limit read as "gone" therefore
 * double-posts; a 50001 belongs on the permanent list but not on this one.
 *
 * @param err - Whatever a thread fetch rejected with.
 * @returns True when the thread genuinely no longer exists.
 */
export function isThreadGoneError(err: unknown): boolean {
  return err instanceof Error && matches(err, GONE_CODES, GONE_MESSAGES);
}

/**
 * Does this rejection prove the post is unreachable for good?
 *
 * @param err - Whatever `editThread` rejected with.
 * @returns True for a permanent refusal; false (the safe default) otherwise.
 */
export function isPermanentRefusal(err: unknown): boolean {
  return (
    err instanceof Error && matches(err, PERMANENT_CODES, PERMANENT_MESSAGES)
  );
}

/** Best-effort message for a caught `unknown`, never a bare cast. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
