/**
 * ROK-1471 D10 / AC8 — thread naming and the rename/tag debounce.
 *
 * The high-risk assertions here, and why each exists:
 *
 *  - **five schedules produce ONE apply carrying the LAST desired state.** Both
 *    halves matter. A debouncer that coalesced to one apply but replayed the
 *    FIRST desired would rename the thread to a stale head-count and then never
 *    correct it, and a count-only assertion would pass.
 *  - **the window is per THREAD.** Two busy groups must not starve each other.
 *  - **flush disarms the timer.** If `flush` applied now and the timer applied
 *    again later, every terminal transition would burn two of a rename budget
 *    Discord meters aggressively.
 *  - **truncation keeps the count.** The name is truncated because Discord caps
 *    it at 100, but the head-count is the part that CHANGES, so a truncation
 *    that ate it would freeze renames for long-named games.
 */
import { DISCORD_THREAD_NAME_MAX } from './lfg-board.constants';
import type { LfmGroupView } from '../lfm/lfm-embed.helpers';
import {
  LfgBoardDebouncer,
  threadNameFor,
  type ThreadMeta,
} from './lfg-board-thread.helpers';

const DELAY = 5000;

function view(overrides: Partial<LfmGroupView> = {}): LfmGroupView {
  return {
    state: 'open',
    gameId: 12,
    gameName: 'Deep Rock Galactic',
    gameSlug: 'deep-rock-galactic',
    memberCount: 3,
    ...overrides,
  };
}

describe('threadNameFor (D10)', () => {
  it('reads "{game} · {n} looking"', () => {
    expect(threadNameFor(view())).toBe('Deep Rock Galactic · 3 looking');
  });

  it("truncates the GAME NAME so the head-count survives Discord's cap", () => {
    const name = threadNameFor(view({ gameName: 'A'.repeat(200) }));
    expect(name.length).toBeLessThanOrEqual(DISCORD_THREAD_NAME_MAX);
    expect(name).toMatch(/ · 3 looking$/);
    expect(name.startsWith('AAAA')).toBe(true);
  });

  it('leaves a name that already fits completely alone', () => {
    const name = threadNameFor(view({ memberCount: 12 }));
    expect(name).toBe('Deep Rock Galactic · 12 looking');
    expect(name).not.toContain('…');
  });
});

let applied: Array<[string, ThreadMeta]>;
let apply: jest.Mock;
let debouncer: LfgBoardDebouncer;

beforeEach(() => {
  jest.useFakeTimers();
  applied = [];
  // Not an `async` arrow: it would have nothing to await.
  apply = jest.fn((threadId: string, desired: ThreadMeta) => {
    applied.push([threadId, desired]);
    return Promise.resolve();
  });
  debouncer = new LfgBoardDebouncer(DELAY, apply);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('LfgBoardDebouncer — the trailing window (AC8)', () => {
  it('coalesces five schedules into ONE apply carrying the LAST desired', async () => {
    for (const n of [3, 4, 5, 6, 7]) {
      debouncer.schedule('thread-1', { name: `DRG · ${String(n)} looking` });
    }
    expect(apply).not.toHaveBeenCalled();
    expect(debouncer.pendingCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(DELAY);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([['thread-1', { name: 'DRG · 7 looking' }]]);
    expect(debouncer.pendingCount()).toBe(0);
  });

  it('keeps a separate window per thread', async () => {
    debouncer.schedule('thread-1', { name: 'one', tagId: 'tag-a' });
    debouncer.schedule('thread-2', { name: 'two', tagId: 'tag-b' });
    expect(debouncer.pendingCount()).toBe(2);

    await jest.advanceTimersByTimeAsync(DELAY);

    expect(apply).toHaveBeenCalledTimes(2);
    expect(applied).toContainEqual([
      'thread-1',
      { name: 'one', tagId: 'tag-a' },
    ]);
    expect(applied).toContainEqual([
      'thread-2',
      { name: 'two', tagId: 'tag-b' },
    ]);
  });
});

describe('LfgBoardDebouncer — flush (AC8)', () => {
  it('flush(id) applies NOW and disarms the timer', async () => {
    debouncer.schedule('thread-1', { name: 'final', tagId: 'SCHEDULED' });

    await debouncer.flush('thread-1');

    expect(apply).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([
      ['thread-1', { name: 'final', tagId: 'SCHEDULED' }],
    ]);
    expect(debouncer.pendingCount()).toBe(0);

    // The timer must NOT fire a second, duplicate rename afterwards.
    await jest.advanceTimersByTimeAsync(DELAY * 2);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('flush(id) leaves OTHER threads pending', async () => {
    debouncer.schedule('thread-1', { name: 'one' });
    debouncer.schedule('thread-2', { name: 'two' });

    await debouncer.flush('thread-1');

    expect(apply).toHaveBeenCalledTimes(1);
    expect(debouncer.pendingCount()).toBe(1);
  });

  it('flush() with nothing pending resolves and applies nothing', async () => {
    await expect(debouncer.flush()).resolves.toBeUndefined();
    await expect(debouncer.flush('never-scheduled')).resolves.toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });

  it('flush() with no id drains every pending thread', async () => {
    debouncer.schedule('thread-1', { name: 'one' });
    debouncer.schedule('thread-2', { name: 'two' });

    await debouncer.flush();

    expect(apply).toHaveBeenCalledTimes(2);
    expect(debouncer.pendingCount()).toBe(0);
  });

  it('a rejecting apply on the TIMER path still clears the entry', async () => {
    const boom = new LfgBoardDebouncer(DELAY, () =>
      Promise.reject(new Error('missing ManageThreads')),
    );
    boom.schedule('thread-1', { name: 'one' });

    await jest.advanceTimersByTimeAsync(DELAY);

    // An unhandled rejection out of a timer takes the process down, and a
    // stuck entry would block every later schedule for that thread.
    expect(boom.pendingCount()).toBe(0);
  });
});
