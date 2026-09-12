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
 */

/** Discord API error codes that prove the post can never be edited again. */
const PERMANENT_CODES = new Set([
  10003, // Unknown Channel — the forum or thread is gone
  10008, // Unknown Message — the starter message is gone
  50001, // Missing Access
  50013, // Missing Permissions
]);

/** The same four, as the message text a non-`DiscordAPIError` may carry. */
const PERMANENT_MESSAGES = [
  'Unknown Channel',
  'Unknown Message',
  'Missing Access',
  'Missing Permissions',
];

/**
 * Does this rejection prove the post is unreachable for good?
 *
 * @param err - Whatever `editThread` rejected with.
 * @returns True for a permanent refusal; false (the safe default) otherwise.
 */
export function isPermanentRefusal(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const { code } = err as Error & { code?: unknown };
  if (typeof code === 'number' && PERMANENT_CODES.has(code)) return true;
  return PERMANENT_MESSAGES.some((m) => err.message.includes(m));
}

/** Best-effort message for a caught `unknown`, never a bare cast. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
