/**
 * ROK-1471 — LFG forum-board constants. One edit changes every surface.
 */

/**
 * Forum tag names. These are the ROK-1454 D7 author-line states, verbatim, so
 * the forum's tag filter and the embed's author line say the same words (AC6).
 *
 * ROK-1494 D3 appends a SIXTH, `PLAYING NOW`, deliberately overriding ROK-1479
 * A11 ("no sixth tag") — a spawned now-group is a live session, not a
 * scheduled group, and reusing `SCHEDULED` would close the row and freeze its
 * head-count forever. Appended rather than inserted because
 * `lfm-embed.helpers.ts` destructures this array BY POSITION, so the five
 * ROK-1454 author lines are undisturbed. `ensureTags`
 * (`lfg-board-channel.service.ts:105`) tops it up on existing forums, and
 * `DISCORD_FORUM_TAG_CAP` is 20, so there is headroom.
 *
 * ROK-1505 D7 appends a SEVENTH, `LOOKING` — the web chip's own word for a
 * one-hand group. The board now posts at the first hand (parity with the
 * chips), and that post is LFG, not LFM: it neither "needs players" (there
 * is no group yet) nor is "ready to schedule". Appended for the same
 * by-position reason.
 */
export const LFG_BOARD_TAGS = [
  'NEEDS PLAYERS',
  'READY TO SCHEDULE',
  'SCHEDULED',
  'EXPIRED',
  'CLOSED',
  'PLAYING NOW',
  'LOOKING',
] as const;
export type LfgBoardTag = (typeof LFG_BOARD_TAGS)[number];

/**
 * Default name of the bot-created forum channel.
 *
 * `lfg`, NOT the `looking-for-group` this story's spec first wrote down: the
 * operator chose the short name on ROK-1471 (Linear issue ROK-1471, D3/AC2 —
 * the spec at `planning-artifacts/specs/ROK-1471.md` has been reconciled to
 * match). Do not "fix" it back; a smoke or AC that looks for
 * `looking-for-group` is reading the pre-reconciliation spec.
 */
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
   * ROK-1523 — the board is on AND provisioned. `LfmEmbedService` subscribes
   * and re-posts a fresh card for every group that is still live, which is
   * what makes a disable/enable round trip restore the board.
   *
   * A separate event rather than a second `TOGGLED` subscriber on purpose:
   * `emitAsync` runs listeners CONCURRENTLY, so a reconcile racing
   * {@link LfgBoardToggleListener.provision} would resolve the forum while the
   * toggle listener is still creating it — two boards, both marked. This is
   * emitted by that listener only once provisioning has finished.
   *
   * The direction also matters: `LfmEmbedModule` imports `LfgBoardModule`, so
   * the board calling `LfmEmbedService` directly would be a module cycle. The
   * event is the seam that keeps the dependency one-way.
   */
  ENABLED: 'lfg-board.enabled',
  /**
   * D10: drain the rename/tag debounce NOW. Emitted by the DEMO_MODE-only
   * flush endpoint so a smoke test can assert a thread's name and tags without
   * sleeping out the trailing window.
   */
  FLUSH: 'lfg-board.flush',
  /**
   * ROK-1612 AC6 — the composer opt-in was flipped from the admin page.
   * `LfgComposerPinService` reconciles on it, so ON pins the card now and OFF
   * takes it down now, instead of waiting for the next bot reconnect.
   */
  COMPOSER_TOGGLED: 'lfg-board.composer-toggled',
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
 * raises on sight — what a post is, why one appeared (ROK-1505: every active
 * hand is posted; one hand opens it, the second upgrades it), why the member
 * cannot start one (ROK-1493 D11: the forum is locked to the bot), what the
 * button does, and how to get out again. Kept well inside Discord's 2000-char
 * cap.
 */
export const LFG_BOARD_INTRO_BODY = [
  '**This is the LFG board.** Every post below is one group of players looking for more people for a single game.',
  '',
  '**Why a post appears.** Raise your hand for a game — on the Raid Ledger site, or with `/lfg`. A post appears as soon as one person raises a hand, tagged **LOOKING** so the room is easy to find. When a second person joins the same game, that post upgrades to looking-for-more — one post per game, edited in place as hands come and go.',
  '',
  '**You cannot post here yourself.** New posts are made by Raid Ledger only — `/lfg` or the site is the way in. Replies inside a post stay open, so a group can talk once it exists.',
  '',
  "**`+1 · I'm in`** adds you to that group. It is interest, not a commitment — pressing it books no time and schedules nothing.",
  '',
  '**Right now, tonight, or this week?** Every hand carries one of three horizons. **Right now** means you are free this minute — that hand drops on its own after half an hour. **Tonight** means later today; it stays up until 4 AM, so a session that runs past midnight keeps its hands raised. **This week** means you are up for it some time in the next 14 days. You pick when you raise your hand (the site asks; `/lfg` has a **when** option), and `+1` asks the same question. A post with someone playing right now shows 🔥 and the time they are around until.',
  '',
  '**Changed your mind?** Run `/lfg`. It lists every game you currently have a hand up for, each with a **Withdraw** button.',
  '',
  '**How posts end.** When the group turns into a scheduled event — or when everyone loses interest and it expires — the post is retagged, closed and archived. It stays readable; it just stops updating.',
].join('\n');

/**
 * ROK-1523 — the line a post carries when the operator turns the board OFF.
 *
 * The board's other terminal renders mean the GROUP ended (scheduled, expired,
 * dropped below the floor). This one does not: the group is untouched and
 * still live on the site, only its Discord surface is being retired. The copy
 * therefore says what happened to the BOARD and where the group went, and
 * never uses the vocabulary of cancellation.
 */
export const LFG_BOARD_RETIRED_NOTE =
  'The LFG board was switched off — this group is still live on the site.';

/**
 * ROK-1523 — the author line a RETIRED card leads with, and the phrase after it.
 *
 * Every other terminal author line states what happened to the GROUP
 * (`CLOSED · 3 still looking`, `EXPIRED · 5 were looking`). On this card the
 * group is untouched, so a head-count in the terminal vocabulary reads as a
 * cancellation of something that did not end. Operator ruling (lead default,
 * 2026-09-12): name the BOARD and say where the group went.
 *
 * Deliberately NOT a member of `LFG_BOARD_TAGS`: the forum TAG stays `CLOSED`,
 * which is the most neutral terminal tag the board creates (the alternatives
 * are `EXPIRED` and `SCHEDULED`, both of which assert something false). Tags
 * are forum-configured and shared across every post; the author line is
 * per-render, which is the right place for a one-off state.
 */
export const LFG_BOARD_RETIRED_AUTHOR = 'BOARD OFF';
export const LFG_BOARD_RETIRED_AUTHOR_SUFFIX = 'still live on the site';
