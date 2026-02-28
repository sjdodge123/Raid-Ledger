/**
 * Unit tests for IgdbController interest endpoints (ROK-444).
 *
 * Tests focus on the ROK-444 changes:
 * - getGameInterest: returns `source` field when user has an interest
 * - addWantToPlay: returns `source: 'manual'`
 * - removeWantToPlay: records suppression when removing a discord-sourced interest
 *
 * The GameInterestResponseSchema source field is also validated.
 *
 * Query chain analysis for removeWantToPlay:
 *   1. Check existing: db.select({source}).from(gameInterests).where(and(...)).limit(1) → terminates at .limit(1)
 *   2. Insert suppression (if discord): db.insert(...).values({...}).onConflictDoNothing() → terminates at .onConflictDoNothing()
 *   3. Delete: db.delete(gameInterests).where(and(...)) → terminates at .where()
 *   4. Count: db.select({count}).from(gameInterests).where(eq(...)) → terminates at .where() (no limit)
 *   5. getInterestedPlayers: ...innerJoin(...).where(...).orderBy(...).limit(8) → terminates at .limit(8)
 *
 * Query chain analysis for addWantToPlay:
 *   1. Game exists: db.select({id}).from(games).where(eq(...)).limit(1) → terminates at .limit(1)
 *   2. Insert: db.insert(...).values({...}).onConflictDoNothing() → terminates at .onConflictDoNothing()
 *   3. Count: db.select({count}).from(gameInterests).where(eq(...)) → terminates at .where() (no limit)
 *   4. getInterestedPlayers: ...innerJoin(...).where(...).orderBy(...).limit(8) → terminates at .limit(8)
 *
 * Query chain analysis for getGameInterest (3 concurrent via Promise.all):
 *   1. Count: db.select({count}).from(gameInterests).where(eq(...)) → terminates at .where()
 *   2. User interest: db.select({source}).from(gameInterests).where(and(...)).limit(1) → terminates at .limit(1)
 *   3. getInterestedPlayers: ...innerJoin(...).where(...).orderBy(...).limit(8) → terminates at .limit(8)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { IgdbController } from './igdb.controller';
import { IgdbService } from './igdb.service';
import { GameInterestResponseSchema } from '@raid-ledger/contract';

// ─── Shared helper ───────────────────────────────────────────────────────────

function buildMockService(db: Record<string, jest.Mock>): Partial<IgdbService> {
  return {
    searchGames: jest.fn(),
    database: db as never,
    redisClient: {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn(),
    } as never,
    config: {} as never,
    mapDbRowToDetail: jest.fn((g: unknown) => g) as never,
    getGameDetailById: jest.fn() as never,
    enqueueSync: jest.fn() as never,
  };
}

async function createController(
  mockService: Partial<IgdbService>,
): Promise<IgdbController> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [IgdbController],
    providers: [{ provide: IgdbService, useValue: mockService }],
  }).compile();
  return module.get<IgdbController>(IgdbController);
}

const mockAuthReq = (userId: number) =>
  ({ user: { id: userId, role: 'member' } }) as never;

// ─── GameInterestResponseSchema — source field (ROK-444) ─────────────────────

describe('GameInterestResponseSchema — source field (ROK-444)', () => {
  it('accepts source: discord', () => {
    const result = GameInterestResponseSchema.safeParse({
      wantToPlay: true,
      count: 3,
      source: 'discord',
    });
    expect(result.success).toBe(true);
  });

  it('accepts source: manual', () => {
    const result = GameInterestResponseSchema.safeParse({
      wantToPlay: true,
      count: 1,
      source: 'manual',
    });
    expect(result.success).toBe(true);
  });

  it('accepts source: steam', () => {
    const result = GameInterestResponseSchema.safeParse({
      wantToPlay: true,
      count: 1,
      source: 'steam',
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing source (optional field)', () => {
    const result = GameInterestResponseSchema.safeParse({
      wantToPlay: false,
      count: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBeUndefined();
    }
  });

  it('rejects invalid source value', () => {
    const result = GameInterestResponseSchema.safeParse({
      wantToPlay: true,
      count: 1,
      source: 'twitter',
    });
    expect(result.success).toBe(false);
  });

  it('source is undefined when wantToPlay is false', () => {
    const result = GameInterestResponseSchema.safeParse({
      wantToPlay: false,
      count: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBeUndefined();
    }
  });

  it('all three valid source values pass schema', () => {
    for (const src of ['manual', 'steam', 'discord'] as const) {
      const result = GameInterestResponseSchema.safeParse({
        wantToPlay: true,
        count: 1,
        source: src,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ─── getGameInterest — source field returned (ROK-444) ───────────────────────

describe('IgdbController.getGameInterest — source field (ROK-444)', () => {
  /**
   * getGameInterest uses Promise.all for 3 concurrent queries.
   * The flat mock can handle this because each query terminates at a different
   * method call (count at .where(), user interest at .limit(), players at .limit()).
   */

  function buildInterestDb(
    source: 'discord' | 'manual' | 'steam' | null,
  ): Record<string, jest.Mock> {
    const db: Record<string, jest.Mock> = {};
    const chainMethods = [
      'select',
      'from',
      'insert',
      'values',
      'innerJoin',
      'leftJoin',
      'orderBy',
      'groupBy',
      'delete',
      'set',
      'update',
    ];
    for (const m of chainMethods) {
      db[m] = jest.fn().mockReturnThis();
    }

    // Count query terminates at .where() (first .where call after the chain starts)
    // User interest query terminates at .limit(1)
    // getInterestedPlayers terminates at .limit(8)
    let whereCallCount = 0;
    db.where = jest.fn().mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) {
        // Count query — terminates here
        return Promise.resolve([{ count: source ? 1 : 0 }]);
      }
      // Other .where calls: continue the chain
      return db;
    });

    let limitCallCount = 0;
    db.limit = jest.fn().mockImplementation(() => {
      limitCallCount++;
      if (limitCallCount === 1) {
        // User interest query
        return Promise.resolve(source ? [{ source }] : []);
      }
      // getInterestedPlayers
      return Promise.resolve([]);
    });

    return db;
  }

  it('returns source: discord when user interest has source discord', async () => {
    const db = buildInterestDb('discord');
    const ctrl = await createController(buildMockService(db));
    const result = await ctrl.getGameInterest(42, mockAuthReq(1));

    expect(result.source).toBe('discord');
    expect(result.wantToPlay).toBe(true);
  });

  it('returns source: manual when user interest has source manual', async () => {
    const db = buildInterestDb('manual');
    const ctrl = await createController(buildMockService(db));
    const result = await ctrl.getGameInterest(10, mockAuthReq(1));

    expect(result.source).toBe('manual');
    expect(result.wantToPlay).toBe(true);
  });

  it('returns undefined source when user has no interest', async () => {
    const db = buildInterestDb(null);
    const ctrl = await createController(buildMockService(db));
    const result = await ctrl.getGameInterest(10, mockAuthReq(99));

    expect(result.wantToPlay).toBe(false);
    expect(result.source).toBeUndefined();
  });

  it('returns count from the count query', async () => {
    const db = buildInterestDb('discord');
    const ctrl = await createController(buildMockService(db));
    const result = await ctrl.getGameInterest(42, mockAuthReq(1));

    expect(typeof result.count).toBe('number');
  });
});

