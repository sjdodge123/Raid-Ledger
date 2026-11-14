/**
 * Backlog 2026-10-02 — `createActiveTiebreaker` re-checks "one tiebreaker at
 * a time" under a row lock. `TiebreakerService.start` reads the lineup OUTSIDE
 * its transaction, so two concurrent starts could both pass that read and both
 * commit an `active` row. The concurrent proof is the integration spec
 * `tiebreaker-start-race.integration.spec.ts`; this pins the locked re-read.
 */
import { BadRequestException } from '@nestjs/common';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { createActiveTiebreaker } from './tiebreaker-lifecycle.helpers';

const TIES = { tiedGameIds: [11, 12], voteCount: 3 };
const VETO = { mode: 'veto' as const };

function lineupRow(activeTiebreakerId: number | null) {
  return { id: 7, status: 'voting', activeTiebreakerId };
}

describe('createActiveTiebreaker — locked re-check', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('rejects with the "already active" 400 when the LOCKED row has one, inserting nothing', async () => {
    db.for.mockResolvedValueOnce([lineupRow(99)]);

    const run = createActiveTiebreaker(db as never, 7, VETO, TIES);

    await expect(run).rejects.toThrow(
      new BadRequestException('A tiebreaker is already active'),
    );
    expect(db.for).toHaveBeenCalledWith('update');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('locks the lineup row before inserting when none is active', async () => {
    db.for.mockResolvedValueOnce([lineupRow(null)]);
    db.returning.mockResolvedValueOnce([{ id: 5, lineupId: 7 }]);

    const row = await createActiveTiebreaker(db as never, 7, VETO, TIES);

    expect(row).toEqual({ id: 5, lineupId: 7 });
    expect(db.for).toHaveBeenCalledWith('update');
    const lockOrder = db.for.mock.invocationCallOrder[0] ?? Infinity;
    const insertOrder = db.insert.mock.invocationCallOrder[0] ?? -1;
    expect(lockOrder).toBeLessThan(insertOrder);
  });
});
