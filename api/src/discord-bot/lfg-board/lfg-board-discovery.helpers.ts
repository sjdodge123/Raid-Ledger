/**
 * ROK-1492 D6 — deciding WHICH forum post is the board's intro.
 *
 * Pure and Discord-free so the decision can be argued about on its own: the
 * listener owns the API calls and the persistence, this file owns the choice.
 */
import { ChannelFlags } from 'discord.js';
import { LFG_BOARD_INTRO_TITLE } from './lfg-board.constants';

/**
 * The parts of a forum post the D6 rediscovery reads.
 *
 * Structural, not `AnyThreadChannel`, because that union's `pin()` return
 * type is generic in "is this a forum thread"; the scan only ever needs an
 * id, a title, an author, the pinned flag and the ability to pin.
 */
export interface IntroCandidate {
  id: string;
  name: string;
  ownerId: string | null;
  flags: { has: (flag: number) => boolean };
  pin: (reason?: string) => Promise<unknown>;
}

/**
 * Whether a forum post is the board's OWN intro.
 *
 * The author half is not belt-and-braces: a guild that existed before the
 * forum was locked can hold a member's post titled "How this board works",
 * and adopting it would hand a member the pinned post the bot then edits.
 *
 * @param thread - A candidate forum post.
 * @param botUserId - The app's own Discord user id.
 */
export function isOwnIntro(thread: IntroCandidate, botUserId: string): boolean {
  return thread.name === LFG_BOARD_INTRO_TITLE && thread.ownerId === botUserId;
}

/** Whether a forum post already sits pinned at the top of its forum. */
export function isPinned(thread: IntroCandidate): boolean {
  return thread.flags.has(ChannelFlags.Pinned);
}

/**
 * Choose the board's intro post from a forum's active threads.
 *
 * A pinned candidate wins outright — that is the one members actually see.
 * Otherwise the lowest snowflake (the oldest post, i.e. the one carrying the
 * history), so two enables in a row always adopt the same thread.
 *
 * @param threads - Active posts in the board forum.
 * @param botUserId - The app's own Discord user id.
 * @returns The post to adopt, or `null` when the forum holds none of ours.
 */
export function pickIntro(
  threads: IntroCandidate[],
  botUserId: string,
): IntroCandidate | null {
  const mine = threads.filter((t) => isOwnIntro(t, botUserId));
  const pinned = mine.find(isPinned);
  if (pinned) return pinned;
  const [oldest] = [...mine].sort(
    (a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id),
  );
  return oldest ?? null;
}
