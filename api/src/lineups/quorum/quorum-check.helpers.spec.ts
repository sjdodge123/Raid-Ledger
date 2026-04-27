/**
 * Unit tests for quorum predicates (ROK-1118).
 *
 * Both predicates require participants to use their full allotment:
 *   - building → voting: each voter has nominated ≥ minPerVoter games AND
 *     total distinct nominations ≥ floor.
 *   - voting → decided: each voter has cast `lineup.maxVotesPerPlayer` votes.
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';

jest.mock('./quorum-voters.helpers', () => ({
  loadExpectedVoters: jest.fn(),
}));

import { loadExpectedVoters } from './quorum-voters.helpers';
import { checkBuildingQuorum, checkVotingQuorum } from './quorum-check.helpers';
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';
import type * as schema from '../../drizzle/schema';

type LineupRow = typeof schema.communityLineups.$inferSelect;

const baseLineup: LineupRow = {
  id: 42,
  title: 'Test',
  description: null,
  status: 'building',
  visibility: 'public',
  targetDate: null,
  decidedGameId: null,
  linkedEventId: null,
  createdBy: 1,
  votingDeadline: null,
  phaseDeadline: null,
  phaseDurationOverride: null,
  matchThreshold: 35,
  maxVotesPerPlayer: 3,
  defaultTiebreakerMode: null,
  activeTiebreakerId: null,
  discordCreatedChannelId: null,
  discordCreatedMessageId: null,
  channelOverrideId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as LineupRow;

function setExpectedVoters(ids: number[]): void {
  (loadExpectedVoters as jest.Mock).mockResolvedValue(ids);
}

function nominationsPerVoter(rows: Array<{ userId: number; count: number }>) {
  return rows;
}

function totalRow(count: number) {
  return [{ total: count }];
}

interface QuorumTestSettings {
  get: jest.Mock;
}

/**
 * Settings mock that returns different values per key. Building reads:
 *   1. LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS (floor)
 *   2. LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS_PER_VOTER (per-voter min)
 */
function makeSettings(
  overrides: Record<string, string> = {},
): QuorumTestSettings {
  return {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(overrides[key] ?? null),
      ),
  };
}

describe('checkBuildingQuorum', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports not ready when there are no expected voters', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([]);
    db.groupBy.mockResolvedValueOnce(nominationsPerVoter([]));
    db.execute.mockResolvedValueOnce(totalRow(0));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('no expected voters');
  });

  it('reports not ready when an expected nominator has not nominated', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3, 4]);
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 3 },
        { userId: 2, count: 3 },
        { userId: 3, count: 3 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(9));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/below 3 nominations/);
  });

  it('reports not ready when nominators have only 1 of 3 nominations each', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3, 4]);
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 1 },
        { userId: 2, count: 1 },
        { userId: 3, count: 1 },
        { userId: 4, count: 1 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(4));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/below 3 nominations/);
  });

  it('reports not ready when per-voter is met but total floor not met', async () => {
    const db = createDrizzleMock();
    // Two voters × 1 nomination each = 2 (below default floor of 4) but each
    // hits a custom per-voter min of 1.
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 1 },
        { userId: 2, count: 1 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(2));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings({
        [SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS_PER_VOTER]: '1',
      }) as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('floor');
  });

  it('reports ready when each voter hits the per-voter min and the floor is met', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 3 },
        { userId: 2, count: 3 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(6));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(true);
  });

  it('honors a custom floor from settings', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 3 },
        { userId: 2, count: 3 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(6));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings({
        [SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS]: '2',
      }) as never,
      baseLineup,
    );

    expect(result.ready).toBe(true);
  });

  it('honors a custom per-voter min from settings', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 1 },
        { userId: 2, count: 1 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(2));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings({
        [SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS]: '2',
        [SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS_PER_VOTER]: '1',
      }) as never,
      baseLineup,
    );

    expect(result.ready).toBe(true);
  });
});

describe('checkVotingQuorum', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports not ready when no expected voters', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([]);
    db.groupBy.mockResolvedValueOnce([]);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
    });

    expect(result.ready).toBe(false);
  });

  it('reports not ready when each voter has cast 1 of 3 votes', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    db.groupBy.mockResolvedValueOnce([
      { userId: 1, count: 1 },
      { userId: 2, count: 1 },
      { userId: 3, count: 1 },
    ]);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/below 3 votes/);
  });

  it('reports not ready when one voter is one vote short', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    db.groupBy.mockResolvedValueOnce([
      { userId: 1, count: 3 },
      { userId: 2, count: 3 },
      { userId: 3, count: 2 },
    ]);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/below 3 votes/);
  });

  it('reports ready when every voter has used their full allotment', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    db.groupBy.mockResolvedValueOnce([
      { userId: 1, count: 3 },
      { userId: 2, count: 3 },
      { userId: 3, count: 3 },
    ]);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
    });

    expect(result.ready).toBe(true);
  });

  it('private lineup ignores extra public voters when quorum already met', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce([
      { userId: 1, count: 3 },
      { userId: 2, count: 3 },
      { userId: 99, count: 1 },
    ]);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
    });

    expect(result.ready).toBe(true);
  });

  it('honors a custom maxVotesPerPlayer on the lineup', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce([
      { userId: 1, count: 5 },
      { userId: 2, count: 5 },
    ]);

    const result = await checkVotingQuorum(
      db as never,
      {
        ...baseLineup,
        status: 'voting',
        maxVotesPerPlayer: 5,
      } as LineupRow,
    );

    expect(result.ready).toBe(true);
  });
});
