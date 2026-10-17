/**
 * ROK-1471 D10 — thread naming and the rename/tag debounce.
 *
 * Split out of `LfgBoardService` (which is the file most likely to breach the
 * 300-line cap) for a second reason too: the debounce is the one piece of this
 * story with its own notion of TIME, and it is only cheaply testable while it
 * owns nothing else. Nothing here touches Discord — the caller supplies the
 * `apply` callback that does, and owns its error handling.
 *
 * Why a trailing window that the FIRST schedule opens, rather than one each
 * later call resets: a group that gains a hand every four seconds would reset a
 * resetting window forever and never get renamed at all. The trailing window
 * guarantees the thread's name catches up at most `delayMs` after it went
 * stale, which is what the rate limit actually asks for.
 */
import { effectiveLfgState, groupLine } from '@raid-ledger/contract';
import type { LfmGroupView } from '../lfm/lfm-embed.helpers';
import { DISCORD_THREAD_NAME_MAX } from './lfg-board.constants';

const SEP = '·';
const ELLIPSIS = '…';

/** The metadata a thread should be carrying after the window closes. */
export interface ThreadMeta {
  /** The thread's name, already truncated by `threadNameFor`. */
  name: string;
  /** Forum tag id to apply, when one resolved. */
  tagId?: string;
}

/** What the debouncer calls when a thread's window closes. Must not reject. */
export type ApplyThreadMeta = (
  threadId: string,
  desired: ThreadMeta,
) => Promise<void>;

/**
 * The thread name for a group's current render: `<game> · <groupLine>`.
 *
 * ROK-1505 D5 — the sentence after the game name is the contract's
 * `groupLine`, the SAME formatter the web chips render (`1 looking · needs 1
 * more`, then `N looking to play` from two hands), so the board and the chips
 * cannot drift apart about the same group. Emoji-free and CTA-free: the forum
 * title already carries the game and the `+1` is a button.
 *
 * The head-count is the part that changes, so it is the game name that gets
 * truncated when the pair would exceed Discord's cap — dropping the suffix
 * instead would freeze renames for any long-named game.
 *
 * @param view - The group as the caller read it.
 * @returns A name of at most `DISCORD_THREAD_NAME_MAX` characters.
 */
export function threadNameFor(view: LfmGroupView): string {
  const line = groupLine(
    view.memberCount,
    effectiveLfgState(view.memberCount),
    view.viabilityThreshold,
  );
  const suffix = ` ${SEP} ${line}`;
  const room = DISCORD_THREAD_NAME_MAX - suffix.length;
  const gameName =
    view.gameName.length <= room
      ? view.gameName
      : `${view.gameName.slice(0, room - 1)}${ELLIPSIS}`;
  return `${gameName}${suffix}`;
}

/** One thread's open window: the timer, and the latest state it should reach. */
interface PendingRename {
  desired: ThreadMeta;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Coalesces thread renames and tag edits onto a trailing per-thread timer.
 *
 * Content edits never come through here — the starter-message embed is what
 * people read, so it is written immediately on every change (D10).
 */
export class LfgBoardDebouncer {
  private readonly pending = new Map<string, PendingRename>();

  /**
   * @param delayMs - Length of the trailing window.
   * @param apply - Writes the metadata to Discord. Owns its own error handling.
   */
  constructor(
    private readonly delayMs: number,
    private readonly apply: ApplyThreadMeta,
  ) {}

  /**
   * Record the state a thread should reach, applying it when the window closes.
   *
   * @param threadId - Thread whose metadata changed.
   * @param desired - The state to reach; REPLACES any state already queued.
   */
  schedule(threadId: string, desired: ThreadMeta): void {
    const open = this.pending.get(threadId);
    if (open) {
      // The window is not restarted — only the destination is updated, so the
      // apply that eventually fires carries the newest count, not the oldest.
      open.desired = desired;
      return;
    }
    const timer = setTimeout(() => {
      // A rejection escaping a timer is an unhandled rejection, which takes the
      // process down; `apply` logs, and the next event reschedules.
      void this.fire(threadId).catch(() => undefined);
    }, this.delayMs);
    timer.unref?.();
    this.pending.set(threadId, { desired, timer });
  }

