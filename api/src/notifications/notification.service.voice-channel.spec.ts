/**
 * Tests for ROK-507 voice channel resolution methods on NotificationService.
 * Verifies resolveVoiceChannelId() and resolveVoiceChannelForEvent().
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { DiscordNotificationService } from './discord-notification.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('NotificationService — voice channel resolution (ROK-507)', () => {
  let service: NotificationService;
  let mockChannelResolver: {
    resolveVoiceChannelForScheduledEvent: jest.Mock;
  };
  let mockDb: {
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  /** Build a chainable Drizzle select that resolves via .limit(). */
  const makeSelectChain = (rows: unknown[] = []) => {
    const chain: Record<string, jest.Mock> = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    chain.orderBy = jest.fn().mockReturnValue(chain);
    chain.offset = jest.fn().mockReturnValue(chain);
    return chain;
  };

  beforeEach(async () => {
    mockChannelResolver = {
      resolveVoiceChannelForScheduledEvent: jest.fn().mockResolvedValue(null),
    };

    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: DiscordNotificationService,
          useValue: null, // Optional — not needed for voice channel tests
        },
        {
          provide: ChannelResolverService,
          useValue: mockChannelResolver,
        },
        {
          provide: CronJobService,
          useValue: {
            executeWithTracking: jest.fn(
              (_name: string, fn: () => Promise<void>) => fn(),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── resolveVoiceChannelId ───────────────────────────────────────────────

  describe('resolveVoiceChannelId', () => {
    it('delegates to channelResolver with the provided gameId', async () => {
      mockChannelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
        'voice-channel-123',
      );

      const result = await service.resolveVoiceChannelId(5);

      expect(
        mockChannelResolver.resolveVoiceChannelForScheduledEvent,
      ).toHaveBeenCalledWith(5);
      expect(result).toBe('voice-channel-123');
    });

    it('returns the resolved voice channel ID string', async () => {
      mockChannelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
        '999888777',
      );

      const result = await service.resolveVoiceChannelId(10);

      expect(result).toBe('999888777');
    });

    it('returns null when channelResolver returns null (no voice channel configured)', async () => {
      mockChannelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
        null,
      );

      const result = await service.resolveVoiceChannelId(99);

      expect(result).toBeNull();
    });

    it('passes null gameId to channelResolver when no game is associated', async () => {
      mockChannelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
        null,
      );

      await service.resolveVoiceChannelId(null);

      expect(
        mockChannelResolver.resolveVoiceChannelForScheduledEvent,
      ).toHaveBeenCalledWith(null);
    });

    it('passes undefined gameId to channelResolver when called without argument', async () => {
      mockChannelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
        null,
      );

      await service.resolveVoiceChannelId(undefined);

      expect(
        mockChannelResolver.resolveVoiceChannelForScheduledEvent,
      ).toHaveBeenCalledWith(undefined);
    });
  });

  // ─── resolveVoiceChannelForEvent ─────────────────────────────────────────

  describe('resolveVoiceChannelForEvent', () => {
    it('looks up event by ID and delegates to channelResolver with its gameId', async () => {
      const mockEvent = { gameId: 7 };
      mockDb.select.mockReturnValue(makeSelectChain([mockEvent]));
      mockChannelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
        'vc-from-game-7',
      );

      const result = await service.resolveVoiceChannelForEvent(42);

      expect(mockDb.select).toHaveBeenCalled();
      expect(
        mockChannelResolver.resolveVoiceChannelForScheduledEvent,
      ).toHaveBeenCalledWith(7);
      expect(result).toBe('vc-from-game-7');
    });

    it('returns null when event is not found', async () => {
      mockDb.select.mockReturnValue(makeSelectChain([])); // no event row

      const result = await service.resolveVoiceChannelForEvent(9999);

      expect(result).toBeNull();
      expect(
        mockChannelResolver.resolveVoiceChannelForScheduledEvent,
      ).not.toHaveBeenCalled();
    });

    it('returns null when event has no gameId (null)', async () => {
      const mockEvent = { gameId: null };
      mockDb.select.mockReturnValue(makeSelectChain([mockEvent]));
      mockChannelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
        null,
      );

      const result = await service.resolveVoiceChannelForEvent(50);

      expect(
        mockChannelResolver.resolveVoiceChannelForScheduledEvent,
      ).toHaveBeenCalledWith(null);
      expect(result).toBeNull();
    });

    it('returns null when channelResolver returns null for the event game', async () => {
      const mockEvent = { gameId: 3 };
      mockDb.select.mockReturnValue(makeSelectChain([mockEvent]));
      mockChannelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
        null,
      );

      const result = await service.resolveVoiceChannelForEvent(10);

      expect(result).toBeNull();
    });

    it('returns the voice channel ID string when resolved', async () => {
      const mockEvent = { gameId: 20 };
      mockDb.select.mockReturnValue(makeSelectChain([mockEvent]));
      mockChannelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
        '111222333444',
      );

      const result = await service.resolveVoiceChannelForEvent(99);

      expect(result).toBe('111222333444');
    });
  });

  // ─── when channelResolver is not injected (Optional) ─────────────────────

  describe('when ChannelResolverService is not provided (Optional)', () => {
    let serviceWithoutResolver: NotificationService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotificationService,
          { provide: DrizzleAsyncProvider, useValue: mockDb },
          {
            provide: DiscordNotificationService,
            useValue: null,
          },
          // ChannelResolverService NOT provided → will be null (Optional)
          {
            provide: CronJobService,
            useValue: {
              executeWithTracking: jest.fn(
                (_name: string, fn: () => Promise<void>) => fn(),
              ),
            },
          },
        ],
      }).compile();

      serviceWithoutResolver =
        module.get<NotificationService>(NotificationService);
    });

    it('resolveVoiceChannelId returns null when channelResolver is not injected', async () => {
      const result = await serviceWithoutResolver.resolveVoiceChannelId(5);
      expect(result).toBeNull();
    });

    it('resolveVoiceChannelForEvent returns null when channelResolver is not injected', async () => {
      const result =
        await serviceWithoutResolver.resolveVoiceChannelForEvent(42);
      expect(result).toBeNull();
    });
  });
});
