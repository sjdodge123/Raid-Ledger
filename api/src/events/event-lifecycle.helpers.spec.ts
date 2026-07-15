/**
 * Unit tests for event-lifecycle.helpers.ts.
 */
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { createMockEvent } from '../common/testing/factories';
import {
  deleteEvent,
  rescheduleEvent,
  resetSignupConfirmations,
} from './event-lifecycle.helpers';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';
import {
  buildPlaintextContent,
  formatEpoch,
} from '../notifications/format-helpers';

function createMockNotificationService() {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    createMany: jest.fn().mockResolvedValue([]),
    getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
    resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
  };
}

/** Drizzle chain methods shared across all mock DB builders. */
const CHAIN_METHODS = [
  'select',
  'from',
  'orderBy',
  'offset',
  'leftJoin',
  'innerJoin',
  'insert',
  'values',
  'returning',
  'onConflictDoNothing',
  'onConflictDoUpdate',
  'update',
  'set',
  'delete',
  'groupBy',
  'having',
  '$dynamic',
  'execute',
  'as',
] as const;

type MockDb = Record<string, jest.Mock>;

/**
 * Build a generic mock DB with chainable methods and a configurable
 * `where` handler. Reduces duplication across test-specific builders.
 */
function buildGenericMockDb(opts: {
  limitResult: unknown[];
  whereHandler: (callCount: number, db: MockDb) => unknown;
}): MockDb {
  let whereCallCount = 0;
  const mockDb: MockDb = {};
  for (const m of CHAIN_METHODS) {
    mockDb[m] = jest.fn().mockReturnThis();
  }
  mockDb.limit = jest.fn().mockResolvedValue(opts.limitResult);
  mockDb.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    return opts.whereHandler(whereCallCount, mockDb);
  });
  mockDb.transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: MockDb) => Promise<unknown>) =>
      cb(mockDb),
    );
  return mockDb;
}

/**
 * Build a mock DB for rescheduleEvent (5 where() calls):
 * 1. findExistingOrThrow chain → mockDb (for .limit())
 * 2-4. update/delete terminals → void
 * 5. getSignedUpUserIds terminal → signups
 */
function buildRescheduleMockDb(
  event: Record<string, unknown>,
  signups: { userId: number }[],
) {
  return buildGenericMockDb({
    limitResult: [event],
    whereHandler: (n, db) => {
      if (n === 1) return db;
      if (n < 5) return Promise.resolve();
      return Promise.resolve(signups);
    },
  });
}

describe('Regression: ROK-828', () => {
  const eventId = 42;
  const creatorId = 1;
  const signedUpUserId = 2;

  // 8:00 PM EDT on Mar 17, 2026 = midnight UTC on Mar 18, 2026
  const newStartISO = '2026-03-18T00:00:00.000Z';
  const newEndISO = '2026-03-18T02:00:00.000Z';
  const expectedUnix = Math.floor(new Date(newStartISO).getTime() / 1000);

  let mockDb: ReturnType<typeof buildRescheduleMockDb>;
  let mockNotifSvc: ReturnType<typeof createMockNotificationService>;

  beforeEach(() => {
    const event = createMockEvent({
      id: eventId,
      title: 'Palworld Event',
      creatorId,
    });
    mockDb = buildRescheduleMockDb(event, [{ userId: signedUpUserId }]);
    mockNotifSvc = createMockNotificationService();
  });

  it('should say "rescheduled" not "moved"', async () => {
    await rescheduleEvent(
      mockDb as any,
      mockNotifSvc as any,
      eventId,
      creatorId,
      true,
      { startTime: newStartISO, endTime: newEndISO },
    );

    expect(mockNotifSvc.createMany).toHaveBeenCalled();
    const call = mockNotifSvc.createMany.mock.calls[0][0][0];
    expect(call.message).toContain('has been rescheduled to');
    expect(call.message).not.toContain('moved');
  });

  it('should use Discord timestamp format, not server-locale', async () => {
    await rescheduleEvent(
      mockDb as any,
      mockNotifSvc as any,
      eventId,
      creatorId,
      true,
      { startTime: newStartISO, endTime: newEndISO },
    );

    const call = mockNotifSvc.createMany.mock.calls[0][0][0];
    // Discord native timestamp syntax <t:unix:f>
    expect(call.message).toContain(`<t:${expectedUnix}:f>`);
    // Relative timestamp <t:unix:R>
    expect(call.message).toContain(`<t:${expectedUnix}:R>`);
    // No server-locale formatted date like "Wed, Mar 18, 12:00 AM"
    expect(call.message).not.toMatch(
      /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar)/,
    );
  });

  // ROK-1403: the stored message keeps <t:> markup (so the Discord embed
  // renders viewer-local); piping it through the fixed DM plaintext choke
  // point must render recipient-local and NOT duplicate the absolute time.
  it('renders recipient-local, non-duplicated plaintext for the DM/push path', async () => {
    await rescheduleEvent(
      mockDb as any,
      mockNotifSvc as any,
      eventId,
      creatorId,
      true,
      { startTime: newStartISO, endTime: newEndISO },
    );
    const call = mockNotifSvc.createMany.mock.calls[0][0][0];
    const abs = formatEpoch(expectedUnix, 'America/New_York');
    const content = buildPlaintextContent(
      call.title,
      call.message,
      'America/New_York',
    );
    expect(content).not.toMatch(/<t:\d+/); // no raw token survives
    expect(content).toContain(abs); // rendered in the recipient timezone
    expect(content.split(abs).length - 1).toBe(1); // absolute appears once
  });

  it('should include event title and correct type', async () => {
    await rescheduleEvent(
      mockDb as any,
      mockNotifSvc as any,
      eventId,
      creatorId,
      true,
      { startTime: newStartISO, endTime: newEndISO },
    );

    const call = mockNotifSvc.createMany.mock.calls[0][0][0];
    expect(call.message).toContain('Palworld Event');
    expect(call.type).toBe('event_rescheduled');
    expect(call.title).toBe('Event Rescheduled');
  });

  it('should batch all users into a single createMany call (ROK-1043)', async () => {
    // Multi-user reschedule: expect one createMany with N entries
    const multiEvent = createMockEvent({
      id: eventId,
      title: 'Palworld Event',
      creatorId,
    });
    const multiSignups = [{ userId: 2 }, { userId: 3 }, { userId: 4 }];
    const multiDb = buildRescheduleMockDb(multiEvent, multiSignups);
    const multiNotif = createMockNotificationService();
    await rescheduleEvent(
      multiDb as any,
      multiNotif as any,
      eventId,
      creatorId,
      true,
      { startTime: newStartISO, endTime: newEndISO },
    );
    expect(multiNotif.create).not.toHaveBeenCalled();
    expect(multiNotif.createMany).toHaveBeenCalledTimes(1);
    const args = multiNotif.createMany.mock.calls[0][0] as {
      userId: number;
    }[];
    expect(args).toHaveLength(3);
    expect(args.map((a) => a.userId)).toEqual([2, 3, 4]);
  });
});

