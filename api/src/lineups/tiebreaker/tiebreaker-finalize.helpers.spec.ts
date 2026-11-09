/**
 * ROK-2098 — finalizeTiebreaker is once-only AND repairable.
 *
 * The collaborators are faked over one in-memory store, and the advance lock
 * is faked as a real mutex whose callback gets a distinct `TX` handle and
 * rolls the store back when the callback throws (like the PG transaction),
 * so the concurrency cases exercise the same read-durable-state-under-the-
 * lock logic the service runs — and every query can be checked to run on
 * the lock's `tx`, never the outer pool (Codex P1).
 */
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type * as schema from '../../drizzle/schema';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { finalizeTiebreaker } from './tiebreaker-finalize.helpers';
import { withTiebreakerAdvanceLock } from './tiebreaker-advance.helpers';
import {
  announceLineupDecided,
  decideLineupInTx,
  type TiebreakerDecideDeps,
} from './tiebreaker-decide.helpers';
import {
  clearActiveTiebreaker,
  markTiebreakerResolved,
} from './tiebreaker-lifecycle.helpers';
import { writeTiebreakerCohortMemory } from '../cohort-memory-write.helpers';
import {
  findLineupDecideState,
  findTiebreakerRow,
  type LineupDecideState,
} from './tiebreaker-query.helpers';

jest.mock('./tiebreaker-advance.helpers', () => ({
  withTiebreakerAdvanceLock: jest.fn(),
}));
jest.mock('./tiebreaker-decide.helpers', () => ({
  decideLineupInTx: jest.fn(),
  announceLineupDecided: jest.fn(),
}));
jest.mock('./tiebreaker-lifecycle.helpers', () => ({
  clearActiveTiebreaker: jest.fn(),
  markTiebreakerResolved: jest.fn(),
}));
jest.mock('../cohort-memory-write.helpers', () => ({
  writeTiebreakerCohortMemory: jest.fn(),
}));
jest.mock('./tiebreaker-query.helpers', () => ({
  findLineupDecideState: jest.fn(),
  findTiebreakerRow: jest.fn(),
}));

type Db = TiebreakerDecideDeps['db'];
type TiebreakerRow = typeof schema.communityLineupTiebreakers.$inferSelect;

const TB_ID = 5;
const LINEUP_ID = 9;
/** The lock transaction's handle — distinct from `deps.db` (the outer pool). */
const TX = { lockTransaction: true } as unknown as Db;
const EMPTY_PASS = { schedulingMatchIds: [], orphanedCards: [] };

interface Store {
  tb: TiebreakerRow;
  lineup: LineupDecideState;
  /** Matching passes that ran (each one wipes + reposts poll cards). */
  matchingRuns: number;
  /** Fail the next N decide calls (simulates a flip/matching failure). */
  decideFailures: number;
  /** True while a fake-lock callback runs. */
  lockHeld: boolean;
  /** `lockHeld` at each poll-card announce (must all be false). */
  announcedUnderLock: boolean[];
}

