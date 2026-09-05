/**
 * ROK-1471 D3 — the pinned "read me" post seeded when the board is enabled.
 *
 * Plain text, no embed: a forum post's first message is the post body, and an
 * embed there renders as a card the operator cannot edit from Discord. The
 * copy answers the four questions the board raises on sight — what a post is,
 * why one appeared, what the button does, and how to get out again.
 */

/** Title of the intro forum post (also its thread name). */
export const LFG_BOARD_INTRO_TITLE = 'Read me — how this board works';

/** Body of the intro forum post. Kept well inside Discord's 2000-char cap. */
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
