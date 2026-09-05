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
 * (scenario 11); what is pinned here is the selection predicate, the
 * edge-once behaviour and the shape of every UPDATE the sweep issues.
 */
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
  /** Terminal of the candidate SELECT chain. */
  selectWhere: jest.Mock;
  /** Terminal of every UPDATE chain (expire stamp, then archive). */
  updateReturning: jest.Mock;
  /** Every payload handed to `.set()`, in call order. */
  setPayloads: Record<string, unknown>[];
}

function createHarness(): Harness {
  const selectWhere = jest.fn().mockResolvedValue([]);
  const updateReturning = jest.fn().mockResolvedValue([{ id: 1 }]);
  const setPayloads: Record<string, unknown>[] = [];
  const db = {
    select: jest.fn(() => ({ from: () => ({ where: selectWhere }) })),
    update: jest.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        setPayloads.push(payload);
        return { where: () => ({ returning: updateReturning }) };
      },
    })),
  };
  return { db: db as unknown as Db, selectWhere, updateReturning, setPayloads };
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

  it('stamps tieExpiredAt with the sweep instant before archiving', async () => {
    const h = createHarness();
    h.selectWhere.mockResolvedValue([{ id: 7 }]);

    await sweepExpiredTieHolds(h.db, NOW);

    expect(h.setPayloads[0]).toMatchObject({ tieExpiredAt: NOW });
    expect(h.setPayloads[1]).toMatchObject({ status: 'archived' });
  });

  it('is a no-op on a second pass — a hold whose expire edge is lost is skipped', async () => {
    const h = createHarness();
    h.selectWhere.mockResolvedValue([{ id: 7 }]);
    // `expireTieHold` is guarded on `tie_expired_at IS NULL`: a concurrent
    // sweep that already stamped the row returns zero rows here.
    h.updateReturning.mockResolvedValue([]);

    const result = await sweepExpiredTieHolds(h.db, NOW);

    expect(result.expired).toEqual([]);
    expect(h.setPayloads.some((p) => p.status === 'archived')).toBe(false);
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
