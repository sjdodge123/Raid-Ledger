/**
 * ROK-1471 — LFG forum-board constants. One edit changes every surface.
 */

/**
 * Forum tag names. These are the ROK-1454 D7 author-line states, verbatim, so
 * the forum's tag filter and the embed's author line say the same words (AC6).
 */
export const LFG_BOARD_TAGS = [
  'NEEDS PLAYERS',
  'READY TO SCHEDULE',
  'SCHEDULED',
  'EXPIRED',
  'CLOSED',
] as const;
export type LfgBoardTag = (typeof LFG_BOARD_TAGS)[number];

/** Default name of the bot-created forum channel (operator: `lfg`). */
export const LFG_BOARD_CHANNEL_NAME = 'lfg';

/** D10: thread renames + tag edits coalesce on a trailing timer; content edits never wait. */
export const LFG_BOARD_EDIT_DEBOUNCE_MS = 5000;

/** D2: the surface a `lfg_group_messages` row lives on — pinned at post time. */
export const LFG_POST_KINDS = ['forum', 'text'] as const;
export type LfgPostKind = (typeof LFG_POST_KINDS)[number];

/** Discord caps a forum at 20 available tags (E16). Never one tag per game. */
export const DISCORD_FORUM_TAG_CAP = 20;

/** Binding purpose for the manual forum override (D3a / D4). */
export const LFG_BOARD_BINDING_PURPOSE = 'lfg-board';

/**
 * D1: the master toggle broadcast. The wave-2 posting lane subscribes to
 * ensure the forum channel + intro post on enable, and to archive live posts
 * on disable — the toggle endpoint itself never touches Discord.
 */
export const LFG_BOARD_EVENTS = {
  TOGGLED: 'lfg-board.toggled',
  /**
   * D10: drain the rename/tag debounce NOW. Emitted by the DEMO_MODE-only
   * flush endpoint so a smoke test can assert a thread's name and tags without
   * sleeping out the trailing window.
   */
  FLUSH: 'lfg-board.flush',
} as const;

/** Payload of {@link LFG_BOARD_EVENTS.TOGGLED}. */
export interface LfgBoardToggledPayload {
  enabled: boolean;
}

/** D7: the join button's label. The `+1` vocabulary the spec uses throughout. */
export const LFG_JOIN_BUTTON_LABEL = "+1 · I'm in";

/** D7: the Link button that replaces the description's masked group link. */
export const LFG_OPEN_GROUP_LABEL = 'Open group ↗';

/** Discord's hard cap on a thread name. Truncation target for `threadNameFor`. */
export const DISCORD_THREAD_NAME_MAX = 100;

/** Title of the pinned thread that explains the board (posted once on enable). */
export const LFG_BOARD_INTRO_TITLE = 'How this board works';

/**
 * Body of the intro thread. Plain text — no embed, so it renders in search and
 * the operator can edit it from Discord. Answers the four questions the board
 * raises on sight — what a post is, why one appeared, what the button does, and
 * how to get out again. Kept well inside Discord's 2000-char cap.
 */
export const LFG_BOARD_INTRO_BODY = [
  '**This is the LFG board.** Every post below is one group of players looking for more people for a single game.',
  '',
  '**Why a post appears.** Raise your hand for a game — on the Raid Ledger site, or with `/lfg`. One hand stays quiet: a post is only created once a **second** person raises a hand for the same game, so nobody gets pinged for an empty room.',
  '',
  "**`+1 · I'm in`** adds you to that group. It is interest, not a commitment — pressing it books no time and schedules nothing.",
  '',
  '**Changed your mind?** Run `/lfg`. It lists every game you currently have a hand up for, each with a **Withdraw** button.',
  '',
  '**How posts end.** When the group turns into a scheduled event — or when everyone loses interest and it expires — the post is retagged, closed and archived. It stays readable; it just stops updating.',
].join('\n');