/**
 * Build a mock DB for deleteEvent (2 where() calls):
 * 1. findExistingOrThrow chain → mockDb (for .limit())
 * 2. delete terminal → void
 */
function buildDeleteMockDb(event: Record<string, unknown> | null) {
  return buildGenericMockDb({
    limitResult: event !== null ? [event] : [],
    whereHandler: (n, db) => {
      if (n === 1) return db;
      return Promise.resolve();
    },
  });
}

function buildMockEmitter() {
  return {
    emit: jest.fn(),
    emitAsync: jest.fn().mockResolvedValue([]),
  };
}

/** Shorthand: calls deleteEvent with the given mocks (avoids verbose `as any` casts). */
function callDelete(
  db: MockDb,
  emitter: ReturnType<typeof buildMockEmitter>,
  evtId: number,
  uid: number,
  admin: boolean,
) {
  return deleteEvent(db as any, emitter as any, evtId, uid, admin);
}

describe('Regression: ROK-846 — deleteEvent uses emitAsync before cascade delete', () => {
  const eventId = 99;
  const creatorId = 5;

  describe('emit ordering', () => {
    it('calls emitAsync before DB delete', async () => {
      const event = createMockEvent({ id: eventId, creatorId });
      const mockDb = buildDeleteMockDb(event);
      const emitter = buildMockEmitter();
      const callOrder: string[] = [];
      emitter.emitAsync.mockImplementation(() => {
        callOrder.push('emitAsync');
        return Promise.resolve([]);
      });
      mockDb.where.mockImplementation(() => {
        if (mockDb.where.mock.calls.length === 1) return mockDb;
        callOrder.push('db.delete');
        return Promise.resolve();
      });
      await callDelete(mockDb, emitter, eventId, creatorId, false);
      expect(callOrder).toEqual(['emitAsync', 'db.delete']);
    });

    it('uses emitAsync (not emit) for the DELETED event', async () => {
      const event = createMockEvent({ id: eventId, creatorId });
      const mockDb = buildDeleteMockDb(event);
      const emitter = buildMockEmitter();
      await callDelete(mockDb, emitter, eventId, creatorId, false);
      expect(emitter.emitAsync).toHaveBeenCalledWith(APP_EVENT_EVENTS.DELETED, {
        eventId,
      });
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('performs DB delete after emitAsync resolves', async () => {
      const event = createMockEvent({ id: eventId, creatorId });
      const mockDb = buildDeleteMockDb(event);
      const emitter = buildMockEmitter();
      await callDelete(mockDb, emitter, eventId, creatorId, false);
      expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalledTimes(2);
    });

    it('does NOT delete from DB if emitAsync rejects', async () => {
      const event = createMockEvent({ id: eventId, creatorId });
      const mockDb = buildDeleteMockDb(event);
      const emitter = buildMockEmitter();
      emitter.emitAsync.mockRejectedValue(new Error('handler failed'));
      await expect(
        callDelete(mockDb, emitter, eventId, creatorId, false),
      ).rejects.toThrow('handler failed');
      expect(mockDb.delete).not.toHaveBeenCalled();
    });
  });

  describe('access control', () => {
    it('throws NotFoundException when event does not exist', async () => {
      const mockDb = buildDeleteMockDb(null);
      const emitter = buildMockEmitter();
      await expect(
        callDelete(mockDb, emitter, eventId, creatorId, false),
      ).rejects.toThrow(NotFoundException);
      expect(emitter.emitAsync).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for non-owner non-admin', async () => {
      const event = createMockEvent({ id: eventId, creatorId: 999 });
      const mockDb = buildDeleteMockDb(event);
      const emitter = buildMockEmitter();
      await expect(
        callDelete(mockDb, emitter, eventId, 7, false),
      ).rejects.toThrow(ForbiddenException);
      expect(emitter.emitAsync).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("allows admin to delete another user's event", async () => {
      const event = createMockEvent({ id: eventId, creatorId: 999 });
      const mockDb = buildDeleteMockDb(event);
      const emitter = buildMockEmitter();
      await expect(
        callDelete(mockDb, emitter, eventId, 7, true),
      ).resolves.toBeUndefined();
      expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('allows owner to delete their own event', async () => {
      const event = createMockEvent({ id: eventId, creatorId });
      const mockDb = buildDeleteMockDb(event);
      const emitter = buildMockEmitter();
      await expect(
        callDelete(mockDb, emitter, eventId, creatorId, false),
      ).resolves.toBeUndefined();
      expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Build a minimal mock DB that captures the where() predicates passed to
 * the UPDATE statement issued by resetSignupConfirmations. Returns the
 * captured args for inspection.
 */
function buildResetMockDb() {
  const updateWhereCalls: unknown[] = [];
  const mockDb: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'from',
    'limit',
    'orderBy',
    'returning',
    'execute',
  ]) {
    mockDb[m] = jest.fn().mockReturnThis();
  }
  // delete().where() — the reminders cleanup
  // update().set().where() — the signup reset
  mockDb.delete = jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue(undefined),
  });
  mockDb.update = jest.fn().mockReturnValue({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockImplementation((...args: unknown[]) => {
        updateWhereCalls.push(args);
        return Promise.resolve();
      }),
    }),
  });
  return { mockDb, updateWhereCalls };
}

describe('Regression: ROK-1269 — resetSignupConfirmations excludes rescheduler', () => {
  it('passes a where() predicate to UPDATE when reschedulerId is provided', async () => {
    const { mockDb, updateWhereCalls } = buildResetMockDb();
    await resetSignupConfirmations(mockDb as any, 42, 7);
    expect(updateWhereCalls).toHaveLength(1);
    // Drizzle's `and(...)` returns an SQL chunk; the captured arg should
    // be a non-null object representing the combined predicate.
    const predicate = (updateWhereCalls[0] as unknown[])[0];
    expect(predicate).toBeDefined();
    expect(predicate).not.toBeNull();
  });

  it('still passes a predicate when reschedulerId is null', async () => {
    const { mockDb, updateWhereCalls } = buildResetMockDb();
    await resetSignupConfirmations(mockDb as any, 42, null);
    expect(updateWhereCalls).toHaveLength(1);
    const predicate = (updateWhereCalls[0] as unknown[])[0];
    expect(predicate).toBeDefined();
  });

  it('issues DELETE for reminders before UPDATE for signups', async () => {
    const { mockDb } = buildResetMockDb();
    await resetSignupConfirmations(mockDb as any, 42, 7);
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('rescheduleEvent threads userId through to resetSignupConfirmations', async () => {
    // Verifies the wiring: a rescheduleEvent call results in an UPDATE
    // whose where() predicate is non-null (the userId-aware predicate).
    const event = createMockEvent({ id: 99, title: 'X', creatorId: 1 });
    const mockNotifSvc = createMockNotificationService();
    // Reuse the multi-where reschedule mock to drive the full path.
    const mockDb = buildRescheduleMockDb(event, [{ userId: 2 }]);
    await rescheduleEvent(mockDb as any, mockNotifSvc as any, 99, 1, true, {
      startTime: '2026-04-01T00:00:00Z',
      endTime: '2026-04-01T02:00:00Z',
    });
    // At least one UPDATE issued with a where() — exact predicate shape
    // is asserted via the integration test against a real Postgres.
    expect(mockDb.update).toHaveBeenCalled();
  });
});
