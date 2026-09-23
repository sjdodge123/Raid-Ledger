/**
 * ROK-1612 AC1 — which forum post is "the board's pinned intro post".
 *
 * The CI guild is SHARED: every fleet env's bot (and prod's) seeds its own
 * "How this board works" post into the one board forum, so a live forum holds
 * several posts with that exact title (five, on 2026-09-23). A title match
 * alone therefore picks whichever one Discord lists first, usually another
 * env's unpinned intro with no buttons. Discord allows ONE pinned post per
 * forum, and that is the one the operator sees on top, so the pin flag is what
 * names the board's intro unambiguously.
 *
 * Pure on purpose: `lfg-board-intro-pick.spec.ts` runs it with no Discord.
 */

/** The parts of a forum post the pick reads. */
export interface IntroCandidate {
  id: string;
  name: string;
  pinned: boolean;
}

/**
 * The forum's pinned post, when it carries the intro title; otherwise null.
 *
 * @param threads - Every post in the forum, in any order.
 * @param title - The intro post's title.
 */
export function pickBoardIntro<T extends IntroCandidate>(
  threads: readonly T[],
  title: string,
): T | null {
  return threads.find((t) => t.pinned && t.name === title) ?? null;
}
