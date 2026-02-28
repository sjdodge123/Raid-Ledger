/**
 * Unit tests for GameActivityService.autoHeartCheck (ROK-444).
 *
 * autoHeartCheck() auto-hearts games when a user accumulates >= 5h of
 * total Discord playtime for a matched game.
 *
 * Query chain analysis for autoHeartCheck():
 *
 * 1. Candidates:
 *    db.select({userId, gameId})
 *      .from(gameActivitySessions)
 *      .where(and(isNotNull(gameId), isNotNull(endedAt)))
 *      .groupBy(userId, gameId)
 *      .having(gte(sum(duration), threshold))
 *    → terminates at .having()
 *
 * 2. Opted-out users:
 *    db.select({userId}).from(userPreferences).where(and(...))
 *    → terminates at .where() (no limit)
 *
 * 3. Existing interests:
 *    db.select({userId, gameId}).from(gameInterests)
 *    → terminates at .from() — no further chaining
 *
 * 4. Suppressions:
 *    db.select({userId, gameId}).from(gameInterestSuppressions)
 *    → terminates at .from() — no further chaining
 *
 * 5. Insert:
 *    db.insert(gameInterests).values({...}).onConflictDoNothing()
 *    → terminates at .onConflictDoNothing()
 */
import { Test, TestingModule } from '@nestjs/testing';
import { GameActivityService } from './game-activity.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

/**
 * Build a mock DB with the correct terminal mock sequencing for autoHeartCheck.
 *
 * Because autoHeartCheck makes 4 DB queries (candidates, opted-out, interests,
 * suppressions), and each terminates at a different chain method, we set up
 * each terminal mock independently.
 */
function buildAutoHeartMockDb({
  candidates,
  optedOut,
  existingInterests,
  suppressions,
}: {
  candidates: { userId: number; gameId: number | null }[];
  optedOut: { userId: number }[];
  existingInterests: { userId: number; gameId: number }[];
  suppressions: { userId: number; gameId: number }[];
}) {
  const mockDb = createDrizzleMock();

  // Add 'having' — not in base mock but needed for the candidates query
  const havingMock = jest.fn().mockResolvedValue(candidates);
  mockDb.having = havingMock;

  // Opted-out query terminates at .where()
  // Interests and suppressions terminate at .from()
  // We need to sequence these because they all share the same mock methods.
  //
  // Since the drizzle mock returns `this` for all chain methods,
  // the sequence depends on which call to which terminal resolves what.
  //
  // Pattern: .from() is called for:
  //   - interests query (3rd call to .from after select)
  //   - suppressions query (4th call to .from after select)
  //
  // And .where() is called as terminal for:
  //   - opted-out query (2nd call to .where — 1st is inside candidates' query chain)
  //
  // The flat mock shares `.where` across all chains. We need each to return
  // the right value in sequence.

  let whereCallCount = 0;
  mockDb.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    // Call 1: candidates query's .where(...).groupBy(...).having(...)
    //         → .where returns this (continues to .groupBy)
    // Call 2: opted-out query's terminal .where(and(...))
    //         → resolves to optedOut array
    if (whereCallCount === 1) {
      return mockDb; // candidates chain continues
    }
    if (whereCallCount === 2) {
      return Promise.resolve(optedOut);
    }
    return mockDb;
  });

  let fromCallCount = 0;
  mockDb.from = jest.fn().mockImplementation(() => {
    fromCallCount++;
    // from() calls:
    //   1st: candidates query .from(gameActivitySessions) → chain continues
    //   2nd: opted-out query .from(userPreferences) → chain continues (where is terminal)
    //   3rd: interests query .from(gameInterests) → terminal (resolves)
    //   4th: suppressions query .from(gameInterestSuppressions) → terminal (resolves)
    if (fromCallCount <= 2) {
      return mockDb;
    }
    if (fromCallCount === 3) {
      return Promise.resolve(existingInterests);
    }
    if (fromCallCount === 4) {
      return Promise.resolve(suppressions);
    }
    return mockDb;
  });

  // Insert terminates at onConflictDoNothing
  mockDb.onConflictDoNothing = jest.fn().mockResolvedValue(undefined);

  return mockDb;
}

