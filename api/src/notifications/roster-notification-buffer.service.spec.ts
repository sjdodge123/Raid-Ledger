import { Test, TestingModule } from '@nestjs/testing';
import {
  RosterNotificationBufferService,
  ROSTER_NOTIFY_GRACE_MS,
  type BufferedRosterAction,
} from './roster-notification-buffer.service';
import { NotificationService } from './notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('RosterNotificationBufferService (ROK-534)', () => {
  let service: RosterNotificationBufferService;
  let mockNotificationService: {
    create: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  let mockDb: {
    select: jest.Mock;
  };

  /** Build a chainable Drizzle select that resolves via .limit(). */
  const makeSelectChain = (rows: unknown[] = []) => {
    const chain: Record<string, jest.Mock> = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.innerJoin = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    return chain;
  };

  const baseAction: BufferedRosterAction = {
    organizerId: 100,
    eventId: 1,
    eventTitle: 'DM 5 man',
    userId: 42,
    displayName: 'HealzForDayz',
    vacatedRole: 'dps',
  };

  beforeEach(async () => {
    mockNotificationService = {
      create: jest.fn().mockResolvedValue(null),
      getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
    };

    mockDb = {
      select: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RosterNotificationBufferService,
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    service = module.get(RosterNotificationBufferService);
    jest.useFakeTimers();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('buffers a leave action and fires notification after grace period', async () => {
    // User has no roster assignment after leaving
    mockDb.select.mockReturnValue(makeSelectChain([]));

    service.bufferLeave(baseAction);
    expect(service.pendingCount).toBe(1);

    // Advance past grace period
    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);

    // Allow promises to flush
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
  });

  it('resets the grace timer when the same user leaves again', async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));

    service.bufferLeave(baseAction);

    // Advance 2 minutes (before grace period expires)
    jest.advanceTimersByTime(2 * 60 * 1000);

    // Same user leaves again with a different role
    service.bufferLeave({ ...baseAction, vacatedRole: 'healer' });

    // Advance another 2 minutes (total 4 min from first, 2 min from second)
    jest.advanceTimersByTime(2 * 60 * 1000);

    // Should NOT have fired yet (only 2 min since last action)
    expect(mockNotificationService.create).not.toHaveBeenCalled();

    // Advance past the remaining grace period
    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS);
    await jest.runAllTimersAsync();

    // Should fire once with the latest vacated role
    expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'HealzForDayz left the healer slot for DM 5 man',
      }),
    );
  });

  it('sends "joined" notification when user moved to a different slot', async () => {
    // User is now in healer slot (moved from dps)
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
  });

  it('skips notification when user returned to the same slot', async () => {
    // User is back in the same dps slot
    mockDb.select.mockReturnValue(makeSelectChain([{ role: 'dps' }]));

    service.bufferLeave(baseAction);

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).not.toHaveBeenCalled();
  });

  it('bufferJoin resets the timer for an existing buffer entry', async () => {
    mockDb.select.mockReturnValue(makeSelectChain([{ role: 'healer' }]));

    service.bufferLeave(baseAction);

    // User rejoins after 1 minute
    jest.advanceTimersByTime(60 * 1000);
    service.bufferJoin(baseAction.eventId, baseAction.userId);

    // Advance 2 minutes (2 min since join, but still within 3 min)
    jest.advanceTimersByTime(2 * 60 * 1000);
    expect(mockNotificationService.create).not.toHaveBeenCalled();

    // Advance past grace from the join
    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS);
    await jest.runAllTimersAsync();

    // Net result: moved to healer
    expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
  });

  it('bufferJoin is a no-op when there is nothing buffered', () => {
    service.bufferJoin(999, 999);
    expect(service.pendingCount).toBe(0);
  });

  it('handles multiple users on same event independently', async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));

    const action2: BufferedRosterAction = {
      ...baseAction,
      userId: 99,
      displayName: 'TankBro',
      vacatedRole: 'tank',
    };

    service.bufferLeave(baseAction);
    service.bufferLeave(action2);
    expect(service.pendingCount).toBe(2);

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
  });

  it('includes discord URL and voice channel in notification payload', async () => {
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
  });

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
