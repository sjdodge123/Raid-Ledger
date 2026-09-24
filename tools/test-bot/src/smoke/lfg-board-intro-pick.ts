/**
 * ROK-1612 AC1 — which forum post is "this env's board intro post".
 *
 * The CI guild is SHARED: every fleet env's bot (and prod's) seeds its own
 * intro post into the one board forum, so a live forum holds several posts
 * with the same title (five "How this board works", on 2026-09-23). A title
 * match alone picks whichever one Discord lists first — usually another env's.
 *
 * ROK-1658 renamed the intro; the forum now holds both the current and the
 * legacy title, so the pick takes a LIST of titles (`INTRO_TITLES`). Which
 * title this env's intro must END on is the caller's assertion, not the pick's.
 *
 * Ownership is what names this env's intro (Codex P2), and it is REQUIRED.
 * The pin is NOT: Discord allows one pinned post per forum and refuses a
 * second pin with 30047 (MaximumNumberOfPinnedThreadsInForumHasBeenReached),
 * so whichever env pinned first keeps it. The product logs that refusal and
 * carries on (`LfgBoardToggleListener.ensureIntroPost` / `pinAdopted`), and
 * `LfgComposerPinService` puts the buttons on its STORED intro whether or not
 * it is pinned. Requiring the pin here made the smoke pass only on the env
 * that happened to hold it.
 *
 * Among this bot's intros the pick mirrors the product's own `pickIntro`
 * (api `lfg-board-discovery.helpers.ts`): pinned first, then — since the
 * product only adopts from `fetchActive()` — an active post over an archived
 * one, then the OLDEST. A freshly seeded post is only seeded when no active
 * one of ours existed, so it is the one this order lands on.
 *
 * When no bot id is pinned (see `helpers/bot-author.ts`) ownership cannot be
 * checked, so the pin is required instead — never a bare title match.
 *
 * Pure on purpose: `lfg-board-intro-pick.spec.ts` runs it with no Discord.
 */

import { getApiBotUserId } from '../helpers/bot-author.js';

/** The parts of a forum post the pick reads. */
export interface IntroCandidate {
  id: string;
  name: string;
  pinned: boolean;
  /** Archived posts are invisible to the product's `fetchActive()` adopt. */
  archived?: boolean;
  /** The post's creator (a forum thread's `ownerId`). */
  ownerId: string | null;
}

/** Snowflake order: shorter id is older; same length compares lexically. */
function olderFirst(a: IntroCandidate, b: IntroCandidate): number {
  return a.id.length - b.id.length || a.id.localeCompare(b.id);
}

/** Pinned, then oldest — the product's adopt order among active posts. */
function preferred(a: IntroCandidate, b: IntroCandidate): number {
  return Number(b.pinned) - Number(a.pinned) || olderFirst(a, b);
}

/**
 * This env's intro post: titled one of `titles`, created by this env's bot and ACTIVE
 * (the product only adopts from `fetchActive()`, so an archived post is never
 * the live intro), preferring the pinned one, then the oldest.
 *
 * @param threads - Every post in the forum, in any order.
 * @param titles - Every title the intro post may carry (current + legacy).
 * @param botUserId - This env's API bot; null falls back to "the pinned one".
 * @returns The post, or null when this bot owns no intro yet.
 */
export function pickBoardIntro<T extends IntroCandidate>(
  threads: readonly T[],
  titles: readonly string[],
  botUserId: string | null = getApiBotUserId(),
): T | null {
  const titled = threads.filter(
    (t) => titles.includes(t.name) && t.archived !== true,
  );
  if (botUserId === null) return titled.find((t) => t.pinned) ?? null;
  const mine = titled.filter((t) => t.ownerId === botUserId);
  return [...mine].sort(preferred)[0] ?? null;
}
