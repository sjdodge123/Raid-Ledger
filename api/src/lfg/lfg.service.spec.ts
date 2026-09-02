/**
 * ROK-1451 rework — `POST /lfg` orchestration invariants that an integration
 * test cannot pin deterministically.
 *
 * M2 / Codex P2-b: `LFM_REACHED` used to be gated on a count read by a
 * SEPARATE, unserialised statement after the insert, so two simultaneous
 * first-posts could both observe 2 (double emit) and a burst of three could
 * jump 1 -> 3 (never emitted). The insert and the count now run inside ONE
 * transaction behind a per-game advisory lock, which makes the post-insert
 * count exact — and the event is emitted only once that transaction has
 * committed, so no consumer can observe a group that rolled back.
 *
 * L2: a triple-miss in `resolveExisting` is an internal inconsistency, not a
 * client error.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InternalServerErrorException } from '@nestjs/common';
import { LfgService } from './lfg.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { LFG_EVENTS } from './lfg.constants';

const GAME_ID = 7;

const game = {
  id: GAME_ID,
  name: 'Deep Rock Galactic',
  coverUrl: null,
  cooptimusOnlineMax: 4,
};

function intentRow() {
  return {
    id: 11,
    userId: 3,
    gameId: GAME_ID,
    status: 'active',
    visibility: 'local',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    expiresAt: new Date('2026-09-15T10:00:00Z'),
    convertedToPollId: null,
    convertedToEventId: null,
  };
}

function aggregate(activeCount: number) {
  return {
    gameId: GAME_ID,
    gameName: game.name,
    gameCoverUrl: null,
    viabilityThreshold: 4,
    activeCount,
    soonestExpiresAt: new Date('2026-09-15T10:00:00Z'),
    hasOwnIntent: true,
  };
}

/** Wire the happy path: game found, row inserted, group at `activeCount`. */
function arrangeInsert(mockDb: MockDb, activeCount: number): void {
  mockDb.limit.mockResolvedValueOnce([game]); // requireGame
  mockDb.returning.mockResolvedValueOnce([intentRow()]); // insertIntent
  mockDb.groupBy.mockResolvedValueOnce([aggregate(activeCount)]);
  mockDb.limit.mockResolvedValueOnce([intentRow()]); // buildResponse re-read
  mockDb.groupBy.mockResolvedValueOnce([aggregate(activeCount)]);
}

describe('LfgService.createIntent', () => {
  let service: LfgService;
  let mockDb: MockDb;
  let emitter: { emit: jest.Mock };
  /** Flipped by the transaction mock once the callback has resolved. */
  let committed: boolean;
  /** `committed` as observed at the moment each event was emitted. */
  let emittedAfterCommit: boolean[];

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    committed = false;
    emittedAfterCommit = [];
    mockDb.transaction.mockImplementation(
      async (cb: (tx: MockDb) => unknown) => {
        const result = await cb(mockDb);
        committed = true;
        return result;
      },
    );
    emitter = {
      emit: jest.fn(() => {
        emittedAfterCommit.push(committed);
        return true;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LfgService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();
    service = module.get(LfgService);
  });

  it('counts the group inside one transaction behind a per-game lock', async () => {
    arrangeInsert(mockDb, 2);

    const result = await service.createIntent(3, GAME_ID);

    expect(result.created).toBe(true);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    const lockStatement = JSON.stringify(mockDb.execute.mock.calls[0]?.[0]);
    expect(lockStatement).toContain('pg_advisory_xact_lock');
    expect(lockStatement).toContain(`lfg:${GAME_ID}`);
  });

  it('emits LFM_REACHED once the transaction has committed', async () => {
    arrangeInsert(mockDb, 2);

    await service.createIntent(3, GAME_ID);

    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.LFM_REACHED, {
      gameId: GAME_ID,
      activeCount: 2,
    });
    expect(emittedAfterCommit).toEqual([true]);
  });

  it('does not emit LFM_REACHED when the exact count is past the transition', async () => {
    arrangeInsert(mockDb, 3);

    await service.createIntent(3, GAME_ID);

    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('raises a 500-class error when the conflicting row cannot be re-read', async () => {
    mockDb.limit.mockResolvedValueOnce([game]); // requireGame
    mockDb.returning.mockResolvedValueOnce([]); // insert lost the conflict
    mockDb.limit.mockResolvedValueOnce([]); // findActiveIntent misses
    mockDb.returning.mockResolvedValueOnce([]); // retry insert lost again
    mockDb.limit.mockResolvedValueOnce([]); // findActiveIntent misses again

    await expect(service.createIntent(3, GAME_ID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
