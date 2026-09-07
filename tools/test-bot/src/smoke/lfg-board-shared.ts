/**
 * What the LFG board smoke phases share (ROK-1505).
 *
 * Extracted VERBATIM from `tests/lfg-board.test.ts` when ROK-1505 added the
 * one-hand / downgrade phases and pushed that file past its counted-line cap.
 * The `Run` record, the thread-name mirror, the forum poll and the
 * identity/assertion helpers live here; the phases themselves live in
 * `lfg-board-hands.ts` (T24/T25/T30) and the test file (T26/T27/T29).
 */
import { pollForCondition } from '../helpers/polling.js';
import { assertEmbedRenderRules } from './assert.js';
import type { FixtureUser, LfgGroupSummary } from './fixtures.js';
import { readForumThreads, type ForumThreadSnapshot } from './fixtures-lfg-board.js';
import type { SimpleEmbed } from '../helpers/messages.js';
import type { TestContext } from './types.js';

/** `LFG_BOARD_INTRO_TITLE` — the pinned explainer, never a group thread. */
export const INTRO_TITLE = 'How this board works';
/** `LFG_JOIN_BUTTON_LABEL`. U+00B7 MIDDLE DOT, as the API constant spells it. */
export const JOIN_LABEL = "+1 · I'm in";
/** `LFG_OPEN_GROUP_LABEL`. U+2197 NORTH EAST ARROW. */
export const OPEN_GROUP_LABEL = 'Open group ↗';
/** `LFG_BUTTON_IDS.JOIN` — the custom id prefix the join listener slices. */
export const JOIN_CUSTOM_ID = 'lfg:join';
/** `DISCORD_THREAD_NAME_MAX` / the `SEP` in `threadNameFor`. */
export const THREAD_NAME_MAX = 100;
export const SEP = '·';
/**
 * `DEFAULT_VIABILITY_THRESHOLD` (`packages/contract/src/lfg-copy.ts`, ROK-1505
 * D5): a game with no Co-Optimus data is assumed to want two players.
 */
const DEFAULT_VIABILITY_THRESHOLD = 2;
/**
 * The longest suffix a thread name can carry — `needs 99 more` is two digits
 * wider than any real Co-Optimus threshold. Every truncated head is at least
 * `THREAD_NAME_MAX - LONGEST_SUFFIX_LENGTH - 1` chars of the game name, so
 * that many chars identify the thread at ANY hand count.
 */
const LONGEST_SUFFIX_LENGTH = ` ${SEP} 1 looking ${SEP} needs 99 more`.length;

/** `GET /lfg/:gameId` — the summary plus the live roster. */
export interface LfgGroupDetail extends LfgGroupSummary {
  members: { userId: number; username: string; displayName: string | null }[];
}

/** Everything the phases share. Assembled as the run progresses. */
export interface Run {
  ctx: TestContext;
  game: { id: number; name: string };
  /** The board forum, addressed by ID (never by name) once provisioned. */
  forumChannelId?: string;
  /** True when the forum outlived a previous run — cleanup must NOT delete it. */
  forumPreexisting: boolean;
  /** Advisory permission warning from the toggle, quoted in later failures. */
  warning?: string;
  /**
   * Thread ids present before the first hand, INCLUDING the intro post. The
   * forum is shared across runs and the idle-game scan can hand back a game
   * whose archived post from a previous run is still there. T30 also retires
   * the thread it CLOSED into this set, so the fresh post that follows is the
   * only live thread `isGroupThread` claims.
   */
  preexistingThreads: Set<string>;
  second?: FixtureUser;
  third?: FixtureUser;
  /** The one thread this group is allowed to own. */
  threadId?: string;
  /** The starter message every later hand must EDIT rather than replace. */
  starterMessageId?: string;
  /** Threads this run closed and retired (T30) — deleted in cleanup. */
  retiredThreadIds: string[];
  lineupId?: number;
  rosterNames?: string[];
}

/** The forum id, or a failure that says the run never got one. */
export function forumId(run: Run): string {
  if (!run.forumChannelId) {
    throw new Error(
      'LFG board: the forum channel was never resolved — the enable step ' +
        'should have failed before reaching here',
    );
  }
  return run.forumChannelId;
}

/**
 * Mirror of contract `groupLine` (ROK-1505 D5 — the chip sentence, emoji-free):
 * `N looking to play` once a group has formed, `N looking · needs M more`
 * while it still needs people, with `M` clamped at 1.
 */
export function groupLine(count: number, threshold: number | null): string {
  if (count >= 2) return `${String(count)} looking to play`;
  const target = threshold ?? DEFAULT_VIABILITY_THRESHOLD;
  const needed = Math.max(1, target - count);
  return `${String(count)} looking ${SEP} needs ${String(needed)} more`;
}

/** Mirror of `threadNameFor`: the game name is what gets truncated, not the count. */
function gameHead(gameName: string, suffix: string): string {
  const room = THREAD_NAME_MAX - suffix.length;
  return gameName.length <= room
    ? gameName
    : `${gameName.slice(0, room - 1)}…`;
}

/** The exact thread name the board must give this group at `count` hands. */
export function expectedThreadName(
  gameName: string,
  count: number,
  threshold: number | null,
): string {
  const suffix = ` ${SEP} ${groupLine(count, threshold)}`;
  return `${gameHead(gameName, suffix)}${suffix}`;
}

/**
 * The head every name this group's thread can take shares.
 *
 * The separator is part of it on purpose: a bare game-name prefix would also
 * match a DIFFERENT game whose name it prefixes ("Halo" vs "Halo Infinite"),
 * and the count is excluded so one prefix identifies the thread at any size.
 * A name long enough to be truncated loses its separator to the ellipsis, so
 * the prefix falls back to the part of the game name every variant keeps.
 */
