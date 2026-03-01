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
 * 3. Existing interests (scoped to candidate user IDs):
 *    db.select({userId, gameId}).from(gameInterests).where(inArray(...))
 *    → terminates at .where()
 *
 * 4. Suppressions (scoped to candidate user IDs):
 *    db.select({userId, gameId}).from(gameInterestSuppressions).where(inArray(...))
 *    → terminates at .where()
 *
 * 5. Insert (batch):
 *    db.insert(gameInterests).values([...]).onConflictDoNothing()
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

  // All 4 queries now terminate at .where() (candidates continues, others resolve):
  //
  // Call 1: candidates query .where(...).groupBy(...).having(...)
  //         → .where returns this (continues to .groupBy)
  // Call 2: opted-out query's terminal .where(and(...))
  //         → resolves to optedOut array
  // Call 3: interests query's terminal .where(inArray(...))
  //         → resolves to existingInterests
  // Call 4: suppressions query's terminal .where(inArray(...))
  //         → resolves to suppressions

  let whereCallCount = 0;
  mockDb.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    if (whereCallCount === 1) {
      return mockDb; // candidates chain continues
    }
    if (whereCallCount === 2) {
      return Promise.resolve(optedOut);
    }
    if (whereCallCount === 3) {
      return Promise.resolve(existingInterests);
    }
    if (whereCallCount === 4) {
      return Promise.resolve(suppressions);
    }
    return mockDb;
  });

  // Insert terminates at onConflictDoNothing (single batch)
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

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb.values).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 1, gameId: 10, source: 'discord' }),
      ]);
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

      // Batch insert: single call with array of values
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb.values).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 1, gameId: 10, source: 'discord' }),
        expect.objectContaining({ userId: 2, gameId: 20, source: 'discord' }),
      ]);
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
      expect(mockDb.values).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 1, gameId: 10 }),
      ]);
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
      expect(mockDb.values).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 1, gameId: 99 }),
      ]);
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
      expect(mockDb.values).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 2, gameId: 10 }),
      ]);
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
      expect(mockDb.values).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 2, gameId: 5 }),
      ]);
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
      expect(mockDb.values).toHaveBeenCalledWith([
        expect.objectContaining({
          userId: 4,
          gameId: 40,
          source: 'discord',
        }),
      ]);
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

  it('flush skips insert when an open session already exists (DB safety net)', async () => {
    // Set up: game name already cached, and an open session exists in DB
    mockDb.limit
      .mockResolvedValueOnce([]) // discordGameMappings → no mapping
      .mockResolvedValueOnce([{ id: 1 }]) // games.name match
      .mockResolvedValueOnce([{ id: 99 }]); // existing open session found

    const service = await createFlushService(mockDb);

    service.bufferStart(1, 'SomeGame', new Date());
    await service.flush();

    // select was called (for game resolution + open session check)
    // but insert should NOT be called because open session exists
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ─── GameActivityService — source dedup (ROK-591) ────────────────────────────

describe('GameActivityService — source dedup (ROK-591)', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockDb.having = jest.fn().mockReturnThis();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  async function createDedupService(db: MockDb) {
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

  describe('bufferStart dedup', () => {
    it('first source creates a buffer event', async () => {
      const service = await createDedupService(mockDb);

      service.bufferStart(1, 'TestGame', new Date(), 'presence');

      expect(service.hasActiveSource(1, 'TestGame', 'presence')).toBe(true);
    });

    it('second source for same user+game does NOT create a second buffer event', async () => {
      // Set up DB for flush (game resolution + open session check + insert)
      mockDb.limit
        .mockResolvedValueOnce([]) // discordGameMappings → no mapping
        .mockResolvedValueOnce([{ id: 1 }]) // games.name match
        .mockResolvedValueOnce([]); // no existing open session

      const service = await createDedupService(mockDb);

      service.bufferStart(1, 'TestGame', new Date(), 'presence');
      service.bufferStart(1, 'TestGame', new Date(), 'voice');

      // Both sources should be tracked
      expect(service.hasActiveSource(1, 'TestGame', 'presence')).toBe(true);
      expect(service.hasActiveSource(1, 'TestGame', 'voice')).toBe(true);

      // Flush should only insert ONE session (the first bufferStart)
      await service.flush();
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('different games for same user are tracked independently', async () => {
      const service = await createDedupService(mockDb);

      service.bufferStart(1, 'GameA', new Date(), 'presence');
      service.bufferStart(1, 'GameB', new Date(), 'voice');

      expect(service.hasActiveSource(1, 'GameA', 'presence')).toBe(true);
      expect(service.hasActiveSource(1, 'GameB', 'voice')).toBe(true);
      // They are NOT deduped — different games
      expect(service.hasActiveSource(1, 'GameA', 'voice')).toBe(false);
    });

    it('different users for same game are tracked independently', async () => {
      const service = await createDedupService(mockDb);

      service.bufferStart(1, 'TestGame', new Date(), 'presence');
      service.bufferStart(2, 'TestGame', new Date(), 'presence');

      expect(service.hasActiveSource(1, 'TestGame', 'presence')).toBe(true);
      expect(service.hasActiveSource(2, 'TestGame', 'presence')).toBe(true);
    });
  });

  describe('bufferStop dedup', () => {
    it('removing one source when another remains does NOT buffer a close event', async () => {
      const service = await createDedupService(mockDb);

      // Start both sources
      service.bufferStart(1, 'TestGame', new Date(), 'presence');
      service.bufferStart(1, 'TestGame', new Date(), 'voice');

      // Stop voice — presence still active
      service.bufferStop(1, 'TestGame', new Date(), 'voice');

      expect(service.hasActiveSource(1, 'TestGame', 'presence')).toBe(true);
      expect(service.hasActiveSource(1, 'TestGame', 'voice')).toBe(false);

      // Flush should only have the open event (from first bufferStart), no close
      // Set up DB for the open event flush
      mockDb.limit
        .mockResolvedValueOnce([]) // discordGameMappings
        .mockResolvedValueOnce([{ id: 1 }]) // games.name match
        .mockResolvedValueOnce([]); // no existing open session

      await service.flush();
      // insert called for the open, but no close query for finding session
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('removing last source buffers a close event', async () => {
      const service = await createDedupService(mockDb);

      service.bufferStart(1, 'TestGame', new Date(), 'presence');
      service.bufferStop(1, 'TestGame', new Date(), 'presence');

      // Source tracking should be fully cleared
      expect(service.getActiveSources(1, 'TestGame')).toBeUndefined();

      // Flush should have both open + close events
      mockDb.limit
        .mockResolvedValueOnce([]) // discordGameMappings
        .mockResolvedValueOnce([{ id: 1 }]) // games.name match
        .mockResolvedValueOnce([]) // no existing open session (safety check)
        .mockResolvedValueOnce([{ id: 50, startedAt: new Date() }]); // find open session for close

      await service.flush();
      // insert for open + update for close
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
    });

    it('both sources stop in sequence → single close event', async () => {
      const service = await createDedupService(mockDb);

      service.bufferStart(1, 'TestGame', new Date(), 'presence');
      service.bufferStart(1, 'TestGame', new Date(), 'voice');

      // Voice stops first — no close buffered
      service.bufferStop(1, 'TestGame', new Date(), 'voice');
      expect(service.hasActiveSource(1, 'TestGame', 'presence')).toBe(true);

      // Presence stops — NOW close is buffered
      service.bufferStop(1, 'TestGame', new Date(), 'presence');
      expect(service.getActiveSources(1, 'TestGame')).toBeUndefined();

      // Flush: 1 open (from first bufferStart) + 1 close (from last bufferStop)
      mockDb.limit
        .mockResolvedValueOnce([]) // discordGameMappings
        .mockResolvedValueOnce([{ id: 1 }]) // games.name match
        .mockResolvedValueOnce([]) // no existing open session
        .mockResolvedValueOnce([{ id: 50, startedAt: new Date() }]); // find open session for close

      await service.flush();
      expect(mockDb.insert).toHaveBeenCalledTimes(1); // only 1 open
    });
  });

  describe('edge cases', () => {
    it('bufferStop for unknown source still closes the session', async () => {
      // Scenario: voice source was never tracked (e.g., bot restart cleared state)
      const service = await createDedupService(mockDb);

      service.bufferStop(1, 'TestGame', new Date(), 'voice');

      // Should still buffer the close event (activeSources was empty/undefined)
      mockDb.limit.mockResolvedValueOnce([{ id: 50, startedAt: new Date() }]);
      await service.flush();
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('onApplicationShutdown clears active sources', async () => {
      const service = await createDedupService(mockDb);

      service.bufferStart(1, 'TestGame', new Date(), 'presence');
      expect(service.hasActiveSource(1, 'TestGame', 'presence')).toBe(true);

      service.onApplicationShutdown();
      expect(service.hasActiveSource(1, 'TestGame', 'presence')).toBe(false);
    });

    it('default source parameter is "presence"', async () => {
      const service = await createDedupService(mockDb);

      // Call without explicit source — should default to 'presence'
      service.bufferStart(1, 'TestGame', new Date());
      expect(service.hasActiveSource(1, 'TestGame', 'presence')).toBe(true);
    });
  });
});
