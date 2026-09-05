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
 * The thread name for a group's current render.
 *
 * The head-count is the part that changes, so it is the game name that gets
 * truncated when the pair would exceed Discord's cap — dropping the suffix
 * instead would freeze renames for any long-named game.
 *
 * @param view - The group as the caller read it.
 * @returns A name of at most `DISCORD_THREAD_NAME_MAX` characters.
 */
export function threadNameFor(view: LfmGroupView): string {
  const suffix = ` ${SEP} ${String(view.memberCount)} looking`;
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
   * @param threadId - Thread to flush; omit to drain every pending thread.
   */
  async flush(threadId?: string): Promise<void> {
    if (threadId !== undefined) {
      await this.fire(threadId);
      return;
    }
    for (const id of [...this.pending.keys()]) {
      await this.fire(id);
    }
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
