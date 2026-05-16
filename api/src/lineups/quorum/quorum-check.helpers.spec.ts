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
  loadQuorumGatingVoters: jest.fn(),
}));

import { loadQuorumGatingVoters } from './quorum-voters.helpers';
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
  (loadQuorumGatingVoters as jest.Mock).mockResolvedValue(ids);
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

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
  });

  it('reports not ready for a solo lineup (1 expected voter)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1]);

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
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
    expect(result.reason).toContain('solo lineup');
  });

  it('reports not ready for a solo lineup (1 expected voter)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1]);
    db.groupBy.mockResolvedValueOnce([{ userId: 1, count: 3 }]);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
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

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      maxVotesPerPlayer: 5,
    });

    expect(result.ready).toBe(true);
  });

  // ROK-1258 hybrid policy: checkVotingQuorum consumes whatever
  // loadQuorumGatingVoters returns. These tests pin the contract by
  // simulating the pre-/post-drop gating set the new helper produces.
  it('advances once post-deadline drop narrows the gating set to actual voters', async () => {
    const db = createDrizzleMock();
    // 5-invitee private; after deadline drops 2 non-voters, gating set =
    // creator + 2 voters who already cast 3.
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

  it('still blocks when the only voter is the creator (creator never dropped)', async () => {
    const db = createDrizzleMock();
    // Solo-creator gating set after every non-voter dropped post-deadline.
    setExpectedVoters([1]);
    db.groupBy.mockResolvedValueOnce([]);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
  });
});

// ROK-1258: dedicated coverage for the hybrid voter-participation policy.
// quorum-check is mocked above, so here we exercise the real helper against
// a small handwritten drizzle stub keyed on the (in order) queries it makes:
//   1. invitees lookup
//   2. participants lookup (votes during voting, entries during building)
describe('loadQuorumGatingVoters (ROK-1258 hybrid policy)', () => {
  // Resolve dynamically so the jest.mock above (used by the
  // quorum-check tests) doesn't suppress the real helper here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actual = jest.requireActual<{
    loadQuorumGatingVoters: (
      db: unknown,
      lineup: unknown,
    ) => Promise<number[]>;
  }>('./quorum-voters.helpers');

  /**
   * Minimal stub: each `.where(...)` resolves to the next queued row set,
   * matching the order helpers run their queries. The helper's
   * loadPrivateExpectedVoters runs the invitee query first; then if the
   * post-deadline branch hits, findDistinctVoters / findDistinctNominators
   * runs the participants query.
   */
  function makeDb(invitees: number[], participants: number[]) {
    const queue: Array<Array<{ userId: number }>> = [
      invitees.map((userId) => ({ userId })),
      participants.map((userId) => ({ userId })),
    ];
    const stub = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation(async () => queue.shift() ?? []),
    };
    return stub;
  }

  const privateBase = {
    ...baseLineup,
    visibility: 'private' as const,
    status: 'voting' as const,
  };

  it('returns the full roster when the phase deadline is still future', async () => {
    const future = new Date(Date.now() + 60_000);
    const db = makeDb([2, 3, 4], []);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      createdBy: 1,
      phaseDeadline: future,
    });

    expect(result.sort()).toEqual([1, 2, 3, 4]);
  });

  it('drops non-voting invitees once the phase deadline has passed', async () => {
    const past = new Date(Date.now() - 60_000);
    // Invited: 2,3,4,5. Only 2 and 3 voted. Creator=1 never dropped.
    const db = makeDb([2, 3, 4, 5], [2, 3]);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      createdBy: 1,
      phaseDeadline: past,
    });

    expect(result.sort()).toEqual([1, 2, 3]);
  });

  it('returns the full roster when the deadline is null (no grace path)', async () => {
    const db = makeDb([2, 3, 4], []);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      createdBy: 1,
      phaseDeadline: null,
      votingDeadline: null,
    });

    expect(result.sort()).toEqual([1, 2, 3, 4]);
  });

  it('keeps the creator after deadline even when they have not voted', async () => {
    const past = new Date(Date.now() - 60_000);
    // Creator=1 has not voted; only invitee 2 voted. 1 still gates.
    const db = makeDb([2, 3], [2]);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      createdBy: 1,
      phaseDeadline: past,
    });

    expect(result.sort()).toEqual([1, 2]);
  });

  it('falls back to votingDeadline when phaseDeadline is null but votingDeadline is set', async () => {
    const past = new Date(Date.now() - 60_000);
    // Pre-fix legacy path: operator set an explicit votingDeadline only.
    const db = makeDb([2, 3, 4], [2]);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      createdBy: 1,
      phaseDeadline: null,
      votingDeadline: past,
    });

    expect(result.sort()).toEqual([1, 2]);
  });

  it('uses phaseDeadline for the building phase grace window', async () => {
    const past = new Date(Date.now() - 60_000);
    // Building phase: dropped invitees = those without nominations.
    // Invited: 2,3. Only 2 nominated.
    const db = makeDb([2, 3], [2]);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      status: 'building',
      createdBy: 1,
      phaseDeadline: past,
      votingDeadline: null,
    });

    expect(result.sort()).toEqual([1, 2]);
  });
});
