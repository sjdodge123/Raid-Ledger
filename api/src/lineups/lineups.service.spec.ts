import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { LineupsService } from './lineups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SettingsService } from '../settings/settings.service';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LineupSteamNudgeService } from './lineup-steam-nudge.service';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import { LineupNotificationService } from './lineup-notification.service';

// Mock the matching algorithm to avoid extra DB queries in unit tests
jest.mock('./lineups-matching.helpers', () => ({
  buildMatchesForLineup: jest.fn().mockResolvedValue(undefined),
}));

// Mock auto-carryover to avoid extra DB queries in unit tests (ROK-937)
jest.mock('./lineups-carryover.helpers', () => ({
  carryOverFromLastDecided: jest.fn().mockResolvedValue(undefined),
}));

// Mock standalone-poll query helper to avoid DB queries (ROK-1034)
jest.mock('./standalone-poll/standalone-poll-query.helpers', () => ({
  clearLinkedEventsByLineup: jest.fn().mockResolvedValue(undefined),
}));

// Mock notification hooks to avoid extra DB queries (ROK-932)
jest.mock('./lineups-notify-hooks.helpers', () => ({
  fireLineupCreated: jest.fn(),
  fireNominationMilestone: jest.fn(),
  fireVotingOpen: jest.fn(),
  fireDecidedNotifications: jest.fn(),
  fireNominationRemoved: jest.fn(),
  fireSchedulingOpen: jest.fn(),
  fireEventCreated: jest.fn(),
}));

const NOW = new Date('2026-03-22T20:00:00Z');

const mockLineup = {
  id: 1,
  title: 'Test Lineup',
  description: null as string | null,
  status: 'building',
  targetDate: null as Date | null,
  decidedGameId: null as number | null,
  linkedEventId: null as number | null,
  createdBy: 10,
  votingDeadline: null as Date | null,
  matchThreshold: 35,
  createdAt: NOW,
  updatedAt: NOW,
};

const mockUser = { id: 10, displayName: 'TestUser', username: 'TestUser' };

/**
 * Build a thenable object that mimics Drizzle's query builder.
 * Can be awaited directly (resolves to `data`) OR chained further
 * via .limit(), .groupBy(), .orderBy().
 */
function thenable(data: unknown[]) {
  return {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(data).then(resolve, reject),
    limit: jest.fn().mockImplementation(() => thenable(data)),
    groupBy: jest.fn().mockImplementation(() => thenable(data)),
    orderBy: jest.fn().mockImplementation(() => thenable(data)),
  };
}

function makeSelectChain(overrides: {
  whereResult?: unknown[];
  limitResult?: unknown[];
  groupByResult?: unknown[];
}) {
  const defaultData = overrides.whereResult ?? [];
  const limitData = overrides.limitResult ?? defaultData;
  const groupByData = overrides.groupByResult ?? defaultData;

  const where = jest.fn().mockImplementation(() => {
    const t = thenable(defaultData);
    t.limit = jest.fn().mockImplementation(() => thenable(limitData));
    t.groupBy = jest.fn().mockImplementation(() => thenable(groupByData));
    return t;
  });

  const innerJoin2 = jest.fn().mockReturnValue({ where });
  const innerJoin1 = jest
    .fn()
    .mockReturnValue({ where, innerJoin: innerJoin2 });

  const fromResult = {
    then: thenable(defaultData).then,
    where,
    innerJoin: innerJoin1,
    orderBy: jest.fn().mockImplementation(() => thenable(defaultData)),
    limit: jest.fn().mockImplementation(() => thenable(limitData)),
    groupBy: jest.fn().mockImplementation(() => thenable(groupByData)),
  };
  const from = jest.fn().mockReturnValue(fromResult);

  return { from };
}