// ─── Suite setup helper ──────────────────────────────────────────────────────

async function createService(mockDb: MockDb) {
  const mockCronJobService = {
    executeWithTracking: jest
      .fn()
      .mockImplementation(async (_name: string, fn: () => Promise<void>) =>
        fn(),
      ),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GameActivityService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: CronJobService, useValue: mockCronJobService },
    ],
  }).compile();

  const service = module.get<GameActivityService>(GameActivityService);
  // Prevent onModuleInit side-effects (orphan session cleanup + flush timer)
  service.onApplicationShutdown();
  return service;
}

// ─── autoHeartCheck — happy path ─────────────────────────────────────────────

describe('GameActivityService — autoHeartCheck (ROK-444)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('happy path', () => {
    it('inserts with source:discord for a qualifying candidate', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [{ userId: 1, gameId: 10 }],
        optedOut: [],
        existingInterests: [],
        suppressions: [],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, gameId: 10, source: 'discord' }),
      );
      expect(mockDb.onConflictDoNothing).toHaveBeenCalled();
    });

    it('inserts multiple interests when multiple candidates qualify', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [
          { userId: 1, gameId: 10 },
          { userId: 2, gameId: 20 },
        ],
        optedOut: [],
        existingInterests: [],
        suppressions: [],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });

    it('uses onConflictDoNothing for idempotency', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [{ userId: 1, gameId: 5 }],
        optedOut: [],
        existingInterests: [],
        suppressions: [],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.onConflictDoNothing).toHaveBeenCalled();
    });
  });

  // ─── Opt-out filter (AC #2) ───────────────────────────────────────────────

  describe('opt-out filter (AC #2)', () => {
    it('skips users who have autoHeartGames preference set to false', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [{ userId: 5, gameId: 10 }],
        optedOut: [{ userId: 5 }],
        existingInterests: [],
        suppressions: [],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('inserts for opted-in user while skipping opted-out user', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [
          { userId: 1, gameId: 10 },
          { userId: 2, gameId: 10 },
        ],
        optedOut: [{ userId: 2 }],
        existingInterests: [],
        suppressions: [],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, gameId: 10 }),
      );
    });
  });

  // ─── Existing interest filter ─────────────────────────────────────────────

  describe('existing interest filter', () => {
    it('skips a user/game pair that already has an interest', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [{ userId: 1, gameId: 10 }],
        optedOut: [],
        existingInterests: [{ userId: 1, gameId: 10 }],
        suppressions: [],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('only inserts for games not already hearted', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [
          { userId: 1, gameId: 10 },
          { userId: 1, gameId: 99 },
        ],
        optedOut: [],
        existingInterests: [{ userId: 1, gameId: 10 }],
        suppressions: [],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, gameId: 99 }),
      );
    });
  });

  // ─── Suppression filter (AC #3) ──────────────────────────────────────────

  describe('suppression filter (AC #3)', () => {
    it('skips a suppressed user/game pair', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [{ userId: 1, gameId: 10 }],
        optedOut: [],
        existingInterests: [],
        suppressions: [{ userId: 1, gameId: 10 }],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('does not suppress a different user for the same game', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [
          { userId: 1, gameId: 10 },
          { userId: 2, gameId: 10 },
        ],
        optedOut: [],
        existingInterests: [],
        suppressions: [{ userId: 1, gameId: 10 }],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 2, gameId: 10 }),
      );
    });

    it('suppression is independent of opt-out toggle', async () => {
      // User is opted IN globally, but suppressed for this specific game
      const mockDb = buildAutoHeartMockDb({
        candidates: [{ userId: 3, gameId: 7 }],
        optedOut: [], // opted in
        existingInterests: [],
        suppressions: [{ userId: 3, gameId: 7 }], // but suppressed for game 7
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  // ─── Null gameId guard ────────────────────────────────────────────────────

  describe('null gameId guard', () => {
    it('filters out candidates where gameId is null', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [{ userId: 1, gameId: null }],
        optedOut: [],
        existingInterests: [],
        suppressions: [],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('inserts for non-null gameId candidates alongside null ones', async () => {
      const mockDb = buildAutoHeartMockDb({
        candidates: [
          { userId: 1, gameId: null },
          { userId: 2, gameId: 5 },
        ],
        optedOut: [],
        existingInterests: [],
        suppressions: [],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 2, gameId: 5 }),
      );
    });
  });

  // ─── Early return — no candidates ────────────────────────────────────────

  describe('early return when no candidates', () => {
    it('returns early and makes no further queries when candidates list is empty', async () => {
      const mockDb = createDrizzleMock();
      mockDb.having = jest.fn().mockResolvedValue([]);

      const service = await createService(mockDb);

      await service.autoHeartCheck();

      // No insert, no opted-out query (where not called for opt-out)
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  // ─── Combined filter scenario ─────────────────────────────────────────────

  describe('combined filters', () => {
    it('correctly applies all three filters simultaneously', async () => {
      // 4 candidates:
      // user 1 / game 10: opted out → skip
      // user 2 / game 20: already hearted → skip
      // user 3 / game 30: suppressed → skip
      // user 4 / game 40: qualifies → insert
      const mockDb = buildAutoHeartMockDb({
        candidates: [
          { userId: 1, gameId: 10 },
          { userId: 2, gameId: 20 },
          { userId: 3, gameId: 30 },
          { userId: 4, gameId: 40 },
        ],
        optedOut: [{ userId: 1 }],
        existingInterests: [{ userId: 2, gameId: 20 }],
        suppressions: [{ userId: 3, gameId: 30 }],
      });
      const service = await createService(mockDb);

      await service.autoHeartCheck();

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 4,
          gameId: 40,
          source: 'discord',
        }),
      );
    });
  });
});

// ─── GameActivityService — flush ─────────────────────────────────────────────

describe('GameActivityService — flush', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockDb.having = jest.fn().mockReturnThis();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  async function createFlushService(db: MockDb) {
    const mockCronJobService = {
      executeWithTracking: jest
        .fn()
        .mockImplementation(async (_name: string, fn: () => Promise<void>) =>
          fn(),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameActivityService,
        { provide: DrizzleAsyncProvider, useValue: db },
        { provide: CronJobService, useValue: mockCronJobService },
      ],
    }).compile();

    const service = module.get<GameActivityService>(GameActivityService);
    service.onApplicationShutdown();
    return service;
  }

  it('does nothing when buffer is empty', async () => {
    const service = await createFlushService(mockDb);

    await service.flush();

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('drains the buffer — second flush after a flush is a no-op', async () => {
    // Set up db to handle the game name resolution + insert
    mockDb.limit
      .mockResolvedValueOnce([]) // discordGameMappings lookup → no mapping
      .mockResolvedValueOnce([{ id: 1 }]) // games.name match → gameId 1
      .mockResolvedValueOnce(undefined); // session insert

    const service = await createFlushService(mockDb);

    service.bufferStart(1, 'SomeGame', new Date());
    await service.flush();

    // Reset mocks to verify second flush is empty
    mockDb.insert.mockClear();
    await service.flush();

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('bufferStop records stop events that get flushed', async () => {
    // The stop flush path queries for an open session
    // Set up mock to return no open session (so nothing gets updated)
    mockDb.limit.mockResolvedValueOnce([]); // no open session found

    const service = await createFlushService(mockDb);

    service.bufferStop(1, 'SomeGame', new Date());
    await service.flush();

    // select was called to look for open session
    expect(mockDb.select).toHaveBeenCalled();
  });
});
