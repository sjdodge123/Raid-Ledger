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
const MINUTE_MS = 60 * 1000;
const EVENT_ID = 42;
const POLL_ID = 91;

const game = {
  id: GAME_ID,
  name: 'Deep Rock Galactic',
  coverUrl: null,
  cooptimusOnlineMax: 4,
};

function intentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    userId: 3,
    gameId: GAME_ID,
    status: 'active',
    visibility: 'local',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    // Relative so the row stays live whatever day the suite runs on.
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    urgency: 'week',
    ttlMinutes: null,
    convertedToPollId: null,
    convertedToEventId: null,
    ...overrides,
  };
}

/**
 * A live `now` row on its own horizon — what a bump, or a now post, produces.
 *
 * @param ttlMinutes - The row's stored TTL; one of `LFG_NOW_TTL_MINUTES`.
 */
function nowRow(ttlMinutes: 30 | 60 = 30) {
  return intentRow({
    urgency: 'now',
    ttlMinutes,
    expiresAt: new Date(Date.now() + ttlMinutes * MINUTE_MS),
  });
}

/** Minutes between `expiresAt` and now, so a horizon can be asserted by size. */
function minutesFromNow(expiresAt: Date): number {
  return Math.round((expiresAt.getTime() - Date.now()) / MINUTE_MS);
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
function arrangeInsert(
  mockDb: MockDb,
  activeCount: number,
  landed = intentRow(),
): void {
  mockDb.limit.mockResolvedValueOnce([game]); // requireGame
  mockDb.returning.mockResolvedValueOnce([landed]); // insertIntent
  mockDb.groupBy.mockResolvedValueOnce([aggregate(activeCount)]);
  mockDb.limit.mockResolvedValueOnce([landed]); // buildResponse re-read
  mockDb.groupBy.mockResolvedValueOnce([aggregate(activeCount)]);
}

/**
 * The AC2 bump path: the insert loses the partial unique index, the surviving
 * LIVE row is re-read, and the guarded UPDATE returns it on the new clock.
 *
 * @param bumped - What the UPDATE returned; `[]` means it matched no active
 *   row (another request converted it) and the caller must keep `existing`.
 */
function arrangeBump(
  mockDb: MockDb,
  activeCount: number,
  bumped: object[] = [nowRow()],
): void {
  mockDb.limit.mockResolvedValueOnce([game]); // requireGame
  mockDb.returning.mockResolvedValueOnce([]); // insertIntent lost the conflict
  mockDb.limit.mockResolvedValueOnce([intentRow()]); // findActiveIntent (week)
  mockDb.returning.mockResolvedValueOnce(bumped); // bumpIntentUrgency
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
        urgency: 'week',
        ttlMinutes: null,
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

  // ROK-1479 AC1/AC2/AC4 — the urgency class the caller asked for has to reach
  // the INSERT, the bump has to land on the caller's own row rather than a
  // second one, and `LFM_REACHED` has to say which class completed the pair.
  describe('createIntent urgency (ROK-1479)', () => {
    /** The object handed to `.values()` by `insertIntent`. */
    const insertedValues = (): Record<string, unknown> =>
      mockDb.values.mock.calls[0][0] as Record<string, unknown>;

    // AC1 mutation: delete `.default('week')` from `CreateLfgIntentSchema` and
    // this fails on the VALUE (`undefined` vs `'week'`), not on a parse throw.
    it('writes the week horizon when the caller asks for no class at all', async () => {
      arrangeInsert(mockDb, 1);

      await service.createIntent(3, GAME_ID);

      expect(insertedValues()).toMatchObject({
        urgency: 'week',
        ttlMinutes: null,
      });
      expect(minutesFromNow(insertedValues().expiresAt as Date)).toBe(
        14 * 24 * 60,
      );
    });

    // AC1: an absent `ttlMinutes` on a `now` request means 30, and the stored
    // horizon is minutes rather than days.
    it('writes the 30-minute horizon for a now request with no ttlMinutes', async () => {
      arrangeInsert(mockDb, 1, nowRow());

      await service.createIntent(3, GAME_ID, { urgency: 'now' });

      expect(insertedValues()).toMatchObject({
        urgency: 'now',
        ttlMinutes: 30,
      });
      expect(minutesFromNow(insertedValues().expiresAt as Date)).toBe(30);
    });

    it('honours an explicit 60-minute ttl on a now request', async () => {
      arrangeInsert(mockDb, 1, nowRow());

      await service.createIntent(3, GAME_ID, {
        urgency: 'now',
        ttlMinutes: 60,
      });

      expect(insertedValues()).toMatchObject({
        urgency: 'now',
        ttlMinutes: 60,
      });
      expect(minutesFromNow(insertedValues().expiresAt as Date)).toBe(60);
    });

    // AC4 / D7: the payload reports the class of the row that actually landed.
    // Mutation: drop `urgency` from the emit and this fails on the payload
    // shape, naming the missing key.
    it('reports the completing intent class on LFM_REACHED', async () => {
      arrangeInsert(mockDb, 2, nowRow());

      await service.createIntent(3, GAME_ID, { urgency: 'now' });

      expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.LFM_REACHED, {
        gameId: GAME_ID,
        activeCount: 2,
        urgency: 'now',
        ttlMinutes: 30,
      });
    });

    // AC8a / D10: the affinity DM quotes this number ("Playing in the next N
    // minutes"), so it has to be the horizon the completing row actually
    // committed to — not the 30-minute default the DM used to assume.
    // Mutation: drop `ttlMinutes` from the emit in `announcePost` and this
    // fails on the VALUE (received payload has no `ttlMinutes`), naming 60.
    it('carries the completing row own TTL on LFM_REACHED', async () => {
      arrangeInsert(mockDb, 2, nowRow(60));

      await service.createIntent(3, GAME_ID, {
        urgency: 'now',
        ttlMinutes: 60,
      });

      expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.LFM_REACHED, {
        gameId: GAME_ID,
        activeCount: 2,
        urgency: 'now',
        ttlMinutes: 60,
      });
    });

    // The weekly counterpart: a week row has no TTL, and the payload must say
    // so explicitly rather than omitting the key — the DM's `?? 30` fallback
    // is reachable ONLY for `urgency: 'now'`.
    it('carries a null TTL when a weekly hand completes the pair', async () => {
      arrangeInsert(mockDb, 2);

      await service.createIntent(3, GAME_ID);

      const payload = emitter.emit.mock.calls[0][1] as Record<string, unknown>;
      expect(payload.ttlMinutes).toBeNull();
      expect(payload.urgency).toBe('week');
    });

    // AC2: the response is the BUMPED row, and `created` stays false so the
    // controller answers 200 rather than 201.
    it('bumps the caller own live row and answers 200, not 201', async () => {
      arrangeBump(mockDb, 1);

      const result = await service.createIntent(3, GAME_ID, {
        urgency: 'now',
      });

      expect(result.created).toBe(false);
      expect(result.body).toMatchObject({ id: 11, urgency: 'now' });
      expect(mockDb.set.mock.calls[0][0]).toMatchObject({
        urgency: 'now',
        ttlMinutes: 30,
      });
      // One UPDATE only — a bump must never become a second INSERT.
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    // D8: `emitGroupChanged` is documented as "a group that has ALREADY
    // reached LFM". A solo hand has no Discord post to re-render.
    it('stays silent when the bumped group is still a solo hand', async () => {
      arrangeBump(mockDb, 1);

      await service.createIntent(3, GAME_ID, { urgency: 'now' });

      expect(emittedNames()).toEqual([]);
    });

    it('emits GROUP_CHANGED bumped ALONE once the group is at LFM', async () => {
      arrangeBump(mockDb, 2);

      await service.createIntent(3, GAME_ID, { urgency: 'now' });

      expect(emittedNames()).toEqual([LFG_EVENTS.GROUP_CHANGED]);
      expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.GROUP_CHANGED, {
        gameId: GAME_ID,
        reason: 'bumped',
      });
      expect(emittedAfterCommit).toEqual([true]);
    });

    // Error matrix: the guarded UPDATE matched no row because another request
    // converted it. No throw, no retry, no event — the caller gets the row it
    // re-read, unchanged.
    it('reports the row unchanged when the guarded update matched nothing', async () => {
      arrangeBump(mockDb, 2, []);

      const result = await service.createIntent(3, GAME_ID, {
        urgency: 'now',
      });

      expect(result.created).toBe(false);
      expect(result.body).toMatchObject({ id: 11, urgency: 'week' });
      expect(emittedNames()).toEqual([]);
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
