/**
 * TDB:460 — `checkBuildingQuorum` fetches its inputs lazily.
 *
 * The nomination floor and total feed the ROK-1444 count target, so they stay
 * eager. The gating-voter roster fed only the ≥2-voter guard and the
 * submission branch, both retired by TDB:449, so the building path must never
 * load it — whether or not the count target fires.
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';

jest.mock('./quorum-voters.helpers', () => ({
  loadQuorumGatingVoters: jest.fn(),
}));
jest.mock('./nomination-target.helpers', () => ({
  evaluateNominationTarget: jest.fn(),
}));

import { loadQuorumGatingVoters } from './quorum-voters.helpers';
import { evaluateNominationTarget } from './nomination-target.helpers';
import { checkBuildingQuorum } from './quorum-check.helpers';
import type * as schema from '../../drizzle/schema';

type LineupRow = typeof schema.communityLineups.$inferSelect;

const targetLineup = {
  id: 7,
  status: 'building',
  nominationTargetPct: 50,
} as unknown as LineupRow;

const settings = { get: jest.fn().mockResolvedValue(null) };

describe('checkBuildingQuorum — lazy inputs (TDB:460)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not load the gating voters when the count target already fired', async () => {
    const db = createDrizzleMock();
    db.execute.mockResolvedValueOnce([{ total: 12 }]);
    (evaluateNominationTarget as jest.Mock).mockResolvedValue({ ready: true });
    (loadQuorumGatingVoters as jest.Mock).mockResolvedValue([1, 2]);

    const result = await checkBuildingQuorum(
      db as never,
      settings as never,
      targetLineup,
    );

    expect(result).toEqual({ ready: true });
    expect(evaluateNominationTarget).toHaveBeenCalledWith(
      db,
      targetLineup,
      12,
      4,
    );
    expect(loadQuorumGatingVoters).not.toHaveBeenCalled();
  });

  it('never loads the gating voters when the count target has not fired (TDB:449)', async () => {
    const db = createDrizzleMock();
    db.execute.mockResolvedValueOnce([{ total: 12 }]);
    (evaluateNominationTarget as jest.Mock).mockResolvedValue({
      ready: false,
    });
    (loadQuorumGatingVoters as jest.Mock).mockResolvedValue([1]);

    const result = await checkBuildingQuorum(
      db as never,
      settings as never,
      targetLineup,
    );

    expect(loadQuorumGatingVoters).not.toHaveBeenCalled();
    expect(result).toEqual({
      ready: false,
      reason: 'nomination target not met; deadline or manual advance required',
    });
  });
});
