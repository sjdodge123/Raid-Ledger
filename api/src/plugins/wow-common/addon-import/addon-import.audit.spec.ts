/**
 * AddonImportAuditService (ROK-1724, Codex P2): the per-user hourly limit is
 * checked and the attempt reserved atomically — one advisory-locked tx —
 * so parallel requests can't all pass a count taken before any is recorded.
 * The real race is proven in `addon-import.integration.spec.ts`.
 */
import { SQL, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import {
  ADDON_IMPORT_APPLY_LIMIT,
  ADDON_IMPORT_PENDING,
  ADDON_IMPORT_PREVIEW_LIMIT,
  AddonImportAuditService,
  isOverLimit,
} from './addon-import.audit';
import { AddonImportError } from './addon-import.errors';

const ROW = { userId: 7, sizeBytes: 10, dryRun: false, result: 'x' };

function makeDb(used: number) {
  const calls: string[] = [];
  const values = jest.fn().mockReturnValue({
    returning: jest.fn().mockResolvedValue([{ id: 41 }]),
  });
  const tx = {
    execute: jest.fn((q: ReturnType<typeof sql>) => {
      calls.push(new PgDialect().sqlToQuery(q).sql);
      return Promise.resolve([]);
    }),
    select: () => ({
      from: () => ({
        where: () => {
          calls.push('count');
          return Promise.resolve([{ n: used }]);
        },
      }),
    }),
    insert: () => {
      calls.push('insert');
      return { values };
    },
  };
  const where = jest.fn().mockResolvedValue(undefined);
  const db = {
    transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    insert: jest.fn().mockReturnValue({ values: jest.fn() }),
    update: jest.fn().mockReturnValue({ set: () => ({ where }) }),
  };
  const service = new AddonImportAuditService(
    db as unknown as PostgresJsDatabase<typeof schema>,
  );
  return { service, db, calls, values, where };
}

const prevThrottle = process.env.THROTTLE_DISABLED;
beforeEach(() => {
  process.env.THROTTLE_DISABLED = 'false';
});
afterAll(() => {
  process.env.THROTTLE_DISABLED = prevThrottle;
});

describe('isOverLimit', () => {
  it.each([
    [ADDON_IMPORT_APPLY_LIMIT - 1, false, false],
    [ADDON_IMPORT_APPLY_LIMIT, false, true],
    [ADDON_IMPORT_PREVIEW_LIMIT - 1, true, false],
    [ADDON_IMPORT_PREVIEW_LIMIT, true, true],
  ])('%i used, dryRun=%s → over=%s', (used, dryRun, over) => {
    expect(isOverLimit(used, dryRun)).toBe(over);
  });
});

describe('reserveAttempt', () => {
  it('locks per (user, kind), THEN counts, THEN reserves a PENDING row — one tx', async () => {
    const { service, db, calls, values } = makeDb(ADDON_IMPORT_APPLY_LIMIT - 1);
    await expect(service.reserveAttempt(ROW)).resolves.toBe(41);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      expect.stringContaining('pg_advisory_xact_lock'),
      'count',
      'insert',
    ]);
    // ROK-1737: stamped with clock_timestamp() under the lock, so each
    // reservation's instant is unique (mixed-paste rows copy it).
    expect(values).toHaveBeenCalledWith({
      ...ROW,
      result: ADDON_IMPORT_PENDING,
      createdAt: expect.any(SQL),
    });
  });

  it('at the cap → RATE_LIMITED and nothing reserved', async () => {
    const { service, calls } = makeDb(ADDON_IMPORT_APPLY_LIMIT);
    const err: unknown = await service.reserveAttempt(ROW).catch((e) => e);
    expect(err).toBeInstanceOf(AddonImportError);
    expect((err as AddonImportError).code).toBe('RATE_LIMITED');
    expect(calls).not.toContain('insert');
  });

  it('THROTTLE_DISABLED skips the lock + count but still reserves', async () => {
    process.env.THROTTLE_DISABLED = 'true';
    const { service, calls } = makeDb(ADDON_IMPORT_APPLY_LIMIT);
    await expect(service.reserveAttempt(ROW)).resolves.toBe(41);
    expect(calls).toEqual(['insert']);
  });
});

describe('recordAttempt', () => {
  it('finalises the reserved row instead of inserting a second one', async () => {
    const { service, db, where } = makeDb(0);
    await service.recordAttempt({ ...ROW, result: 'applied' }, 41);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('a reject before the reservation inserts its row', async () => {
    const { service, db } = makeDb(0);
    await service.recordAttempt({ ...ROW, result: 'TOO_LARGE' }, null);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
  });
});