function describeLineupsService() {
  let service: LineupsService;
  let mockDb: Record<string, jest.Mock>;

  function setupMockDb() {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      execute: jest.fn().mockResolvedValue([{ count: 0 }]),
      transaction: jest
        .fn()
        .mockImplementation((fn: (tx: Record<string, jest.Mock>) => unknown) =>
          fn(mockDb),
        ),
    };
  }

  /** Wire up sequential select() calls with specific return data. */
  function mockSelects(...chains: ReturnType<typeof makeSelectChain>[]) {
    chains.forEach((chain) => {
      mockDb.select.mockReturnValueOnce(chain);
    });
  }

  function mockInsert(returnValue: unknown[]) {
    mockDb.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue(returnValue),
      }),
    });
  }

  function mockUpdate() {
    mockDb.update.mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    });
  }

  /** Set up mocks for buildDetailResponse (9-10 sequential selects). */
  function mockBuildDetail(lineup = mockLineup) {
    const chains = [
      // findLineupById
      makeSelectChain({ limitResult: [lineup] }),
      // findEntriesWithGames
      makeSelectChain({ whereResult: [] }),
      // countVotesPerGame
      makeSelectChain({ groupByResult: [] }),
      // countDistinctVoters
      makeSelectChain({ whereResult: [{ total: 0 }] }),
      // creator query
      makeSelectChain({ limitResult: [mockUser] }),
    ];
    // decidedGameName query (only when decidedGameId is set)
    if (lineup.decidedGameId) {
      chains.push(makeSelectChain({ limitResult: [{ name: 'TestGame' }] }));
    }
    // Enrichment: only countTotalMembers calls DB (others short-circuit on empty gameIds)
    chains.push(makeSelectChain({ whereResult: [{ count: 10 }] }));
    mockSelects(...chains);
  }

  async function createService() {
    setupMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LineupsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: ActivityLogService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SettingsService,
          useValue: { get: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: LineupPhaseQueueService,
          useValue: { scheduleTransition: jest.fn() },
        },
        {
          provide: LineupSteamNudgeService,
          useValue: { nudgeUnlinkedMembers: jest.fn() },
        },
        {
          provide: LineupNotificationService,
          useValue: {
            notifyLineupCreated: jest.fn().mockResolvedValue(undefined),
            notifyNominationMilestone: jest.fn().mockResolvedValue(undefined),
            notifyVotingOpen: jest.fn().mockResolvedValue(undefined),
            notifyMatchesFound: jest.fn().mockResolvedValue(undefined),
            notifySchedulingOpen: jest.fn().mockResolvedValue(undefined),
            notifyNominationRemoved: jest.fn().mockResolvedValue(undefined),
            notifyEventCreated: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: TasteProfileService,
          useValue: {
            getTasteVectorsForUsers: jest.fn().mockResolvedValue(new Map()),
          },
        },
      ],
    }).compile();
    service = module.get<LineupsService>(LineupsService);
  }

  beforeEach(() => createService());

  describe('create', () => {
    it('should create a lineup when none is active', async () => {
      // findActiveLineup → empty (no active)
      mockSelects(makeSelectChain({ limitResult: [] }));
      mockInsert([{ ...mockLineup, id: 1 }]);
      mockBuildDetail();

      const result = await service.create({ title: 'Test Lineup' }, 10);

      expect(result.id).toBe(1);
      expect(result.status).toBe('building');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should throw ConflictException when active lineup exists', async () => {
      mockSelects(makeSelectChain({ limitResult: [{ id: 99 }] }));

      await expect(
        service.create({ title: 'Test Lineup' }, 10),
      ).rejects.toThrow(ConflictException);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should pass targetDate to insert', async () => {
      const targetDate = '2026-04-01T00:00:00Z';
      mockSelects(makeSelectChain({ limitResult: [] }));
      mockInsert([{ ...mockLineup, targetDate: new Date(targetDate) }]);
      mockBuildDetail({ ...mockLineup, targetDate: new Date(targetDate) });

      const result = await service.create(
        { title: 'Test Lineup', targetDate },
        10,
      );

      expect(result.targetDate).toBe(new Date(targetDate).toISOString());
    });
  });

  describe('findActive', () => {
    it('should return the active lineup', async () => {
      // findActive select
      mockSelects(makeSelectChain({ limitResult: [mockLineup] }));
      // buildDetailResponse
      mockBuildDetail();

      const result = await service.findActive();

      expect(result.id).toBe(1);
      expect(result.status).toBe('building');
    });

    it('should return voting lineup as active', async () => {
      const votingLineup = { ...mockLineup, status: 'voting' };
      mockSelects(makeSelectChain({ limitResult: [votingLineup] }));
      mockBuildDetail(votingLineup);

      const result = await service.findActive();

      expect(result.status).toBe('voting');
    });

    it('should throw NotFoundException when no active lineup', async () => {
      mockSelects(makeSelectChain({ limitResult: [] }));

      await expect(service.findActive()).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    it('should return lineup detail', async () => {
      mockBuildDetail();

      const result = await service.findById(1);

      expect(result.id).toBe(1);
      expect(result.entries).toEqual([]);
      expect(result.totalVoters).toBe(0);
      expect(result.createdBy.displayName).toBe('TestUser');
    });

    it('should throw NotFoundException for missing lineup', async () => {
      mockSelects(makeSelectChain({ limitResult: [] }));

      await expect(service.findById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('transitionStatus', () => {
    it('should transition building → voting', async () => {
      // findLineupById for transition check
      mockSelects(makeSelectChain({ limitResult: [mockLineup] }));
      mockUpdate();
      mockBuildDetail({ ...mockLineup, status: 'voting' });

      const result = await service.transitionStatus(1, { status: 'voting' });

      expect(result.status).toBe('voting');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should set votingDeadline on building → voting', async () => {
      const deadline = '2026-04-01T00:00:00Z';
      mockSelects(makeSelectChain({ limitResult: [mockLineup] }));
      mockUpdate();
      mockBuildDetail({
        ...mockLineup,
        status: 'voting',
        votingDeadline: new Date(deadline),
      });

      const result = await service.transitionStatus(1, {
        status: 'voting',
        votingDeadline: deadline,
      });

      expect(result.votingDeadline).toBe(new Date(deadline).toISOString());
    });

    it('should transition voting → decided with decidedGameId', async () => {
      const votingLineup = { ...mockLineup, status: 'voting' };
      // findLineupById
      mockSelects(makeSelectChain({ limitResult: [votingLineup] }));
      // validateDecidedGame — entry with gameId 5
      mockSelects(makeSelectChain({ whereResult: [{ gameId: 5 }] }));
      // Guard skips tiebreaker/tie checks when decidedGameId is provided
      mockUpdate();
      // findGameName for activity log
      mockSelects(makeSelectChain({ limitResult: [{ name: 'TestGame' }] }));
      mockBuildDetail({
        ...votingLineup,
        status: 'decided',
        decidedGameId: 5,
      });

      const result = await service.transitionStatus(1, {
        status: 'decided',
        decidedGameId: 5,
      });

      expect(result.status).toBe('decided');
    });

    it('should transition decided → archived', async () => {
      const decidedLineup = { ...mockLineup, status: 'decided' };
      mockSelects(makeSelectChain({ limitResult: [decidedLineup] }));
      mockUpdate();
      mockBuildDetail({ ...decidedLineup, status: 'archived' });

      const result = await service.transitionStatus(1, { status: 'archived' });

      expect(result.status).toBe('archived');
    });

    it('should throw BadRequestException for invalid transition', async () => {
      // building → decided (skipping voting)
      mockSelects(makeSelectChain({ limitResult: [mockLineup] }));

      await expect(
        service.transitionStatus(1, { status: 'decided', decidedGameId: 5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-adjacent transition', async () => {
      const votingLineup = { ...mockLineup, status: 'voting' };
      mockSelects(makeSelectChain({ limitResult: [votingLineup] }));

      await expect(
        service.transitionStatus(1, { status: 'archived' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for archived → anything', async () => {
      const archivedLineup = { ...mockLineup, status: 'archived' };
      mockSelects(makeSelectChain({ limitResult: [archivedLineup] }));

      await expect(
        service.transitionStatus(1, { status: 'building' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow voting → decided (forward advance)', async () => {
      const votingLineup = { ...mockLineup, status: 'voting' };
      // findLineupById
      mockSelects(makeSelectChain({ limitResult: [votingLineup] }));
      // hasResolved tiebreaker check (ROK-938) → none
      mockSelects(makeSelectChain({ limitResult: [] }));
      // detectTies → countVotesPerGame → no tie
      mockSelects(
        makeSelectChain({ groupByResult: [{ gameId: 5, voteCount: 1 }] }),
      );
      // applyStatusUpdate (update)
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      });
      // buildDetailResponse chain (findLineupById + enrichment queries)
      mockSelects(
        makeSelectChain({
          limitResult: [{ ...votingLineup, status: 'decided' }],
        }),
      );
      mockSelects(makeSelectChain({ whereResult: [] })); // entries
      mockSelects(makeSelectChain({ groupByResult: [] })); // votes
      mockSelects(makeSelectChain({ whereResult: [{ count: 0 }] })); // voters
      mockSelects(
        makeSelectChain({
          limitResult: [{ displayName: 'Admin', username: 'Admin' }],
        }),
      ); // creator
      mockSelects(makeSelectChain({ whereResult: [{ count: 10 }] })); // totalMembers

      const result = await service.transitionStatus(1, {
        status: 'decided',
      });
      expect(result.status).toBe('decided');
    });

    it('should allow reversion archived → decided', async () => {
      const archivedLineup = { ...mockLineup, status: 'archived' };
      mockSelects(makeSelectChain({ limitResult: [archivedLineup] }));
      mockUpdate();
      mockBuildDetail({ ...archivedLineup, status: 'decided' });

      const result = await service.transitionStatus(1, { status: 'decided' });

      expect(result.status).toBe('decided');
    });

    it('should throw NotFoundException for missing lineup', async () => {
      mockSelects(makeSelectChain({ limitResult: [] }));

      await expect(
        service.transitionStatus(999, { status: 'voting' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
}

describe('LineupsService', describeLineupsService);