  /**
   * Apply now, without waiting out the window.
   *
   * @param threadId - Thread to flush; omit to drain every pending thread. A
   * drain isolates each thread and always resolves; `flush(id)` propagates
   * that one thread's failure to the caller who asked for it.
   */
  async flush(threadId?: string): Promise<void> {
    if (threadId !== undefined) {
      await this.fire(threadId);
      return;
    }
    // allSettled, not a sequential await: the `apply` contract ("must not
    // reject") is only a JSDoc promise, and the day it is broken one refused
    // retag must not abort the drain. A sequential loop would leave every
    // LATER thread pending and reject the drain — which is what
    // `POST /admin/test/lfg-board/flush` awaits, so the smoke test would read
    // it as "the rename never landed" rather than "one thread lost its tag".
    // `fire` already dequeues before applying, so nothing is left wedged.
    await Promise.allSettled(
      [...this.pending.keys()].map((id) => this.fire(id)),
    );
  }

  /** How many threads are waiting out a window. Test + shutdown affordance. */
  pendingCount(): number {
    return this.pending.size;
  }

  /** Disarm, dequeue, then apply — so a failed apply cannot wedge the thread. */
  private async fire(threadId: string): Promise<void> {
    const open = this.pending.get(threadId);
    if (!open) return;
    clearTimeout(open.timer);
    this.pending.delete(threadId);
    await this.apply(threadId, open.desired);
  }
}

/**
 * How many times Discord lets ONE thread's name change inside the window.
 *
 * Discord applies a per-channel sublimit to `PATCH /channels/{id}` whenever
 * the body carries `name`: two changes per ten minutes. The third is answered
 * with a 429 whose `retry_after` is the rest of the window, and discord.js
 * holds the request — and, because every other metadata write is the SAME
 * route, everything queued behind it — until that expires.
 */
export const THREAD_RENAME_LIMIT = 2;

/** The window {@link THREAD_RENAME_LIMIT} is counted over. */
export const THREAD_RENAME_WINDOW_MS = 10 * 60 * 1000;

/**
 * ROK-1505 — a per-thread ration of Discord's rename sublimit.
 *
 * The board renames a post on every change of shape, and ROK-1505 added two
 * more shapes to a group's life (`LOOKING` at one hand, and the downgrade
 * back to it), so a group that forms and dissolves inside ten minutes now
 * asks for three renames where it used to ask for two. The third one is not
 * merely refused: it PARKS the thread's `PATCH /channels/{id}` bucket for the
 * rest of the window, and the retag and the archive that a terminal render
 * issues next are stranded behind it — the post keeps its stale title AND its
 * stale tag AND stays unarchived, with only the starter embed (a different
 * route) telling the truth. That is the CI failure this exists to stop.
 *
 * So the rename is rationed on OUR side and simply skipped when the window is
 * full: a title one shape out of date is a cosmetic loss, while a stranded
 * archive leaves a dead group advertised on the board. The count is in memory
 * and per process — a restart forgets it, which can spend one stalled rename
 * before the ration is rebuilt, and that is the deliberate cheap version.
 */
export class ThreadRenameBudget {
  /** Timestamps of the renames issued for a thread, newest last. */
  private readonly spent = new Map<string, number[]>();

  /**
   * @param limit - Renames allowed per window.
   * @param windowMs - Length of the window.
   */
  constructor(
    private readonly limit: number = THREAD_RENAME_LIMIT,
    private readonly windowMs: number = THREAD_RENAME_WINDOW_MS,
  ) {}

  /**
   * Take one rename from a thread's ration.
   *
   * @param threadId - Thread about to be renamed.
   * @param now - Clock, injectable for the tests.
   * @returns Whether the caller may issue the rename.
   */
  trySpend(threadId: string, now: number = Date.now()): boolean {
    const live = (this.spent.get(threadId) ?? []).filter(
      (at) => now - at < this.windowMs,
    );
    if (live.length >= this.limit) {
      this.spent.set(threadId, live);
      return false;
    }
    live.push(now);
    this.spent.set(threadId, live);
    return true;
  }

  /** Drop a thread's history once it is archived and will not be renamed. */
  forget(threadId: string): void {
    this.spent.delete(threadId);
  }
}
