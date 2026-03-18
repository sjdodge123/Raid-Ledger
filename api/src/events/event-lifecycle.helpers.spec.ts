/**
 * Unit tests for event-lifecycle.helpers.ts.
 */
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { createMockEvent } from '../common/testing/factories';
import { deleteEvent, rescheduleEvent } from './event-lifecycle.helpers';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';

function createMockNotificationService() {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
    resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
  };
}

/**
 * Build a mock DB that handles the rescheduleEvent query chain:
 * 1. findExistingOrThrow: select().from().where().limit() → [event]
 * 2. update().set().where() (event update) → void
 * 3. delete().where() (reset reminders) → void
 * 4. update().set().where() (reset signups) → void
 * 5. select().from().where() (getSignedUpUserIds) → signups
 */
function buildRescheduleMockDb(
  event: Record<string, unknown>,
  signups: { userId: number }[],
) {
  let whereCallCount = 0;
  const mockDb: Record<string, jest.Mock> = {};
  const chainMethods = [
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
  ];
  for (const m of chainMethods) {
    mockDb[m] = jest.fn().mockReturnThis();
  }
  // limit is terminal for findExistingOrThrow
  mockDb.limit = jest.fn().mockResolvedValue([event]);
  // where: returns this for chaining (calls 1-4), returns signups for call 5
  mockDb.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    // Call 1: findExistingOrThrow chain (needs .limit())
    if (whereCallCount === 1) return mockDb;
    // Calls 2-4: update/delete terminals (awaited, resolve to mock)
    if (whereCallCount < 5) return Promise.resolve();
    // Call 5: getSignedUpUserIds terminal
    return Promise.resolve(signups);
  });
  mockDb.transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) =>
      cb(mockDb),
    );
  return mockDb;
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

    expect(mockNotifSvc.create).toHaveBeenCalled();
    const call = mockNotifSvc.create.mock.calls[0][0];
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

    const call = mockNotifSvc.create.mock.calls[0][0];
    // Discord native timestamp syntax <t:unix:f>
    expect(call.message).toContain(`<t:${expectedUnix}:f>`);
    // Relative timestamp <t:unix:R>
    expect(call.message).toContain(`<t:${expectedUnix}:R>`);
    // No server-locale formatted date like "Wed, Mar 18, 12:00 AM"
    expect(call.message).not.toMatch(
      /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar)/,
    );
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

    const call = mockNotifSvc.create.mock.calls[0][0];
    expect(call.message).toContain('Palworld Event');
    expect(call.type).toBe('event_rescheduled');
    expect(call.title).toBe('Event Rescheduled');
  });
});

/**
 * Build a mock DB for deleteEvent:
 * 1. findExistingOrThrow: select().from().where().limit() → [event]
 * 2. delete().where() → void
 */
function buildDeleteMockDb(event: Record<string, unknown> | null) {
  let whereCallCount = 0;
  const mockDb: Record<string, jest.Mock> = {};
  const chainMethods = [
    'select',
    'from',
    'update',
    'set',
    'insert',
    'values',
    'returning',
    'delete',
    'orderBy',
    'offset',
    'leftJoin',
    'innerJoin',
    'groupBy',
    'having',
    '$dynamic',
    'execute',
    'as',
    'onConflictDoNothing',
    'onConflictDoUpdate',
  ];
  for (const m of chainMethods) {
    mockDb[m] = jest.fn().mockReturnThis();
  }
  // limit is terminal for findExistingOrThrow
  mockDb.limit = jest.fn().mockResolvedValue(event !== null ? [event] : []);
  // where: call 1 returns this (for chaining into .limit()), call 2 resolves (DB delete)
  mockDb.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    if (whereCallCount === 1) return mockDb;
    return Promise.resolve();
  });
  mockDb.transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) =>
      cb(mockDb),
    );
  return mockDb;
}

describe('Regression: ROK-846 — deleteEvent uses emitAsync before cascade delete', () => {
  const eventId = 99;
  const creatorId = 5;

  function buildMockEmitter() {
    return {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue([]),
    };
  }

  it('calls emitAsync with DELETED event before DB delete', async () => {
    const event = createMockEvent({ id: eventId, creatorId });
    const mockDb = buildDeleteMockDb(event);
    const emitter = buildMockEmitter();
    const callOrder: string[] = [];

    emitter.emitAsync.mockImplementation(() => {
      callOrder.push('emitAsync');
      return Promise.resolve([]);
    });
    mockDb.where.mockImplementation(() => {
      // The second where() call is the DB delete
      if (mockDb.where.mock.calls.length === 1) return mockDb;
      callOrder.push('db.delete');
      return Promise.resolve();
    });

    await deleteEvent(mockDb as any, emitter as any, eventId, creatorId, false);

    expect(callOrder).toEqual(['emitAsync', 'db.delete']);
  });

  it('uses emitAsync (not emit) for the DELETED event', async () => {
    const event = createMockEvent({ id: eventId, creatorId });
    const mockDb = buildDeleteMockDb(event);
    const emitter = buildMockEmitter();

    await deleteEvent(mockDb as any, emitter as any, eventId, creatorId, false);

    expect(emitter.emitAsync).toHaveBeenCalledWith(APP_EVENT_EVENTS.DELETED, {
      eventId,
    });
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('performs DB delete after emitAsync resolves', async () => {
    const event = createMockEvent({ id: eventId, creatorId });
    const mockDb = buildDeleteMockDb(event);
    const emitter = buildMockEmitter();

    await deleteEvent(mockDb as any, emitter as any, eventId, creatorId, false);

    // Both emitAsync and DB delete should have been called
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
      deleteEvent(mockDb as any, emitter as any, eventId, creatorId, false),
    ).rejects.toThrow('handler failed');

    // DB delete should NOT have been called since emitAsync threw
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when event does not exist', async () => {
    const mockDb = buildDeleteMockDb(null);
    const emitter = buildMockEmitter();

    await expect(
      deleteEvent(mockDb as any, emitter as any, eventId, creatorId, false),
    ).rejects.toThrow(NotFoundException);

    expect(emitter.emitAsync).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when non-owner non-admin tries to delete', async () => {
    const event = createMockEvent({ id: eventId, creatorId: 999 });
    const mockDb = buildDeleteMockDb(event);
    const emitter = buildMockEmitter();
    const differentUserId = 7;

    await expect(
      deleteEvent(
        mockDb as any,
        emitter as any,
        eventId,
        differentUserId,
        false,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(emitter.emitAsync).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("allows admin to delete another user's event", async () => {
    const event = createMockEvent({ id: eventId, creatorId: 999 });
    const mockDb = buildDeleteMockDb(event);
    const emitter = buildMockEmitter();
    const adminUserId = 7;

    await expect(
      deleteEvent(mockDb as any, emitter as any, eventId, adminUserId, true),
    ).resolves.toBeUndefined();

    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('allows owner to delete their own event', async () => {
    const event = createMockEvent({ id: eventId, creatorId });
    const mockDb = buildDeleteMockDb(event);
    const emitter = buildMockEmitter();

    await expect(
      deleteEvent(mockDb as any, emitter as any, eventId, creatorId, false),
    ).resolves.toBeUndefined();

    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
  });
});
