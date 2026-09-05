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
 *
 * ROK-1454 D1: the lifecycle emits. `LFM_REACHED` owns the 1 -> 2 transition,
 * `GROUP_CHANGED` owns every shape change AFTER it, and the two must never
 * fire for the same change — a consumer that saw both would post a message
 * and immediately edit it.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { LfgGroupChangedPayload } from './lfg.constants';
import { LfgService } from './lfg.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { LFG_EVENTS } from './lfg.constants';

const GAME_ID = 7;
const EVENT_ID = 42;
const POLL_ID = 91;

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
    // Relative so the row stays live whatever day the suite runs on.
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
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

/** The re-post path: the partial unique index rejects the insert. */
function arrangeConflict(mockDb: MockDb, activeCount: number): void {
  mockDb.limit.mockResolvedValueOnce([game]); // requireGame
  mockDb.returning.mockResolvedValueOnce([]); // insertIntent lost the conflict
  mockDb.limit.mockResolvedValueOnce([intentRow()]); // findActiveIntent
  mockDb.groupBy.mockResolvedValueOnce([aggregate(activeCount)]);
}

/** Game found, caller is a participant, target resolves to the route's game. */
function arrangeConvert(mockDb: MockDb, converted: number): void {
  mockDb.limit.mockResolvedValueOnce([game]); // requireGame
  mockDb.limit.mockResolvedValueOnce([{ id: 11 }]); // isGroupParticipant
  mockDb.limit.mockResolvedValueOnce([{ gameId: GAME_ID }]); // target's game
  mockDb.returning.mockResolvedValueOnce(
    Array.from({ length: converted }, (_, i) => ({ id: 100 + i })),
  );
}

describe('LfgService lifecycle events', () => {
  let service: LfgService;
  let mockDb: MockDb;
  let emitter: { emit: jest.Mock };
  /** Flipped by the transaction mock once the callback has resolved. */
  let committed: boolean;
  /** `committed` as observed at the moment each event was emitted. */
  let emittedAfterCommit: boolean[];

  /** Event names in emit order — the "never both" assertion reads this. */
  const emittedNames = (): string[] =>
    emitter.emit.mock.calls.map((call) => call[0] as string);

  /** Payload of emit #`index`, asserting the emit happened at all first. */
  const payloadAt = (index: number): LfgGroupChangedPayload => {
    expect(emitter.emit.mock.calls.length).toBeGreaterThan(index);
    return emitter.emit.mock.calls[index][1] as LfgGroupChangedPayload;
  };

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

  describe('createIntent', () => {
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

      expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.LFM_REACHED, {
        gameId: GAME_ID,
        activeCount: 2,
      });
      expect(emittedAfterCommit).toEqual([true]);
    });

    // ROK-1454 D1 boundary. Mutating `>= 3` to `>= 2` makes the 1 -> 2
    // transition emit BOTH events; this is the assertion that catches it.
    it('emits LFM_REACHED ALONE at the 1 -> 2 transition, never GROUP_CHANGED too', async () => {
      arrangeInsert(mockDb, 2);

      await service.createIntent(3, GAME_ID);

      expect(emittedNames()).toEqual([LFG_EVENTS.LFM_REACHED]);
    });

    it('emits GROUP_CHANGED joined ALONE on the third hand, never LFM_REACHED', async () => {
      arrangeInsert(mockDb, 3);

      await service.createIntent(3, GAME_ID);

      expect(emittedNames()).toEqual([LFG_EVENTS.GROUP_CHANGED]);
      expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.GROUP_CHANGED, {
        gameId: GAME_ID,
        reason: 'joined',
      });
      expect(emittedAfterCommit).toEqual([true]);
    });

    it('carries no member count on the joined payload — the consumer re-reads', async () => {
      arrangeInsert(mockDb, 9);

      await service.createIntent(3, GAME_ID);

      const payload = payloadAt(0);
      expect(Object.keys(payload).sort()).toEqual(['gameId', 'reason']);
    });

    it('stays silent when the caller re-posts an intent they already hold', async () => {
      arrangeConflict(mockDb, 4);

      const result = await service.createIntent(3, GAME_ID);

      expect(result.created).toBe(false);
      expect(emittedNames()).toEqual([]);
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

  describe('withdraw', () => {
    it('emits GROUP_CHANGED withdrawn after the row was actually cleared', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 11 }]); // clearIntent

      await service.withdraw(3, GAME_ID);

      expect(emittedNames()).toEqual([LFG_EVENTS.GROUP_CHANGED]);
      expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.GROUP_CHANGED, {
        gameId: GAME_ID,
        reason: 'withdrawn',
      });
    });

    it('emits nothing when the caller held no intent to withdraw', async () => {
      mockDb.returning.mockResolvedValueOnce([]); // clearIntent cleared nothing

      await expect(service.withdraw(3, GAME_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(emittedNames()).toEqual([]);
    });
  });

  describe('convert', () => {
    it('emits GROUP_CHANGED converted carrying the event provenance key', async () => {
      arrangeConvert(mockDb, 3);

      const result = await service.convert(3, GAME_ID, { eventId: EVENT_ID });

      expect(result).toEqual({ converted: 3 });
      expect(emittedNames()).toEqual([LFG_EVENTS.GROUP_CHANGED]);
      const payload = payloadAt(0);
      expect(payload).toMatchObject({
        gameId: GAME_ID,
        reason: 'converted',
        eventId: EVENT_ID,
      });
      // Must be undefined, NOT null: `convertedToTarget` (D5) branches on
      // `pollId !== undefined`, so a null here would filter on the wrong column.
      expect(payload.pollId).toBeUndefined();
    });

    it('emits GROUP_CHANGED converted carrying the poll provenance key', async () => {
      arrangeConvert(mockDb, 2);

      await service.convert(3, GAME_ID, { pollId: POLL_ID });

      const payload = payloadAt(0);
      expect(payload).toMatchObject({
        gameId: GAME_ID,
        reason: 'converted',
        pollId: POLL_ID,
      });
      expect(payload.eventId).toBeUndefined();
    });

    // E5: converting twice with the same target is a retry, and a retry must
    // not re-render a message that is already terminal.
    it('stays silent when the retry converts zero rows', async () => {
      arrangeConvert(mockDb, 0);

      const result = await service.convert(3, GAME_ID, { eventId: EVENT_ID });

      expect(result).toEqual({ converted: 0 });
      expect(emittedNames()).toEqual([]);
    });
  });
});
