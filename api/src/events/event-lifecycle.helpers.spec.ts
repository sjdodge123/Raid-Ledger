/**
 * Unit tests for event-lifecycle.helpers.ts.
 */
import { createMockEvent } from '../common/testing/factories';
import { rescheduleEvent } from './event-lifecycle.helpers';

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
