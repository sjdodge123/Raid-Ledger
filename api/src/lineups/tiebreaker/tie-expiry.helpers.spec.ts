/**
 * ROK-1374 — the expiry sweep (D13, AC18, E12).
 *
 * Nobody picked. After the intended voting period plus one week the hold is
 * terminal, and the honest terminal state is `archived` with NOTHING decided:
 * operator answer Q2 forbids the tool choosing a winner, and expiry is the one
 * path where a "sensible default winner" would look most defensible. The
 * assertions below exist to make that impossible to add by accident — the
 * payload check names `decidedGameId` explicitly rather than trusting review.
 *
 * The real-Postgres half lives in `lineup-tie-expiry.integration.spec.ts`
 * (scenario 11); what is pinned here is the selection predicate (as SQL
 * text), the edge-once behaviour and the shape of the ONE UPDATE the sweep
 * issues per lineup.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  TIE_EXPIRY_CRON_EXPRESSION,
  TIE_EXPIRY_JOB_NAME,
  sweepExpiredTieHolds,
} from './tie-expiry.helpers';

type Db = PostgresJsDatabase<typeof schema>;

interface Harness {
  db: Db;
  /** Terminal of the candidate SELECT chain; its argument is the predicate. */
  selectWhere: jest.Mock;
  /** Terminal of the one UPDATE chain per lineup (archive + stamp). */
  updateReturning: jest.Mock;
  /** Every payload handed to `.set()`, in call order. */
  setPayloads: Record<string, unknown>[];
  /** Every predicate handed to an UPDATE's `.where()`, in call order. */
  updateWheres: unknown[];
}

function createHarness(): Harness {
  const selectWhere = jest.fn().mockResolvedValue([]);
  const updateReturning = jest.fn().mockResolvedValue([{ id: 1 }]);
  const setPayloads: Record<string, unknown>[] = [];
  const updateWheres: unknown[] = [];
  const db = {
    select: jest.fn(() => ({ from: () => ({ where: selectWhere }) })),
    update: jest.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        setPayloads.push(payload);
        return {
          where: (predicate: unknown) => {
            updateWheres.push(predicate);
            return { returning: updateReturning };
          },
        };
      },
    })),
  };
  return {
    db: db as unknown as Db,
    selectWhere,
    updateReturning,
    setPayloads,
    updateWheres,
  };
}

/** Parameterised SQL text of a drizzle condition, e.g. `"status" = $1`. */
function whereText(predicate: unknown): string {
  return new PgDialect().sqlToQuery(predicate as never).sql;
}

/** What "an OPEN hold nobody is acting on" has to say in SQL. */
function expectExpiryPredicate(text: string): void {
  expect(text).toContain('"status" = $');
  expect(text).toContain('"tie_detected_at" is not null');
  expect(text).toContain('"tie_expired_at" is null');
  expect(text).toContain('"active_tiebreaker_id" is null');
  expect(text).toContain('"tie_pick_at" is null');
  expect(text).toContain('"tie_expires_at" <= $');
}

const NOW = new Date('2026-09-20T08:00:00.000Z');

