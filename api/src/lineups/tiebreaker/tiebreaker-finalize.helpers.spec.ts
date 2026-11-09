/**
 * ROK-2098 — finalizeTiebreaker is once-only AND repairable.
 *
 * The collaborators are faked over one in-memory store, and the advance lock
 * is faked as a real mutex, so the concurrency cases exercise the same
 * read-durable-state-under-the-lock logic the service runs.
 */
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type * as schema from '../../drizzle/schema';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { finalizeTiebreaker } from './tiebreaker-finalize.helpers';
import { withTiebreakerAdvanceLock } from './tiebreaker-advance.helpers';
import {
  decideLineupFromTiebreaker,
  type TiebreakerDecideDeps,
} from './tiebreaker-decide.helpers';
import {
  clearActiveTiebreaker,
  resolveTiebreaker,
} from './tiebreaker-lifecycle.helpers';
import {
  findLineupDecideState,
  findTiebreakerRow,
  type LineupDecideState,
} from './tiebreaker-query.helpers';

jest.mock('./tiebreaker-advance.helpers', () => ({
  withTiebreakerAdvanceLock: jest.fn(),
}));
jest.mock('./tiebreaker-decide.helpers', () => ({
  decideLineupFromTiebreaker: jest.fn(),
}));
jest.mock('./tiebreaker-lifecycle.helpers', () => ({
  clearActiveTiebreaker: jest.fn(),
  resolveTiebreaker: jest.fn(),
}));
jest.mock('./tiebreaker-query.helpers', () => ({
  findLineupDecideState: jest.fn(),
  findTiebreakerRow: jest.fn(),
}));

type Db = TiebreakerDecideDeps['db'];
type TiebreakerRow = typeof schema.communityLineupTiebreakers.$inferSelect;

const TB_ID = 5;
const LINEUP_ID = 9;

interface Store {
  tb: TiebreakerRow;
  lineup: LineupDecideState;
  /** Matching passes that ran (each one wipes + reposts poll cards). */
  matchingRuns: number;
  /** Fail the next N decide calls (simulates a flip/matching failure). */
  decideFailures: number;
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

/** A real mutex: callers run strictly one after another, like the PG lock. */
function fakeLock() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(db: Db, _id: number, fn: (tx: Db) => Promise<T>): Promise<T> => {
    const run = chain.then(() => fn(db));
    chain = run.catch(() => undefined);
    return run;
  };
}

function wireStore(store: Store): void {
  jest.mocked(withTiebreakerAdvanceLock).mockImplementation(fakeLock());
  jest.mocked(findTiebreakerRow).mockImplementation(async () => {
    await Promise.resolve();
    return { ...store.tb };
  });
  jest
    .mocked(findLineupDecideState)
    .mockImplementation(() => Promise.resolve({ ...store.lineup }));
  jest.mocked(resolveTiebreaker).mockImplementation(async (_db, _id, w) => {
    await Promise.resolve();
    store.tb = { ...store.tb, status: 'resolved', winnerGameId: w };
  });
  jest.mocked(clearActiveTiebreaker).mockResolvedValue(undefined);
  jest.mocked(decideLineupFromTiebreaker).mockImplementation(async () => {
    await Promise.resolve();
    store.lineup = { ...store.lineup, status: 'decided' };
    if (store.decideFailures > 0) {
      store.decideFailures -= 1;
      throw new Error('matching blew up');
    }
    store.matchingRuns += 1;
    store.lineup = { ...store.lineup, hasMatches: true };
  });
}

function newStore(overrides: Partial<Store> = {}): Store {
  return {
    tb: tiebreakerRow(),
    lineup: { status: 'voting', hasMatches: false },
    matchingRuns: 0,
    decideFailures: 0,
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
    expect(decideLineupFromTiebreaker).toHaveBeenCalledTimes(1);
    expect(resolveTiebreaker).toHaveBeenCalledTimes(1);
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
    expect(resolveTiebreaker).not.toHaveBeenCalled();
    expect(clearActiveTiebreaker).toHaveBeenCalledWith(deps.db, LINEUP_ID);
    expect(decideLineupFromTiebreaker).toHaveBeenCalledWith(deps, LINEUP_ID, 7);
    expect(store.lineup.status).toBe('decided');
  });

  it('re-runs matching for a decided lineup whose matching pass failed', async () => {
    const store = newStore({
      tb: tiebreakerRow({ status: 'resolved', winnerGameId: 7 }),
      lineup: { status: 'decided', hasMatches: false },
    });
    wireStore(store);

    await finalizeTiebreaker(deps, TB_ID, jest.fn());

    expect(decideLineupFromTiebreaker).toHaveBeenCalledWith(deps, LINEUP_ID, 7);
    expect(store.matchingRuns).toBe(1);
  });

  it('a retry after a failed decide completes it with the stored winner', async () => {
    const store = newStore({ decideFailures: 1 });
    wireStore(store);
    const pick = jest.fn(() => Promise.resolve(22));

    await expect(finalizeTiebreaker(deps, TB_ID, pick)).rejects.toThrow(
      'matching blew up',
    );
    await expect(finalizeTiebreaker(deps, TB_ID, pick)).resolves.toBe(22);

    expect(pick).toHaveBeenCalledTimes(1);
    expect(store.matchingRuns).toBe(1);
    expect(store.lineup).toEqual({ status: 'decided', hasMatches: true });
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

    expect(decideLineupFromTiebreaker).not.toHaveBeenCalled();
  });

  it('never drags a lineup back from a later phase', async () => {
    const store = newStore({
      tb: tiebreakerRow({ status: 'resolved', winnerGameId: 7 }),
      lineup: { status: 'archived', hasMatches: false },
    });
    wireStore(store);

    await finalizeTiebreaker(deps, TB_ID, jest.fn());

    expect(decideLineupFromTiebreaker).not.toHaveBeenCalled();
  });

  it('does nothing for a dismissed tiebreaker', async () => {
    const store = newStore({ tb: tiebreakerRow({ status: 'dismissed' }) });
    wireStore(store);
    const pick = jest.fn(() => Promise.resolve(22));

    await expect(finalizeTiebreaker(deps, TB_ID, pick)).resolves.toBeNull();

    expect(pick).not.toHaveBeenCalled();
    expect(clearActiveTiebreaker).not.toHaveBeenCalled();
    expect(decideLineupFromTiebreaker).not.toHaveBeenCalled();
  });
});
