/**
 * ROK-1740: constants for the pinned "Join Raid Ledger" post.
 *
 * `JOIN_POST_AUTHOR` doubles as the post's identity: rediscovery (D6) and the
 * companion smoke test match the bot's own message by this author line.
 */

/** Author line — glyph + SCREAMING, the grammar of `TEST_EMBED_AUTHOR`. */
export const JOIN_POST_AUTHOR = '\u{1F44B} JOIN RAID LEDGER';

/** The link button's label. */
export const JOIN_POST_BUTTON_LABEL = 'Join Raid Ledger';

/** Audit-log reason on the pin. */
export const JOIN_POST_PIN_REASON = 'Raid Ledger join post';

/** How far back an unpinned post is looked for. Discord's fetch ceiling. */
export const JOIN_POST_HISTORY_SCAN = 50;

/**
 * Most pin pages scanned on rediscovery. Discord pages pins 50 at a time; 5
 * pages covers its 250-pin channel cap, and bounds a misbehaving cursor.
 */
export const JOIN_POST_PIN_PAGES = 5;

/** Path the button opens, resolved against the instance's client URL (D7). */
export const JOIN_POST_LOGIN_PATH = '/login';
