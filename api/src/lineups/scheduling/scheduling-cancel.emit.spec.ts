/**
 * ROK-2272 S6: `archiveAndNotifyCancel` emits `POLL_CANCELLED` exactly once,
 * for the request whose conditional archive UPDATE actually flipped the row —
 * a concurrent loser (no row returned) and a failed UPDATE emit nothing.
 */
import { Logger } from '@nestjs/common';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { LINEUP_MATCH_EVENTS } from '../lineups-scheduling-hook.helpers';
import { archiveAndNotifyCancel } from './scheduling-cancel.helpers';

jest.mock('../lineups-match-query.helpers', () => ({
  ...jest.requireActual('../lineups-match-query.helpers'),
  findMatchMembers: jest.fn().mockResolvedValue([]),
}));

const MATCH = { id: 10, lineupId: 3, gameId: 5 };

function build(): {
  db: MockDb;
  emit: jest.Mock;
  run: (reason: string | null) => Promise<void>;
} {
  const db = createDrizzleMock();
  const emit = jest.fn();
  const deps = {
    db: db as never,
    notifications: { createMany: jest.fn() } as never,
    logger: new Logger('spec'),
  };
  const run = (reason: string | null): Promise<void> =>
    archiveAndNotifyCancel(deps, MATCH, 1, reason, { emit } as never);
  return { db, emit, run };
}

describe('archiveAndNotifyCancel — POLL_CANCELLED emit (ROK-2272 S6)', () => {
  it('emits once with matchId, lineupId and reason for the CAS winner', async () => {
    const { db, emit, run } = build();
    db.returning.mockResolvedValueOnce([{ id: 10 }]);
    await run('rain');
    expect(emit.mock.calls).toEqual([
      [
        LINEUP_MATCH_EVENTS.POLL_CANCELLED,
        { matchId: 10, lineupId: 3, reason: 'rain' },
      ],
    ]);
    expect(db.returning.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? -Infinity,
    );
  });

  it('carries a null reason through', async () => {
    const { db, emit, run } = build();
    db.returning.mockResolvedValueOnce([{ id: 10 }]);
    await run(null);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(LINEUP_MATCH_EVENTS.POLL_CANCELLED, {
      matchId: 10,
      lineupId: 3,
      reason: null,
    });
  });

  it('emits nothing for the loser of a concurrent cancel', async () => {
    const { db, emit, run } = build();
    db.returning.mockResolvedValueOnce([]);
    await run('rain');
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits nothing when the archive UPDATE throws', async () => {
    const { db, emit, run } = build();
    db.returning.mockRejectedValueOnce(new Error('db down'));
    await expect(run('rain')).rejects.toThrow('db down');
    expect(emit).not.toHaveBeenCalled();
  });
});
