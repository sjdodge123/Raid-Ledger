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
export const LFG_BOARD_EVENTS = { TOGGLED: 'lfg-board.toggled' } as const;

/** Payload of {@link LFG_BOARD_EVENTS.TOGGLED}. */
export interface LfgBoardToggledPayload {
  enabled: boolean;
}

/** D7: the join button's label. The `+1` vocabulary the spec uses throughout. */
export const LFG_JOIN_BUTTON_LABEL = "+1 · I'm in";

/** D7: the Link button that replaces the description's masked group link. */
export const LFG_OPEN_GROUP_LABEL = 'Open group ↗';
