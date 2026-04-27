/**
 * Unit tests for quorum predicates (ROK-1118).
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';

jest.mock('./quorum-voters.helpers', () => ({
  loadExpectedVoters: jest.fn(),
}));

import { loadExpectedVoters } from './quorum-voters.helpers';
import {
  checkBuildingQuorum,
  checkVotingQuorum,
} from './quorum-check.helpers';
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

function makeNominationRows(userIds: number[]) {
  return userIds.map((userId) => ({ userId }));
}

function makeEntryIdRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
}

interface QuorumTestSettings {
  get: jest.Mock;
}

function makeSettings(value: string | null = null): QuorumTestSettings {
  return { get: jest.fn().mockResolvedValue(value) };
}

describe('checkBuildingQuorum', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports not ready when there are no expected voters', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([]);
    db.where.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

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
    db.where
      .mockResolvedValueOnce(makeNominationRows([1, 2, 3]))
      .mockResolvedValueOnce(makeEntryIdRows(3));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('missing');
  });

  it('reports not ready when nominators are covered but floor not met', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.where
      .mockResolvedValueOnce(makeNominationRows([1, 2]))
      .mockResolvedValueOnce(makeEntryIdRows(2));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('floor');
  });

  it('reports ready when nominators are covered and floor is just met', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3, 4]);
    db.where
      .mockResolvedValueOnce(makeNominationRows([1, 2, 3, 4]))
      .mockResolvedValueOnce(makeEntryIdRows(4));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(true);
  });

  it('reports ready beyond the floor', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3, 4]);
    db.where
      .mockResolvedValueOnce(makeNominationRows([1, 2, 3, 4]))
      .mockResolvedValueOnce(makeEntryIdRows(7));

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
    db.where
      .mockResolvedValueOnce(makeNominationRows([1, 2]))
      .mockResolvedValueOnce(makeEntryIdRows(2));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings('2') as never,
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
    db.where.mockResolvedValueOnce([]);

    const result = await checkVotingQuorum(
      db as never,
      { ...baseLineup, status: 'voting' },
    );

    expect(result.ready).toBe(false);
  });

  it('reports not ready with partial participation', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    db.where.mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]);

    const result = await checkVotingQuorum(
      db as never,
      { ...baseLineup, status: 'voting' },
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('missing');
  });

  it('reports ready when every expected voter has voted', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    db.where.mockResolvedValueOnce([
      { userId: 1 },
      { userId: 2 },
      { userId: 3 },
    ]);

    const result = await checkVotingQuorum(
      db as never,
      { ...baseLineup, status: 'voting', visibility: 'private' },
    );

    expect(result.ready).toBe(true);
  });

  it('private lineup ignores extra public voters when quorum already met', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.where.mockResolvedValueOnce([
      { userId: 1 },
      { userId: 2 },
      { userId: 99 },
    ]);

    const result = await checkVotingQuorum(
      db as never,
      { ...baseLineup, status: 'voting', visibility: 'private' },
    );

    expect(result.ready).toBe(true);
  });
});
