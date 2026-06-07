/**
 * Unit tests for runCommonGroundForBuildingLineup orchestration (ROK-1348).
 *
 * Covers:
 *   - Public lineups query findLineupVoterIds exactly ONCE (it was called
 *     twice before: in buildScoringContext AND resolveParticipantCount).
 *   - participantCount uses creator + invitees for private lineups (the
 *     voter-id query is irrelevant to the private people-denominator).
 */
import { runCommonGroundForBuildingLineup } from './common-ground-context.helpers';
import * as queryHelpers from './lineups-query.helpers';
import * as eligibilityHelpers from './lineups-eligibility.helpers';
import * as cgQueryHelpers from './common-ground-query.helpers';

jest.mock('./lineups-query.helpers');
jest.mock('./lineups-eligibility.helpers');
jest.mock('./common-ground-query.helpers');

const mocked = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as jest.Mock;

function setupCommonMocks(visibility: 'public' | 'private') {
  mocked(queryHelpers.findLineupById).mockResolvedValue([
    { id: 7, status: 'building', visibility },
  ]);
  mocked(queryHelpers.findNominatedGameIds).mockResolvedValue([]);
  mocked(queryHelpers.countDistinctNominators).mockResolvedValue([
    { count: 0 },
  ]);
  mocked(queryHelpers.findLineupVoterIds).mockResolvedValue([1, 2, 3]);
  mocked(eligibilityHelpers.loadInvitees).mockResolvedValue([20, 21]);
  mocked(cgQueryHelpers.buildCommonGroundResponse).mockImplementation(
    (_db, _id, _nominated, _nominators, participantCount: number) =>
      Promise.resolve({ data: [], meta: { participantCount } }) as never,
  );
}

const tasteProfile = {
  getTasteVectorsForUsers: jest.fn().mockResolvedValue(new Map()),
} as never;
const settings = {
  getCommonGroundWeights: jest.fn().mockResolvedValue({}),
} as never;

describe('runCommonGroundForBuildingLineup (ROK-1348)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queries findLineupVoterIds exactly once for a public lineup', async () => {
    setupCommonMocks('public');
    await runCommonGroundForBuildingLineup(
      {} as never,
      { lineupId: 7 } as never,
      tasteProfile,
      settings,
    );
    expect(queryHelpers.findLineupVoterIds).toHaveBeenCalledTimes(1);
  });

  it('uses voter ids as the public participant count', async () => {
    setupCommonMocks('public');
    const res = await runCommonGroundForBuildingLineup(
      {} as never,
      { lineupId: 7 } as never,
      tasteProfile,
      settings,
    );
    // 3 voters → participantCount 3.
    expect(
      (res as { meta: { participantCount: number } }).meta.participantCount,
    ).toBe(3);
    expect(eligibilityHelpers.loadInvitees).not.toHaveBeenCalled();
  });

  it('uses creator + invitees for a private participant count', async () => {
    setupCommonMocks('private');
    const res = await runCommonGroundForBuildingLineup(
      {} as never,
      { lineupId: 7 } as never,
      tasteProfile,
      settings,
    );
    // 2 invitees + creator → participantCount 3.
    expect(
      (res as { meta: { participantCount: number } }).meta.participantCount,
    ).toBe(3);
    expect(eligibilityHelpers.loadInvitees).toHaveBeenCalledTimes(1);
  });
});
