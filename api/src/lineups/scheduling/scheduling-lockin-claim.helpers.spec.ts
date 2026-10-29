/**
 * ROK-2024 follow-up F2 — the lock-in claim refuses a match that is already
 * locked in BEFORE the caller creates an event, commits before the create
 * (no pooled connection held across it), and cleans up every instance a lost
 * lock-in made.
 */
import { ConflictException } from '@nestjs/common';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import type { MockDb } from '../../common/testing/drizzle-mock';
import { claimMatchForLockIn } from './scheduling-lockin-claim.helpers';
import { createLockedInEvent } from './scheduling-event.helpers';
import type { LockInEventDeps } from './scheduling-event.helpers';
import { findScheduleVotes } from './scheduling-query.helpers';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';

jest.mock('./scheduling-query.helpers');
jest.mock('./scheduling-auto-signup.helpers');
jest.mock('./scheduling-auto-heart.helpers');
jest.mock('../lineups-notify-hooks.helpers');

type Db = PostgresJsDatabase<typeof schema>;

const POOL_HELD = 'DB_POOL_MAX=1: create needs the connection a claim tx holds';

/** A mock db that, like a one-connection pool, tracks an open transaction. */
function singleConnectionDb(claimRows: unknown[], linkRows: unknown[]) {
  const db = createDrizzleMock();
  const pool = { held: false };
  db.transaction.mockImplementation(
    async (cb: (tx: MockDb) => Promise<unknown>) => {
      pool.held = true;
      try {
        return await cb(db);
      } finally {
        pool.held = false;
      }
    },
  );
  db.limit.mockResolvedValue([]);
  db.for.mockResolvedValue(claimRows);
  db.returning.mockResolvedValue(linkRows);
  return { db, pool };
}

function buildDeps(
  db: MockDb,
  pool: { held: boolean },
  created: { id: number; allEventIds?: number[] } = { id: 55 },
) {
  const create = jest
    .fn()
    .mockImplementation(() =>
      pool.held
        ? Promise.reject(new Error(POOL_HELD))
        : Promise.resolve(created),
    );
  const deps: LockInEventDeps = {
    db: db as unknown as Db,
    eventsService: { create, delete: jest.fn().mockResolvedValue(undefined) },
    signupsService: { signup: jest.fn() },
    lineupNotifications: {} as LockInEventDeps['lineupNotifications'],
    pollEmbed: { fireUpdateEmbed: jest.fn() },
    logger: {
      log: jest.fn(),
      error: jest.fn(),
    } as unknown as LockInEventDeps['logger'],
  };
  return deps;
}

const lockIn = (deps: LockInEventDeps, recurring = false) =>
  createLockedInEvent(
    deps,
    { id: 3, gameId: 7 },
    { id: 1, proposedTime: new Date('2026-10-01T20:00:00.000Z') },
    10,
    recurring,
  );

beforeEach(() => {
  jest.clearAllMocks();
  (findScheduleVotes as jest.Mock).mockResolvedValue([]);
});

describe('claimMatchForLockIn (ROK-2024 F2)', () => {
  it('409s and writes nothing when the match is already claimed', async () => {
    const { db } = singleConnectionDb([], []);
    await expect(
      claimMatchForLockIn(db as unknown as Db, 3),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('locks the row, marks it scheduled, stamps the claim and returns its token (ROK-2033)', async () => {
    const { db } = singleConnectionDb([{ status: 'suggested' }], []);
    const claim = await claimMatchForLockIn(db as unknown as Db, 3);
    expect(claim.prior).toBe('suggested');
    expect(claim.claimedAt).toBeInstanceOf(Date);
    expect(db.for).toHaveBeenCalledWith('update');
    expect(db.set).toHaveBeenCalledWith({
      status: 'scheduled',
      lockInClaimedAt: claim.claimedAt,
    });
  });

  it('does not stamp a reschedule claim (already linked, ROK-2040)', async () => {
    const { db } = singleConnectionDb([{ status: 'scheduling' }], []);
    const claim = await claimMatchForLockIn(
      db as unknown as Db,
      3,
      ['scheduling'],
      77,
    );
    expect(claim).toEqual({ prior: 'scheduling', claimedAt: null });
    expect(db.set).toHaveBeenCalledWith({
      status: 'scheduled',
      lockInClaimedAt: null,
    });
  });
});

describe('createLockedInEvent — claim, create, link (ROK-2024 F2)', () => {
  it('commits the claim before create, so a one-connection pool never hangs (Codex P1)', async () => {
    const { db, pool } = singleConnectionDb([{ status: 'scheduling' }], [{}]);
    const deps = buildDeps(db, pool);
    await expect(lockIn(deps)).resolves.toBe(55);
    expect(deps.eventsService.delete).not.toHaveBeenCalled();
  });

  it('deletes EVERY recurring instance when the link is lost', async () => {
    const { db, pool } = singleConnectionDb([{ status: 'scheduling' }], []);
    const deps = buildDeps(db, pool, { id: 55, allEventIds: [55, 56, 57] });
    await expect(lockIn(deps, true)).rejects.toBeInstanceOf(ConflictException);
    const del = deps.eventsService.delete as jest.Mock;
    expect(del.mock.calls).toEqual([
      [55, 10, false],
      [56, 10, false],
      [57, 10, false],
    ]);
  });

  it('still 409s (not 500) when a cleanup delete throws', async () => {
    const { db, pool } = singleConnectionDb([{ status: 'scheduling' }], []);
    const deps = buildDeps(db, pool, { id: 55, allEventIds: [55, 56] });
    (deps.eventsService.delete as jest.Mock).mockRejectedValueOnce(
      new Error('discord down'),
    );
    await expect(lockIn(deps, true)).rejects.toBeInstanceOf(ConflictException);
    expect(deps.eventsService.delete).toHaveBeenCalledTimes(2);
    expect(deps.logger.error).toHaveBeenCalledTimes(1);
  });

  it('releases the claim back to its prior status when create throws', async () => {
    const { db, pool } = singleConnectionDb([{ status: 'scheduling' }], []);
    const deps = buildDeps(db, pool);
    (deps.eventsService.create as jest.Mock).mockRejectedValueOnce(
      new Error('insert failed'),
    );
    await expect(lockIn(deps)).rejects.toThrow('insert failed');
    expect(db.set).toHaveBeenLastCalledWith({
      status: 'scheduling',
      lockInClaimedAt: null,
    });
    expect(deps.eventsService.delete).not.toHaveBeenCalled();
  });

  it('discards every instance and releases the claim when the link write throws', async () => {
    const { db, pool } = singleConnectionDb([{ status: 'scheduling' }], []);
    db.returning.mockRejectedValueOnce(new Error('link failed'));
    const deps = buildDeps(db, pool, { id: 55, allEventIds: [55, 56] });
    await expect(lockIn(deps, true)).rejects.toThrow('link failed');
    expect((deps.eventsService.delete as jest.Mock).mock.calls).toEqual([
      [55, 10, false],
      [56, 10, false],
    ]);
    expect(db.set).toHaveBeenLastCalledWith({
      status: 'scheduling',
      lockInClaimedAt: null,
    });
  });
});
