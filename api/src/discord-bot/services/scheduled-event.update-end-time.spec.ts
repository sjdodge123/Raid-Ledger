/**
 * Tests for ScheduledEventService.updateEndTime() — ROK-576.
 * Kept in a separate file to avoid growing scheduled-event.service.spec.ts further.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordAPIError } from 'discord.js';
import { ScheduledEventService } from './scheduled-event.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

/** Build a DiscordAPIError mock that satisfies `instanceof DiscordAPIError` checks. */
function makeDiscordApiError(code: number, message = 'Discord API error') {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.defineProperty(err, 'code', {
    value: code,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(err, 'message', {
    value: message,
    writable: true,
    configurable: true,
  });
  return err;
}

/** Build a chainable Drizzle select mock resolving at `.limit()`. */
function createSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  return chain;
}

/** Build a chainable Drizzle update mock. */
function createUpdateChain() {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
}

describe('ScheduledEventService — updateEndTime (ROK-576)', () => {
  let service: ScheduledEventService;
  let mockDb: { select: jest.Mock; update: jest.Mock };
  let mockGuild: {
    scheduledEvents: {
      edit: jest.Mock;
      fetch: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockGuild = {
      scheduledEvents: {
        create: jest.fn().mockResolvedValue({ id: 'se-1' }),
        edit: jest.fn().mockResolvedValue({ id: 'se-1' }),
        delete: jest.fn().mockResolvedValue(undefined),
        fetch: jest.fn().mockResolvedValue({ id: 'se-1' }),
      },
    };

    mockDb = {
      select: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduledEventService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            getGuild: jest.fn().mockReturnValue(mockGuild),
          },
        },
        {
          provide: ChannelResolverService,
          useValue: {
            resolveVoiceChannelForScheduledEvent: jest
              .fn()
              .mockResolvedValue('vc-1'),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getClientUrl: jest.fn().mockResolvedValue('https://raidledger.app'),
          },
        },
        {
          provide: CronJobService,
          useValue: {
            executeWithTracking: jest
              .fn()
              .mockImplementation((_name: string, fn: () => Promise<void>) =>
                fn(),
              ),
          },
        },
      ],
    }).compile();

    service = module.get(ScheduledEventService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updateEndTime', () => {
    it('calls guild.scheduledEvents.edit with scheduledEndTime when event has a Discord ID', async () => {
      const newEndTime = new Date(Date.now() + 30 * 60 * 1000);
      mockDb.select.mockReturnValue(
        createSelectChain([{ discordScheduledEventId: 'se-1' }]),
      );

      await service.updateEndTime(42, newEndTime);

      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-1', {
        scheduledEndTime: newEndTime,
      });
    });

    it('does NOT include other fields (name, status, etc.) in the edit call', async () => {
      const newEndTime = new Date(Date.now() + 30 * 60 * 1000);
      mockDb.select.mockReturnValue(
        createSelectChain([{ discordScheduledEventId: 'se-1' }]),
      );

      await service.updateEndTime(42, newEndTime);

      const editArg = mockGuild.scheduledEvents.edit.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(editArg).not.toHaveProperty('name');
      expect(editArg).not.toHaveProperty('status');
      expect(editArg).not.toHaveProperty('description');
    });

    it('skips when bot is not connected', async () => {
      const clientService = service[
        'clientService'
      ] as jest.Mocked<DiscordBotClientService>;
      (clientService.isConnected as jest.Mock).mockReturnValue(false);

      await service.updateEndTime(42, new Date());

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('skips when no guild is available', async () => {
      const clientService = service[
        'clientService'
      ] as jest.Mocked<DiscordBotClientService>;
      (clientService.getGuild as jest.Mock).mockReturnValue(null);

      await service.updateEndTime(42, new Date());

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('skips when DB has no discordScheduledEventId for the event', async () => {
      mockDb.select.mockReturnValue(
        createSelectChain([{ discordScheduledEventId: null }]),
      );

      await service.updateEndTime(42, new Date());

      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('skips when DB returns no rows for the event', async () => {
      mockDb.select.mockReturnValue(createSelectChain([]));

      await service.updateEndTime(42, new Date());

      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('clears discordScheduledEventId in DB when Discord returns 10070 (deleted in Discord)', async () => {
      mockDb.select.mockReturnValue(
        createSelectChain([{ discordScheduledEventId: 'deleted-se' }]),
      );
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      const unknownError = makeDiscordApiError(
        10070,
        'Unknown Scheduled Event',
      );
      mockGuild.scheduledEvents.edit.mockRejectedValue(unknownError);

      await service.updateEndTime(42, new Date());

      expect(updateChain.set).toHaveBeenCalledWith({
        discordScheduledEventId: null,
      });
    });

    it('does not propagate errors on other Discord API failures — logs and swallows', async () => {
      mockDb.select.mockReturnValue(
        createSelectChain([{ discordScheduledEventId: 'se-1' }]),
      );
      mockGuild.scheduledEvents.edit.mockRejectedValue(
        new Error('Rate limited'),
      );

      await expect(
        service.updateEndTime(42, new Date()),
      ).resolves.not.toThrow();
    });

    it('passes the exact newEndTime Date object to Discord', async () => {
      const newEndTime = new Date('2026-03-01T22:30:00Z');
      mockDb.select.mockReturnValue(
        createSelectChain([{ discordScheduledEventId: 'se-2' }]),
      );

      await service.updateEndTime(100, newEndTime);

      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-2', {
        scheduledEndTime: newEndTime,
      });
    });
  });
});
