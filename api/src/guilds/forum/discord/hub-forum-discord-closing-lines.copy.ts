/**
 * ROK-2272 S8 — every user-facing string of the closing bot lines posted into
 * a poll / lineup thread's Discord post. Operator ruling 2026-11-20: "match
 * the embeds" — same glyphs and phrases as the poll / lineup embeds
 * (`lineups/lineup-notification-author.helpers.ts`). `{…}` slots are filled by
 * `hub-forum-discord-closing-lines.ts`; nothing else holds closing-line copy.
 */

/** Glyphs, spelled out so a mojibake diff stays readable. */
const CALENDAR = '\u{1F4C5}'; // 📅
const TROPHY = '\u{1F3C6}'; // 🏆
const ARROW = '\u{2192}'; // →

export const CLOSING_LINE_COPY = {
  /** A poll locked in to an event. */
  pollLockedIn: `${CALENDAR} {eventTitle} is happening! ${ARROW} {eventLink}`,
  /** An operator cancelled the poll without a reason. */
  pollCancelled: 'Poll cancelled',
  /** An operator cancelled the poll with a reason. */
  pollCancelledReason: 'Poll cancelled — {reason}',
  /** A lineup decided on one or more games. */
  lineupDecided: `${TROPHY} Decided: {game} ${ARROW} {lineupLink}`,
  /** A lineup decided but no game name could be read. */
  lineupDecidedNoGame: `${TROPHY} Decided ${ARROW} {lineupLink}`,
  /** A lineup was aborted (archived without deciding). */
  lineupAborted: 'Lineup aborted',
  /** Joins several decided games. */
  gameSeparator: ' · ',
} as const;