export function threadNamePrefix(gameName: string): string {
  const room = THREAD_NAME_MAX - LONGEST_SUFFIX_LENGTH;
  return gameName.length <= room
    ? `${gameName} ${SEP} `
    : gameName.slice(0, room - 1);
}

/** `GET /lfg/:gameId` as the admin. */
export function readGroup(
  ctx: TestContext,
  gameId: number,
): Promise<LfgGroupDetail> {
  return ctx.api.get<LfgGroupDetail>(`/lfg/${gameId}`);
}

/** One line per thread, for a failure message that shows the real state. */
export function describeThreads(threads: ForumThreadSnapshot[]): string {
  if (threads.length === 0) return '(none)';
  return threads
    .map((t) => {
      const author = t.starterMessage?.embeds[0]?.author ?? '-';
      const title = t.starterMessage?.embeds[0]?.title ?? '-';
      return (
        `{id=${t.id} name="${t.name}" archived=${String(t.archived)} ` +
        `tags=[${t.appliedTagNames.join(', ')}] embedTitle="${title}" ` +
        `author="${author}"}`
      );
    })
    .join(', ');
}

/**
 * Poll the forum for a thread matching `predicate`.
 *
 * The timeout is re-thrown as `label` plus a dump of every thread in the forum:
 * a bare "pollForCondition timed out" proves nothing about WHICH invariant
 * broke, and this is the shape every phase fails in.
 */
export async function pollForThread(
  run: Run,
  predicate: (t: ForumThreadSnapshot) => boolean,
  label: string,
  timeoutMs = run.ctx.config.timeoutMs,
): Promise<ForumThreadSnapshot> {
  let seen: ForumThreadSnapshot[] = [];
  try {
    return await pollForCondition(async () => {
      seen = await readForumThreads(forumId(run));
      return seen.find(predicate) ?? null;
    }, timeoutMs);
  } catch {
    throw new Error(
      `${label}. Forum ${forumId(run)} holds ${seen.length} thread(s): ` +
        `${describeThreads(seen)}`,
    );
  }
}

/** Threads this run created, for this game, excluding the intro explainer. */
export function isGroupThread(run: Run, t: ForumThreadSnapshot): boolean {
  if (run.preexistingThreads.has(t.id)) return false;
  // Named rather than inferred: the intro post is created by the same enable
  // that provisions the forum, so a slow seed can land AFTER the snapshot.
  if (t.name === INTRO_TITLE) return false;
  // Identity does not rest on the embed alone — a post whose embed is wrong is
  // exactly the defect T24/T25 exist to catch, and it must still be FOUND.
  if (t.name.startsWith(threadNamePrefix(run.game.name))) return true;
  // A thread whose starter message cannot be read is NOT claimed: identity
  // rests on the name, and claiming an unreadable stranger would fail the
  // one-thread invariant for somebody else's post.
  return t.starterMessage?.embeds.some((e) => e.title === run.game.name) ?? false;
}

/** The starter embed for this game, or a failure naming what was there. */
export function starterEmbed(run: Run, t: ForumThreadSnapshot): SimpleEmbed {
  const embeds = t.starterMessage?.embeds ?? [];
  const embed = embeds.find((e) => e.title === run.game.name);
  if (!embed) {
    throw new Error(
      `LFG board: thread ${t.id} ("${t.name}") carries no starter embed ` +
        `titled "${run.game.name}" (embed titles: ` +
        `[${embeds.map((e) => e.title ?? 'null').join(', ')}], starter message ` +
        `${t.starterMessage ? t.starterMessage.id : 'MISSING'})`,
    );
  }
  assertEmbedRenderRules(embed);
  return embed;
}

/** Assert an author line, reporting the line that was actually rendered. */
export function assertAuthor(
  embed: SimpleEmbed,
  pattern: RegExp,
  label: string,
): void {
  const author = embed.author ?? '';
  if (!pattern.test(author)) {
    throw new Error(
      `${label}: expected author matching ${String(pattern)}, got "${author}"`,
    );
  }
}

/** Assert the starter message id never changed (the file's core invariant). */
export function assertSameStarter(
  run: Run,
  t: ForumThreadSnapshot,
  label: string,
): void {
  const id = t.starterMessage?.id;
  if (id !== run.starterMessageId) {
    throw new Error(
      `${label}: expected the SAME starter message id ${run.starterMessageId} ` +
        `(one post per group, edited in place), got ${id ?? 'no starter message'} ` +
        `on thread ${t.id}`,
    );
  }
}

/** The thread name is `${game} · ${groupLine}` — the D5 rename contract. */
export function assertThreadName(
  run: Run,
  t: ForumThreadSnapshot,
  count: number,
  threshold: number | null,
  label: string,
): void {
  const expected = expectedThreadName(run.game.name, count, threshold);
  if (t.name !== expected) {
    throw new Error(
      `${label}: expected thread ${t.id} to be named "${expected}", got ` +
        `"${t.name}"`,
    );
  }
}

/** The thread must carry `tag`, failing with the tags it actually carries. */
export function assertTag(
  t: ForumThreadSnapshot,
  tag: string,
  label: string,
): void {
  if (!t.appliedTagNames.includes(tag)) {
    throw new Error(
      `${label}: thread ${t.id} must carry the forum tag "${tag}" (AC6 — the ` +
        `filter and the embed say the same words), got tags ` +
        `[${t.appliedTagNames.join(', ')}]`,
    );
  }
}
