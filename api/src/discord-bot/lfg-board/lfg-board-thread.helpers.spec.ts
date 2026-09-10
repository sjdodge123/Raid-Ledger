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
import { groupLine } from '@raid-ledger/contract';
import { DISCORD_THREAD_NAME_MAX } from './lfg-board.constants';
import type { LfmGroupView } from '../lfm/lfm-embed.helpers';
import {
  LfgBoardDebouncer,
  ThreadRenameBudget,
  THREAD_RENAME_LIMIT,
  THREAD_RENAME_WINDOW_MS,
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

/**
 * ROK-1505 D5 — the suffix is the contract's `groupLine`, the sentence the web
 * chips render, so the board title and the chip cannot drift. The pre-1505
 * `· N looking` pins below were REWRITTEN to the new rule, not deleted.
 */
describe('threadNameFor (D10 / ROK-1505 D5)', () => {
  it('reads "{game} · {n} looking to play" from two hands', () => {
    expect(threadNameFor(view())).toBe(
      'Deep Rock Galactic · 3 looking to play',
    );
  });

  it('reads "{game} · 1 looking · needs M more" at one hand (AC1)', () => {
    expect(threadNameFor(view({ memberCount: 1 }))).toBe(
      'Deep Rock Galactic · 1 looking · needs 1 more',
    );
  });

  it('counts the shortfall off the viability threshold when one is known', () => {
    expect(threadNameFor(view({ memberCount: 1, viabilityThreshold: 4 }))).toBe(
      'Deep Rock Galactic · 1 looking · needs 3 more',
    );
  });

  it('is the contract formatter, not a local copy of it (AC9)', () => {
    const v = view({ memberCount: 1, viabilityThreshold: 4 });
    expect(threadNameFor(v)).toBe(
      `Deep Rock Galactic · ${groupLine(1, 'lfg', 4)}`,
    );
  });

  it("truncates the GAME NAME so the head-count survives Discord's cap", () => {
    const name = threadNameFor(view({ gameName: 'A'.repeat(200) }));
    expect(name.length).toBeLessThanOrEqual(DISCORD_THREAD_NAME_MAX);
    expect(name).toMatch(/ · 3 looking to play$/);
    expect(name.startsWith('AAAA')).toBe(true);
  });

  it('leaves a name that already fits completely alone', () => {
    const name = threadNameFor(view({ memberCount: 12 }));
    expect(name).toBe('Deep Rock Galactic · 12 looking to play');
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

  it("flush() keeps draining after one thread's apply rejects", async () => {
    // The drain is what POST /admin/test/lfg-board/flush awaits. One thread
    // whose retag is refused must not abort the others: they would stay
    // pending and the endpoint would 500, which reads to a smoke test as
    // "the rename never landed" rather than "one thread lost its tag".
    const applied: string[] = [];
    const boom = new LfgBoardDebouncer(DELAY, (id: string) => {
      applied.push(id);
      return id === 'thread-1'
        ? Promise.reject(new Error('missing ManageThreads'))
        : Promise.resolve();
    });
    boom.schedule('thread-1', { name: 'one' });
    boom.schedule('thread-2', { name: 'two' });

    await expect(boom.flush()).resolves.toBeUndefined();

    expect(applied).toContain('thread-2');
    expect(applied).toHaveLength(2);
    expect(boom.pendingCount()).toBe(0);
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

describe("ThreadRenameBudget — Discord's rename sublimit (ROK-1505)", () => {
  it("allows the window's renames and refuses the one after them", () => {
    const budget = new ThreadRenameBudget();
    const t0 = 1_000_000;

    for (let i = 0; i < THREAD_RENAME_LIMIT; i += 1) {
      expect(budget.trySpend('thread-1', t0 + i)).toBe(true);
    }

    // The refusal is the whole point: issuing this rename parks the thread's
    // PATCH bucket for the rest of the window, and the retag + archive a
    // terminal render sends next are stranded behind it (the ROK-1505 CI
    // failure — post left LOOKING, unarchived, with a CLOSED embed).
    expect(budget.trySpend('thread-1', t0 + THREAD_RENAME_LIMIT)).toBe(false);
  });

  it('is per THREAD — a busy group must not starve a quiet one', () => {
    const budget = new ThreadRenameBudget();
    for (let i = 0; i < THREAD_RENAME_LIMIT; i += 1) {
      budget.trySpend('thread-1', i);
    }

    expect(budget.trySpend('thread-1', THREAD_RENAME_LIMIT)).toBe(false);
    expect(budget.trySpend('thread-2', THREAD_RENAME_LIMIT)).toBe(true);
  });

  it('rolls: a rename older than the window no longer counts', () => {
    const budget = new ThreadRenameBudget();
    const t0 = 1_000_000;
    for (let i = 0; i < THREAD_RENAME_LIMIT; i += 1) {
      budget.trySpend('thread-1', t0 + i);
    }

    expect(budget.trySpend('thread-1', t0 + THREAD_RENAME_WINDOW_MS - 1)).toBe(
      false,
    );
    expect(budget.trySpend('thread-1', t0 + THREAD_RENAME_WINDOW_MS)).toBe(
      true,
    );
  });

  it('forgets an archived thread, so the map cannot grow forever', () => {
    const budget = new ThreadRenameBudget();
    for (let i = 0; i < THREAD_RENAME_LIMIT; i += 1) {
      budget.trySpend('thread-1', i);
    }
    budget.forget('thread-1');

    expect(budget.trySpend('thread-1', THREAD_RENAME_LIMIT)).toBe(true);
  });
});