function tiebreakerRow(overrides: Partial<TiebreakerRow> = {}): TiebreakerRow {
  return {
    id: TB_ID,
    lineupId: LINEUP_ID,
    mode: 'bracket',
    status: 'active',
    tiedGameIds: [11, 22],
    originalVoteCount: 3,
    winnerGameId: null,
    roundDeadline: null,
    resolvedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

/**
 * A real mutex: callers run strictly one after another, like the PG lock.
 * The callback gets `TX`; a throw rolls the store back, like the transaction.
 */
function fakeLock(store: Store) {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(_db: Db, _id: number, fn: (tx: Db) => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const snapshot = { tb: store.tb, lineup: store.lineup };
      store.lockHeld = true;
      try {
        return await fn(TX);
      } catch (err) {
        Object.assign(store, snapshot);
        throw err;
      } finally {
        store.lockHeld = false;
      }
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

function wireStore(store: Store): void {
  jest.mocked(withTiebreakerAdvanceLock).mockImplementation(fakeLock(store));
  jest.mocked(findTiebreakerRow).mockImplementation(async () => {
    await Promise.resolve();
    return { ...store.tb };
  });
  jest
    .mocked(findLineupDecideState)
    .mockImplementation(() => Promise.resolve({ ...store.lineup }));
  jest
    .mocked(markTiebreakerResolved)
    .mockImplementation(async (_db, _id, w) => {
      await Promise.resolve();
      store.tb = { ...store.tb, status: 'resolved', winnerGameId: w };
      return LINEUP_ID;
    });
  jest.mocked(clearActiveTiebreaker).mockResolvedValue(undefined);
  jest.mocked(decideLineupInTx).mockImplementation(async () => {
    await Promise.resolve();
    store.lineup = { ...store.lineup, status: 'decided' };
    if (store.decideFailures > 0) {
      store.decideFailures -= 1;
      throw new Error('matching blew up');
    }
    store.matchingRuns += 1;
    store.lineup = { ...store.lineup, hasMatches: true };
    return EMPTY_PASS;
  });
  jest.mocked(announceLineupDecided).mockImplementation(() => {
    store.announcedUnderLock.push(store.lockHeld);
    return Promise.resolve();
  });
}

function newStore(overrides: Partial<Store> = {}): Store {
  return {
    tb: tiebreakerRow(),
    lineup: { status: 'voting', hasMatches: false },
    matchingRuns: 0,
    decideFailures: 0,
    lockHeld: false,
    announcedUnderLock: [],
    ...overrides,
  };
}

const deps: TiebreakerDecideDeps = {
  db: createDrizzleMock() as unknown as Db,
  logger: new Logger('finalize-spec'),
  events: new EventEmitter2(),
};

beforeEach(() => jest.clearAllMocks());

describe('finalizeTiebreaker races (ROK-2098)', () => {
  it('force-resolve racing the final vote runs matching exactly once', async () => {
    const store = newStore();
    wireStore(store);
    const forcePick = jest.fn(() => Promise.resolve(22));
    const votePick = jest.fn(() => Promise.resolve(11));

    const results = await Promise.all([
      finalizeTiebreaker(deps, TB_ID, forcePick),
      finalizeTiebreaker(deps, TB_ID, votePick),
    ]);

    expect(store.matchingRuns).toBe(1);
    expect(decideLineupInTx).toHaveBeenCalledTimes(1);
    expect(markTiebreakerResolved).toHaveBeenCalledTimes(1);
    // Side effects fire once, for the caller that did the work, after commit.
    expect(store.announcedUnderLock).toEqual([false]);
    expect(writeTiebreakerCohortMemory).toHaveBeenCalledTimes(1);
    // The second caller adopts the stored winner instead of re-picking.
    expect(votePick).not.toHaveBeenCalled();
    expect(results).toEqual([22, 22]);
  });

  it('picks (and so advances the bracket) once across concurrent force-resolves', async () => {
    const store = newStore();
    wireStore(store);
    const forcePick = jest.fn(() => Promise.resolve(22));

    await Promise.all([
      finalizeTiebreaker(deps, TB_ID, forcePick),
      finalizeTiebreaker(deps, TB_ID, forcePick),
    ]);

    expect(forcePick).toHaveBeenCalledTimes(1);
  });
});

describe('finalizeTiebreaker repair (ROK-2098)', () => {
  it('repairs a lineup stuck in voting after the resolve committed', async () => {
    const store = newStore({
      tb: tiebreakerRow({ status: 'resolved', winnerGameId: 7 }),
    });
    wireStore(store);
    const pick = jest.fn(() => Promise.resolve(99));

    await expect(finalizeTiebreaker(deps, TB_ID, pick)).resolves.toBe(7);

    expect(pick).not.toHaveBeenCalled();
    expect(markTiebreakerResolved).not.toHaveBeenCalled();
    expect(writeTiebreakerCohortMemory).not.toHaveBeenCalled();
    expect(clearActiveTiebreaker).toHaveBeenCalledWith(TX, LINEUP_ID);
    expect(decideLineupInTx).toHaveBeenCalledWith(TX, LINEUP_ID, 7);
    expect(announceLineupDecided).toHaveBeenCalledWith(
      deps,
      LINEUP_ID,
      EMPTY_PASS,
    );
    expect(store.lineup.status).toBe('decided');
  });

  it('re-runs matching for a decided lineup whose matching pass failed', async () => {
    const store = newStore({
      tb: tiebreakerRow({ status: 'resolved', winnerGameId: 7 }),
      lineup: { status: 'decided', hasMatches: false },
    });
    wireStore(store);

    await finalizeTiebreaker(deps, TB_ID, jest.fn());

    expect(decideLineupInTx).toHaveBeenCalledWith(TX, LINEUP_ID, 7);
    expect(store.matchingRuns).toBe(1);
  });

  it('counts only match groups created since the tiebreaker began', async () => {
    const createdAt = new Date('2026-11-01T12:00:00Z');
    const store = newStore({
      tb: tiebreakerRow({ status: 'resolved', winnerGameId: 7, createdAt }),
      lineup: { status: 'decided', hasMatches: false },
    });
    wireStore(store);

    await finalizeTiebreaker(deps, TB_ID, jest.fn());

    expect(findLineupDecideState).toHaveBeenCalledWith(
      TX,
      LINEUP_ID,
      createdAt,
    );
  });
});

describe('finalizeTiebreaker rollback (ROK-2098 Codex P1)', () => {
  it('a failed decide rolls the whole finalize back and fires nothing; a retry completes it', async () => {
    const store = newStore({ decideFailures: 1 });
    wireStore(store);
    const pick = jest.fn(() => Promise.resolve(22));

    await expect(finalizeTiebreaker(deps, TB_ID, pick)).rejects.toThrow(
      'matching blew up',
    );
    expect(store.tb.status).toBe('active');
    expect(store.lineup).toEqual({ status: 'voting', hasMatches: false });
    expect(announceLineupDecided).not.toHaveBeenCalled();
    expect(writeTiebreakerCohortMemory).not.toHaveBeenCalled();

    await expect(finalizeTiebreaker(deps, TB_ID, pick)).resolves.toBe(22);

    expect(pick).toHaveBeenCalledTimes(2);
    expect(store.matchingRuns).toBe(1);
    expect(store.lineup).toEqual({ status: 'decided', hasMatches: true });
    expect(store.announcedUnderLock).toEqual([false]);
  });
});

describe('finalizeTiebreaker runs every query on the lock tx (ROK-2098 Codex P1)', () => {
  it('hands the picker and every read/write the lock transaction, never the pool', async () => {
    const store = newStore();
    wireStore(store);
    const pick = jest.fn(() => Promise.resolve(22));

    await finalizeTiebreaker(deps, TB_ID, pick);

    expect(findTiebreakerRow).toHaveBeenCalledWith(TX, TB_ID);
    expect(pick).toHaveBeenCalledWith(
      expect.objectContaining({ id: TB_ID }),
      TX,
    );
    expect(markTiebreakerResolved).toHaveBeenCalledWith(TX, TB_ID, 22);
    expect(clearActiveTiebreaker).toHaveBeenCalledWith(TX, LINEUP_ID);
    expect(findLineupDecideState).toHaveBeenCalledWith(
      TX,
      LINEUP_ID,
      store.tb.createdAt,
    );
    expect(decideLineupInTx).toHaveBeenCalledWith(TX, LINEUP_ID, 22);
    // Only the after-commit, best-effort cohort write uses the pool.
    expect(writeTiebreakerCohortMemory).toHaveBeenCalledWith(
      deps.db,
      LINEUP_ID,
      TB_ID,
      22,
      deps.logger,
    );
  });
});

describe('finalizeTiebreaker no-ops (ROK-2098)', () => {
  it('leaves a decided lineup with match groups alone', async () => {
    const store = newStore({
      tb: tiebreakerRow({ status: 'resolved', winnerGameId: 7 }),
      lineup: { status: 'decided', hasMatches: true },
    });
    wireStore(store);

    await expect(finalizeTiebreaker(deps, TB_ID, jest.fn())).resolves.toBe(7);

    expect(decideLineupInTx).not.toHaveBeenCalled();
  });

  it('never drags a lineup back from a later phase', async () => {
    const store = newStore({
      tb: tiebreakerRow({ status: 'resolved', winnerGameId: 7 }),
      lineup: { status: 'archived', hasMatches: false },
    });
    wireStore(store);

    await finalizeTiebreaker(deps, TB_ID, jest.fn());

    expect(decideLineupInTx).not.toHaveBeenCalled();
  });

  it('does nothing for a dismissed tiebreaker', async () => {
    const store = newStore({ tb: tiebreakerRow({ status: 'dismissed' }) });
    wireStore(store);
    const pick = jest.fn(() => Promise.resolve(22));

    await expect(finalizeTiebreaker(deps, TB_ID, pick)).resolves.toBeNull();

    expect(pick).not.toHaveBeenCalled();
    expect(clearActiveTiebreaker).not.toHaveBeenCalled();
    expect(decideLineupInTx).not.toHaveBeenCalled();
  });
});
