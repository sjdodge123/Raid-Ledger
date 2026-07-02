/**
 * Tests for scheduled-event.db-helpers — findReconciliationCandidates batch limit (ROK-969).
 */
import {
  findReconciliationCandidates,
  RECONCILIATION_BATCH_SIZE,
} from './scheduled-event.db-helpers';
// ROK-1391 — create-time revalidation helpers live in their own module.
import {
  getEventLiveState,
  saveScheduledEventId,
} from './scheduled-event.revalidate';

function createQueryChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

/** Chain terminating at `.limit()` (single-row reads: getEventLiveState). */
function createLimitChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  return chain;
}

/** Conditional UPDATE chain: `.set().where().returning()` → returningRows. */
function createReturningUpdate(returningRows: unknown[]) {
  const returning = jest.fn().mockResolvedValue(returningRows);
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.returning = returning;
  return { chain, returning };
}

describe('findReconciliationCandidates', () => {
  it('applies a batch limit of 5 to prevent API queue flooding (ROK-969)', async () => {
    const chain = createQueryChain([]);
    const mockDb = { select: jest.fn().mockReturnValue(chain) } as never;

    await findReconciliationCandidates(mockDb);

    expect(chain.limit).toHaveBeenCalledWith(RECONCILIATION_BATCH_SIZE);
  });

  it('returns candidates from the query', async () => {
    const candidate = {
      id: 1,
      title: 'Test',
      description: null,
      startTime: '2026-04-01T00:00:00Z',
      endTime: '2026-04-01T02:00:00Z',
      gameId: 1,
      isAdHoc: false,
      notificationChannelOverride: null,
      signupCount: 0,
      maxAttendees: 10,
    };
    const chain = createQueryChain([candidate]);
    const mockDb = { select: jest.fn().mockReturnValue(chain) } as never;

    const result = await findReconciliationCandidates(mockDb);

    expect(result).toEqual([candidate]);
  });
});

describe('getEventLiveState (ROK-1391)', () => {
  it('returns the live reschedule flag, cancellation, and derived start/end (single .limit(1) read)', async () => {
    const row = {
      reschedulingPollId: 'poll-9',
      cancelledAt: null,
      startIso: '2026-07-04T18:00:00.000Z',
      endIso: '2026-07-04T21:00:00.000Z',
    };
    const chain = createLimitChain([row]);
    const mockDb = { select: jest.fn().mockReturnValue(chain) } as never;

    const state = await getEventLiveState(mockDb, 42);

    expect(state).toEqual({
      reschedulingPollId: 'poll-9',
      cancelledAt: null,
      startIso: '2026-07-04T18:00:00.000Z',
      endIso: '2026-07-04T21:00:00.000Z',
    });
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it('surfaces a set reschedule flag and cancellation timestamp', async () => {
    const row = {
      reschedulingPollId: 'poll-7',
      cancelledAt: '2026-07-04T12:00:00.000Z',
      startIso: '2026-07-04T18:00:00.000Z',
      endIso: '2026-07-04T21:00:00.000Z',
    };
    const chain = createLimitChain([row]);
    const mockDb = { select: jest.fn().mockReturnValue(chain) } as never;

    const state = await getEventLiveState(mockDb, 7);

    // getEventLiveState is nullable (row can be gone mid-flight); assert present.
    expect(state).not.toBeNull();
    expect(state?.reschedulingPollId).toBe('poll-7');
    expect(state?.cancelledAt).toBe('2026-07-04T12:00:00.000Z');
  });
});

describe('saveScheduledEventId — conditional bind (ROK-1391)', () => {
  it('binds and reports { bound: true } when the conditional UPDATE matches a row (NULL or already-our-id)', async () => {
    const { chain, returning } = createReturningUpdate([{ id: 42 }]);
    const mockDb = { update: jest.fn().mockReturnValue(chain) } as never;

    const result = await saveScheduledEventId(mockDb, 42, 'se-1');

    expect(chain.set).toHaveBeenCalledWith({ discordScheduledEventId: 'se-1' });
    expect(returning).toHaveBeenCalled();
    expect(result).toEqual({ bound: true });
  });

  it('reports { bound: false } when the conditional UPDATE matches 0 rows (a DIFFERENT id is already bound)', async () => {
    const { chain } = createReturningUpdate([]);
    const mockDb = { update: jest.fn().mockReturnValue(chain) } as never;

    const result = await saveScheduledEventId(mockDb, 42, 'se-1');

    expect(result).toEqual({ bound: false });
  });
});
