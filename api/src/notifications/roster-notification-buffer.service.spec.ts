import { Test, TestingModule } from '@nestjs/testing';
import {
  RosterNotificationBufferService,
  ROSTER_NOTIFY_GRACE_MS,
  type BufferedRosterAction,
} from './roster-notification-buffer.service';
import { NotificationService } from './notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

let service: RosterNotificationBufferService;
let mockNotificationService: {
  create: jest.Mock;
  getDiscordEmbedUrl: jest.Mock;
  resolveVoiceChannelForEvent: jest.Mock;
};
let mockDb: { select: jest.Mock };

/** Build a chainable Drizzle select that resolves via .limit(). */
function makeSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.innerJoin = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  return chain;
}

const baseAction: BufferedRosterAction = {
  organizerId: 100,
  eventId: 1,
  eventTitle: 'DM 5 man',
  userId: 42,
  displayName: 'HealzForDayz',
  vacatedRole: 'dps',
};

async function setupEach() {
  mockNotificationService = {
    create: jest.fn().mockResolvedValue(null),
    getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
    resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
  };

  mockDb = { select: jest.fn() };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RosterNotificationBufferService,
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();

  service = module.get(RosterNotificationBufferService);
  jest.useFakeTimers();
}

async function testBufferLeaveFiresAfterGrace() {
  mockDb.select.mockReturnValue(makeSelectChain([]));
  service.bufferLeave(baseAction);
  expect(service.pendingCount).toBe(1);

  jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
  await jest.runAllTimersAsync();

  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: baseAction.organizerId,
      type: 'slot_vacated',
      title: 'Slot Vacated',
      message: 'HealzForDayz left the dps slot for DM 5 man',
    }),
  );
  expect(service.pendingCount).toBe(0);
}

async function testResetsGraceTimerOnReLeave() {
  mockDb.select.mockReturnValue(makeSelectChain([]));
  service.bufferLeave(baseAction);

  jest.advanceTimersByTime(2 * 60 * 1000);
  service.bufferLeave({ ...baseAction, vacatedRole: 'healer' });
  jest.advanceTimersByTime(2 * 60 * 1000);

  expect(mockNotificationService.create).not.toHaveBeenCalled();

  jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS);
  await jest.runAllTimersAsync();

  expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'HealzForDayz left the healer slot for DM 5 man',
    }),
  );
}

async function testJoinedNotificationOnSlotMove() {
  mockDb.select.mockReturnValue(makeSelectChain([{ role: 'healer' }]));
  service.bufferLeave(baseAction);

  jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
  await jest.runAllTimersAsync();

  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: baseAction.organizerId,
      type: 'slot_vacated',
      title: 'Roster Change',
      message: 'HealzForDayz joined the healer slot for DM 5 man',
    }),
  );
}

async function testBufferJoinResetsTimer() {
  mockDb.select.mockReturnValue(makeSelectChain([{ role: 'healer' }]));
  service.bufferLeave(baseAction);

  jest.advanceTimersByTime(60 * 1000);
  service.bufferJoin(baseAction.eventId, baseAction.userId);

  jest.advanceTimersByTime(2 * 60 * 1000);
  expect(mockNotificationService.create).not.toHaveBeenCalled();

  jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS);
  await jest.runAllTimersAsync();

  expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
}

async function testIncludesDiscordUrlAndVoiceChannel() {
  mockDb.select.mockReturnValue(makeSelectChain([]));
  mockNotificationService.getDiscordEmbedUrl.mockResolvedValue(
    'https://discord.com/channels/1/2/3',
  );
  mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(
    'vc-123',
  );

  service.bufferLeave(baseAction);

  jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
  await jest.runAllTimersAsync();

  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: {
        eventId: 1,
        discordUrl: 'https://discord.com/channels/1/2/3',
        voiceChannelId: 'vc-123',
      },
    }),
  );
}

describe('RosterNotificationBufferService (ROK-534)', () => {
  beforeEach(() => setupEach());

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('buffers a leave action and fires notification after grace period', () =>
    testBufferLeaveFiresAfterGrace());

  it('resets the grace timer when the same user leaves again', () =>
    testResetsGraceTimerOnReLeave());

  it('sends "joined" notification when user moved to a different slot', () =>
    testJoinedNotificationOnSlotMove());

  it('skips notification when user returned to the same slot', async () => {
    mockDb.select.mockReturnValue(makeSelectChain([{ role: 'dps' }]));
    service.bufferLeave(baseAction);

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).not.toHaveBeenCalled();
  });

  it('bufferJoin resets the timer for an existing buffer entry', () =>
    testBufferJoinResetsTimer());

  it('bufferJoin is a no-op when there is nothing buffered', () => {
    service.bufferJoin(999, 999);
    expect(service.pendingCount).toBe(0);
  });

  it('handles multiple users on same event independently', async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));

    service.bufferLeave(baseAction);
    service.bufferLeave({
      ...baseAction,
      userId: 99,
      displayName: 'TankBro',
      vacatedRole: 'tank',
    });
    expect(service.pendingCount).toBe(2);

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
  });

  it('includes discord URL and voice channel in notification payload', () =>
    testIncludesDiscordUrlAndVoiceChannel());

  it('onModuleDestroy clears all pending timers', () => {
    service.bufferLeave(baseAction);
    expect(service.pendingCount).toBe(1);

    service.onModuleDestroy();
    expect(service.pendingCount).toBe(0);
  });

  it('flushAll forces immediate flush of all entries', async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));

    service.bufferLeave(baseAction);
    service.bufferLeave({
      ...baseAction,
      userId: 99,
      displayName: 'TankBro',
      vacatedRole: 'tank',
    });

    await service.flushAll();

    expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    expect(service.pendingCount).toBe(0);
  });
});