// ─── addWantToPlay — returns source: 'manual' (ROK-444) ──────────────────────

describe('IgdbController.addWantToPlay — source: manual (ROK-444)', () => {
  function buildAddDb(gameExists: boolean): Record<string, jest.Mock> {
    const db: Record<string, jest.Mock> = {};
    const chainMethods = [
      'select',
      'from',
      'innerJoin',
      'leftJoin',
      'orderBy',
      'groupBy',
      'delete',
      'set',
      'update',
    ];
    for (const m of chainMethods) {
      db[m] = jest.fn().mockReturnThis();
    }

    // addWantToPlay query sequence:
    //   .where() calls:
    //     1st: game exists .where(eq(id)) → chain continues to .limit(1)
    //     2nd: count .where(eq(gameId)) → terminal (resolves)
    //     3rd: getInterestedPlayers .where(eq(gameId)) → chain continues to .orderBy.limit(8)
    //   .limit() calls:
    //     1st: game exists .limit(1) → terminal (resolves [{ id }] or [])
    //     2nd: getInterestedPlayers .limit(8) → terminal (resolves [])

    let whereCallCount = 0;
    db.where = jest.fn().mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) {
        // game exists query — chain continues to .limit()
        return db;
      }
      if (whereCallCount === 2) {
        // count query — terminal
        return Promise.resolve([{ count: 1 }]);
      }
      // getInterestedPlayers — chain continues to .orderBy.limit
      return db;
    });

    let limitCallCount = 0;
    db.limit = jest.fn().mockImplementation(() => {
      limitCallCount++;
      if (limitCallCount === 1) {
        // Game exists check
        return Promise.resolve(gameExists ? [{ id: 5 }] : []);
      }
      // getInterestedPlayers
      return Promise.resolve([]);
    });

    db.insert = jest.fn().mockReturnThis();
    db.values = jest.fn().mockReturnThis();
    db.onConflictDoNothing = jest.fn().mockResolvedValueOnce(undefined);

    return db;
  }

  it('returns source: manual when hearting a game', async () => {
    const db = buildAddDb(true);
    const ctrl = await createController(buildMockService(db));
    const result = await ctrl.addWantToPlay(5, mockAuthReq(1));

    expect(result.wantToPlay).toBe(true);
    expect(result.source).toBe('manual');
  });

  it('inserts with source: manual into game_interests', async () => {
    const db = buildAddDb(true);
    const ctrl = await createController(buildMockService(db));
    await ctrl.addWantToPlay(1, mockAuthReq(10));

    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 10,
        gameId: 1,
        source: 'manual',
      }),
    );
  });

  it('throws NotFoundException when game does not exist', async () => {
    const db = buildAddDb(false);
    const ctrl = await createController(buildMockService(db));

    await expect(ctrl.addWantToPlay(9999, mockAuthReq(1))).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ─── removeWantToPlay — suppression logic (ROK-444) ──────────────────────────

describe('IgdbController.removeWantToPlay — suppression on discord source (ROK-444)', () => {
  /**
   * removeWantToPlay query sequence:
   *   1. db.select({source}).from(gameInterests).where(and(...)).limit(1)  ← .limit(1) terminal
   *   2. db.insert(suppressions).values({userId, gameId}).onConflictDoNothing()  ← if discord
   *   3. db.delete(gameInterests).where(and(...))  ← .where() terminal
   *   4. db.select({count}).from(gameInterests).where(eq(...))  ← .where() terminal (2nd where after delete chain)
   *   5. getInterestedPlayers → .limit(8) terminal
   */

  function buildRemoveDb(existingSource: 'discord' | 'manual' | null): {
    db: Record<string, jest.Mock>;
    insertMock: jest.Mock;
  } {
    const db: Record<string, jest.Mock> = {};
    const chainMethods = [
      'select',
      'from',
      'innerJoin',
      'leftJoin',
      'orderBy',
      'groupBy',
      'set',
      'update',
    ];
    for (const m of chainMethods) {
      db[m] = jest.fn().mockReturnThis();
    }

    // .limit() calls:
    //   1st: existing interest check → returns [{source}] or []
    //   2nd+: getInterestedPlayers → returns []
    let limitCallCount = 0;
    db.limit = jest.fn().mockImplementation(() => {
      limitCallCount++;
      if (limitCallCount === 1) {
        return Promise.resolve(existingSource ? [{ source: existingSource }] : []);
      }
      return Promise.resolve([]);
    });

    // .where() calls:
    //   1st call chains (part of existing interest query — continues to .limit)
    //   After that: delete where → terminates
    //   Then: count where → terminates
    let whereCallCount = 0;
    db.where = jest.fn().mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) {
        // existing interest query: .where(and(...)) → chain continues to .limit(1)
        return db;
      }
      if (whereCallCount === 2) {
        // delete .where(and(...)) → terminal
        return Promise.resolve(undefined);
      }
      if (whereCallCount === 3) {
        // count .where(eq(...)) → terminal
        return Promise.resolve([{ count: 0 }]);
      }
      return db;
    });

    const insertMock = jest.fn().mockReturnThis();
    db.insert = insertMock;
    db.values = jest.fn().mockReturnThis();
    db.onConflictDoNothing = jest.fn().mockResolvedValueOnce(undefined);
    db.delete = jest.fn().mockReturnThis();

    return { db, insertMock };
  }

  it('records suppression when removing a discord-sourced interest', async () => {
    const { db, insertMock } = buildRemoveDb('discord');
    const ctrl = await createController(buildMockService(db));

    const result = await ctrl.removeWantToPlay(42, mockAuthReq(1));

    // Suppression insert should have occurred
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, gameId: 42 }),
    );
    expect(result.wantToPlay).toBe(false);
  });

  it('does NOT record suppression when removing a manual interest', async () => {
    const { db, insertMock } = buildRemoveDb('manual');
    const ctrl = await createController(buildMockService(db));

    await ctrl.removeWantToPlay(10, mockAuthReq(2));

    // No suppression insert for manual interests
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('does NOT record suppression when there is no existing interest', async () => {
    const { db, insertMock } = buildRemoveDb(null);
    const ctrl = await createController(buildMockService(db));

    await ctrl.removeWantToPlay(10, mockAuthReq(2));

    expect(insertMock).not.toHaveBeenCalled();
  });

  it('returns wantToPlay: false and no source after removal', async () => {
    const { db } = buildRemoveDb('discord');
    const ctrl = await createController(buildMockService(db));

    const result = await ctrl.removeWantToPlay(42, mockAuthReq(1));

    expect(result.wantToPlay).toBe(false);
    expect(result).not.toHaveProperty('source');
  });

  it('suppression insert uses onConflictDoNothing (idempotent)', async () => {
    const { db } = buildRemoveDb('discord');
    const ctrl = await createController(buildMockService(db));

    await ctrl.removeWantToPlay(5, mockAuthReq(3));

    expect(db.onConflictDoNothing).toHaveBeenCalled();
  });

  it('suppression is recorded with correct userId and gameId', async () => {
    const { db } = buildRemoveDb('discord');
    const ctrl = await createController(buildMockService(db));

    await ctrl.removeWantToPlay(77, mockAuthReq(42));

    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, gameId: 77 }),
    );
  });
});