describe('sweepExpiredTieHolds (D13)', () => {
  it('returns the ids it expired and archives each one', async () => {
    const h = createHarness();
    h.selectWhere.mockResolvedValue([{ id: 7 }, { id: 9 }]);
    h.updateReturning.mockResolvedValue([{ id: 7 }]);

    const result = await sweepExpiredTieHolds(h.db, NOW);

    expect(result.expired).toEqual([7, 9]);
    const archived = h.setPayloads.filter((p) => p.status === 'archived');
    expect(archived).toHaveLength(2);
  });

  it('never writes a winner — no UPDATE payload mentions decidedGameId', async () => {
    const h = createHarness();
    h.selectWhere.mockResolvedValue([{ id: 7 }]);

    await sweepExpiredTieHolds(h.db, NOW);

    expect(h.setPayloads.length).toBeGreaterThan(0);
    for (const payload of h.setPayloads) {
      expect(Object.keys(payload)).not.toContain('decidedGameId');
    }
  });

  it('archives and stamps tieExpiredAt in ONE statement, with the sweep instant', async () => {
    const h = createHarness();
    h.selectWhere.mockResolvedValue([{ id: 7 }]);

    await sweepExpiredTieHolds(h.db, NOW);

    expect(h.setPayloads).toHaveLength(1);
    expect(h.setPayloads[0]).toMatchObject({
      status: 'archived',
      tieExpiredAt: NOW,
    });
  });

  it('selects only holds still in voting, open, unexpired, and not awaiting a human', async () => {
    const h = createHarness();

    await sweepExpiredTieHolds(h.db, NOW);

    expectExpiryPredicate(whereText(h.selectWhere.mock.calls[0][0]));
  });

  it('guards the archive UPDATE on the same predicate — race-safe, not advisory', async () => {
    const h = createHarness();
    h.selectWhere.mockResolvedValue([{ id: 7 }]);

    await sweepExpiredTieHolds(h.db, NOW);

    const text = whereText(h.updateWheres[0]);
    expect(text).toContain('"id" = $');
    expectExpiryPredicate(text);
  });

  it('is a no-op on a second pass — a hold whose archive edge is lost is skipped', async () => {
    const h = createHarness();
    h.selectWhere.mockResolvedValue([{ id: 7 }]);
    // The UPDATE is guarded on the full predicate: a concurrent sweep that
    // already archived the row, or a grace advance that moved it to
    // `decided` after the scan, leaves zero rows to return here.
    h.updateReturning.mockResolvedValue([]);
    const logExpiry = jest.fn().mockResolvedValue(undefined);

    const result = await sweepExpiredTieHolds(h.db, NOW, { logExpiry });

    expect(result.expired).toEqual([]);
    expect(logExpiry).not.toHaveBeenCalled();
  });

  it('keeps sweeping when one lineup s archive throws, and reports it', async () => {
    const h = createHarness();
    h.selectWhere.mockResolvedValue([{ id: 7 }, { id: 9 }]);
    h.updateReturning
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue([{ id: 9 }]);
    const logger = { warn: jest.fn() };

    const result = await sweepExpiredTieHolds(h.db, NOW, { logger });

    expect(result.expired).toEqual([9]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('lineup 7');
  });

  it('logs one expiry activity entry per lineup that actually expired', async () => {
    const h = createHarness();
    h.selectWhere.mockResolvedValue([{ id: 7 }, { id: 9 }]);
    const logExpiry = jest.fn().mockResolvedValue(undefined);

    await sweepExpiredTieHolds(h.db, NOW, { logExpiry });

    expect(logExpiry.mock.calls.map((c) => c[0])).toEqual([7, 9]);
  });

  it('keeps sweeping when one lineup s activity log throws', async () => {
    const h = createHarness();
    h.selectWhere.mockResolvedValue([{ id: 7 }, { id: 9 }]);
    const logExpiry = jest
      .fn()
      .mockRejectedValueOnce(new Error('activity log down'))
      .mockResolvedValue(undefined);

    const result = await sweepExpiredTieHolds(h.db, NOW, { logExpiry });

    expect(result.expired).toEqual([7, 9]);
  });

  it('does nothing at all when no hold has reached its expiry', async () => {
    const h = createHarness();

    const result = await sweepExpiredTieHolds(h.db, NOW);

    expect(result.expired).toEqual([]);
    expect(h.setPayloads).toEqual([]);
  });
});

describe('the sweep s cron identity', () => {
  it('is a daily job named for the class and method that own it', () => {
    expect(TIE_EXPIRY_JOB_NAME).toBe('TieExpiryService_expireTieHolds');
    // 6-field expression, daily: seconds minutes hour * * *
    expect(TIE_EXPIRY_CRON_EXPRESSION).toMatch(/^\d+ \d+ \d+ \* \* \*$/);
  });
});
