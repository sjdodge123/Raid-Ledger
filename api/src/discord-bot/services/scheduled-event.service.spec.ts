/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  DiscordAPIError,
} from 'discord.js';
import { ScheduledEventService } from './scheduled-event.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { ScheduledEventData } from './scheduled-event.service';

/** Build a DiscordAPIError mock that satisfies `instanceof DiscordAPIError` checks. */
function makeDiscordApiError(code: number, message = 'Discord API error') {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  // Use defineProperty to avoid read-only getter conflicts on the prototype
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

const FUTURE = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const FUTURE_END = new Date(FUTURE.getTime() + 3 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 1000);

const baseEventData: ScheduledEventData = {
  title: 'Raid Night',
  description: 'Come raid with us!',
  startTime: FUTURE.toISOString(),
  endTime: FUTURE_END.toISOString(),
  signupCount: 5,
  maxAttendees: 25,
  game: { name: 'World of Warcraft' },
};

describe('ScheduledEventService', () => {
  let service: ScheduledEventService;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let channelResolver: jest.Mocked<ChannelResolverService>;
  let settingsService: jest.Mocked<SettingsService>;
  let mockDb: {
    select: jest.Mock;
    update: jest.Mock;
  };

  /** Shared guild mock with configurable scheduledEvents. */
  let mockGuild: {
    scheduledEvents: {
      create: jest.Mock;
      edit: jest.Mock;
      delete: jest.Mock;
      fetch: jest.Mock;
    };
  };

  /** Helper to build a chainable Drizzle select mock. */
  const createSelectChain = (rows: unknown[] = []) => {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    return chain;
  };

  /** Helper to build a chainable Drizzle update mock. */
  const createUpdateChain = () => {
    const chain: Record<string, jest.Mock> = {};
    chain.set = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockResolvedValue(undefined);
    return chain;
  };

  beforeEach(async () => {
    mockGuild = {
      scheduledEvents: {
        create: jest.fn().mockResolvedValue({ id: 'discord-se-id-1' }),
        edit: jest.fn().mockResolvedValue({ id: 'discord-se-id-1' }),
        delete: jest.fn().mockResolvedValue(undefined),
        fetch: jest.fn().mockResolvedValue({
          id: 'discord-se-id-1',
          status: GuildScheduledEventStatus.Active,
          setStatus: jest.fn().mockResolvedValue(undefined),
        }),
      },
    };

    const selectChain = createSelectChain();
    const updateChain = createUpdateChain();

    mockDb = {
      select: jest.fn().mockReturnValue(selectChain),
      update: jest.fn().mockReturnValue(updateChain),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduledEventService,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
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
              .mockResolvedValue('voice-channel-123'),
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
    clientService = module.get(DiscordBotClientService);
    channelResolver = module.get(ChannelResolverService);
    settingsService = module.get(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // createScheduledEvent
  // ---------------------------------------------------------------------------
  describe('createScheduledEvent', () => {
    it('creates a Discord Scheduled Event for a normal (non ad-hoc) event', async () => {
      const selectChain = createSelectChain();
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await service.createScheduledEvent(42, baseEventData, 1, false);

      expect(mockGuild.scheduledEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Raid Night',
          privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
          entityType: GuildScheduledEventEntityType.Voice,
          channel: 'voice-channel-123',
        }),
      );
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('skips when isAdHoc is true (AC-2)', async () => {
      await service.createScheduledEvent(42, baseEventData, 1, true);

      expect(mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('skips when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await service.createScheduledEvent(42, baseEventData, 1, false);

      expect(mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
    });

    it('skips when start time is in the past', async () => {
      const pastData: ScheduledEventData = {
        ...baseEventData,
        startTime: PAST.toISOString(),
      };

      await service.createScheduledEvent(42, pastData, 1, false);

      expect(mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
    });

    it('skips when no guild is available', async () => {
      clientService.getGuild.mockReturnValue(null);

      await service.createScheduledEvent(42, baseEventData, 1, false);

      expect(mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
    });

    it('skips when no voice channel is resolved (AC-10)', async () => {
      channelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
        null,
      );

      await service.createScheduledEvent(42, baseEventData, 1, false);

      expect(mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
    });

    it('stores the Discord Scheduled Event ID in the DB after creation', async () => {
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await service.createScheduledEvent(42, baseEventData, 1, false);

      expect(updateChain.set).toHaveBeenCalledWith({
        discordScheduledEventId: 'discord-se-id-1',
      });
    });

    it('does not throw when Discord API returns an error — logs and swallows (AC-13)', async () => {
      mockGuild.scheduledEvents.create.mockRejectedValue(
        new Error('Discord API is down'),
      );

      await expect(
        service.createScheduledEvent(42, baseEventData, 1, false),
      ).resolves.not.toThrow();
    });

    it('passes scheduledEndTime from eventData.endTime', async () => {
      await service.createScheduledEvent(42, baseEventData, 1, false);

      const call = mockGuild.scheduledEvents.create.mock.calls[0][0] as {
        scheduledEndTime: Date;
        scheduledStartTime: Date;
      };
      expect(call.scheduledEndTime).toEqual(new Date(baseEventData.endTime));
      expect(call.scheduledStartTime).toEqual(
        new Date(baseEventData.startTime),
      );
    });

    it('uses gameId to resolve the voice channel', async () => {
      await service.createScheduledEvent(42, baseEventData, 99, false);

      expect(
        channelResolver.resolveVoiceChannelForScheduledEvent,
      ).toHaveBeenCalledWith(99);
    });

    it('handles null gameId gracefully', async () => {
      await service.createScheduledEvent(42, baseEventData, null, false);

      expect(
        channelResolver.resolveVoiceChannelForScheduledEvent,
      ).toHaveBeenCalledWith(null);
      expect(mockGuild.scheduledEvents.create).toHaveBeenCalled();
    });

    it('skips when isAdHoc is undefined (treated as falsy — allows creation)', async () => {
      await service.createScheduledEvent(42, baseEventData, 1, undefined);

      // undefined is falsy, so this should proceed
      expect(mockGuild.scheduledEvents.create).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // updateScheduledEvent
  // ---------------------------------------------------------------------------
  describe('updateScheduledEvent', () => {
    it('updates title, description, and time when a scheduled event exists (AC-3/AC-4)', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      await service.updateScheduledEvent(42, baseEventData, 1, false);

      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
        'discord-se-id-1',
        expect.objectContaining({
          name: 'Raid Night',
          scheduledStartTime: new Date(baseEventData.startTime),
          scheduledEndTime: new Date(baseEventData.endTime),
        }),
      );
    });

    it('creates a new scheduled event when none exists in DB', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: null },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await service.updateScheduledEvent(42, baseEventData, 1, false);

      // Should fall back to create
      expect(mockGuild.scheduledEvents.create).toHaveBeenCalled();
      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('creates a new scheduled event when DB row has no discordScheduledEventId', async () => {
      const selectChain = createSelectChain([{}]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await service.updateScheduledEvent(42, baseEventData, 1, false);

      expect(mockGuild.scheduledEvents.create).toHaveBeenCalled();
    });

    it('skips when isAdHoc is true', async () => {
      await service.updateScheduledEvent(42, baseEventData, 1, true);

      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
      expect(mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
    });

    it('skips when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await service.updateScheduledEvent(42, baseEventData, 1, false);

      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('recreates the scheduled event when Discord returns 10070 (manual deletion) (AC-12)', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'deleted-se-id' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      const unknownError = makeDiscordApiError(
        10070,
        'Unknown Scheduled Event',
      );
      mockGuild.scheduledEvents.edit.mockRejectedValue(unknownError);

      await service.updateScheduledEvent(42, baseEventData, 1, false);

      // Should clear old ID and then recreate
      expect(updateChain.set).toHaveBeenCalledWith({
        discordScheduledEventId: null,
      });
      expect(mockGuild.scheduledEvents.create).toHaveBeenCalled();
    });

    it('does not throw on other Discord API errors — logs and swallows (AC-13)', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      mockGuild.scheduledEvents.edit.mockRejectedValue(
        new Error('Rate limited'),
      );

      await expect(
        service.updateScheduledEvent(42, baseEventData, 1, false),
      ).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // deleteScheduledEvent
  // ---------------------------------------------------------------------------
  describe('deleteScheduledEvent', () => {
    it('deletes the Discord Scheduled Event when one exists (AC-5/AC-6)', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await service.deleteScheduledEvent(42);

      expect(mockGuild.scheduledEvents.delete).toHaveBeenCalledWith(
        'discord-se-id-1',
      );
    });

    it('clears discordScheduledEventId in DB after successful delete', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await service.deleteScheduledEvent(42);

      expect(updateChain.set).toHaveBeenCalledWith({
        discordScheduledEventId: null,
      });
    });

    it('skips when no discordScheduledEventId stored in DB', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: null },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      await service.deleteScheduledEvent(42);

      expect(mockGuild.scheduledEvents.delete).not.toHaveBeenCalled();
    });

    it('skips when DB row is empty', async () => {
      const selectChain = createSelectChain([]);
      mockDb.select.mockReturnValue(selectChain);

      await service.deleteScheduledEvent(42);

      expect(mockGuild.scheduledEvents.delete).not.toHaveBeenCalled();
    });

    it('skips silently when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await expect(service.deleteScheduledEvent(42)).resolves.not.toThrow();

      expect(mockGuild.scheduledEvents.delete).not.toHaveBeenCalled();
    });

    it('handles 10070 gracefully — already deleted in Discord', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      const unknownError = makeDiscordApiError(
        10070,
        'Unknown Scheduled Event',
      );
      mockGuild.scheduledEvents.delete.mockRejectedValue(unknownError);

      await expect(service.deleteScheduledEvent(42)).resolves.not.toThrow();

      // Still clears the DB reference
      expect(updateChain.set).toHaveBeenCalledWith({
        discordScheduledEventId: null,
      });
    });

    it('does not throw on other Discord errors — logs and swallows (AC-13)', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      mockGuild.scheduledEvents.delete.mockRejectedValue(
        new Error('Unexpected API error'),
      );

      await expect(service.deleteScheduledEvent(42)).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // completeScheduledEvent (ROK-577)
  // ---------------------------------------------------------------------------
  describe('completeScheduledEvent', () => {
    it('sets the Discord Scheduled Event status to Completed when Active', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      mockGuild.scheduledEvents.fetch.mockResolvedValue({
        id: 'discord-se-id-1',
        status: GuildScheduledEventStatus.Active,
        setStatus: jest.fn(),
      });

      await service.completeScheduledEvent(42);

      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
        'discord-se-id-1',
        { status: GuildScheduledEventStatus.Completed },
      );
    });

    it('transitions Scheduled -> Active -> Completed when event is still Scheduled', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      mockGuild.scheduledEvents.fetch.mockResolvedValue({
        id: 'discord-se-id-1',
        status: GuildScheduledEventStatus.Scheduled,
        setStatus: jest.fn(),
      });

      await service.completeScheduledEvent(42);

      // First call: Scheduled -> Active
      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
        'discord-se-id-1',
        { status: GuildScheduledEventStatus.Active },
      );
      // Second call: Active -> Completed
      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
        'discord-se-id-1',
        { status: GuildScheduledEventStatus.Completed },
      );
      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledTimes(2);
    });

    it('skips when event is already Completed', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      mockGuild.scheduledEvents.fetch.mockResolvedValue({
        id: 'discord-se-id-1',
        status: GuildScheduledEventStatus.Completed,
        setStatus: jest.fn(),
      });

      await service.completeScheduledEvent(42);

      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('skips when event is already Canceled', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      mockGuild.scheduledEvents.fetch.mockResolvedValue({
        id: 'discord-se-id-1',
        status: GuildScheduledEventStatus.Canceled,
        setStatus: jest.fn(),
      });

      await service.completeScheduledEvent(42);

      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('clears discordScheduledEventId in DB after completion', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await service.completeScheduledEvent(42);

      expect(updateChain.set).toHaveBeenCalledWith({
        discordScheduledEventId: null,
      });
    });

    it('skips when no discordScheduledEventId stored in DB', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: null },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      await service.completeScheduledEvent(42);

      expect(mockGuild.scheduledEvents.fetch).not.toHaveBeenCalled();
      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('skips when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await service.completeScheduledEvent(42);

      expect(mockGuild.scheduledEvents.fetch).not.toHaveBeenCalled();
    });

    it('handles 10070 gracefully — already deleted in Discord', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      const unknownError = makeDiscordApiError(
        10070,
        'Unknown Scheduled Event',
      );
      mockGuild.scheduledEvents.fetch.mockRejectedValue(unknownError);

      await expect(service.completeScheduledEvent(42)).resolves.not.toThrow();

      // Still clears the DB reference
      expect(updateChain.set).toHaveBeenCalledWith({
        discordScheduledEventId: null,
      });
    });

    it('does not throw on other Discord errors — logs and swallows', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      mockGuild.scheduledEvents.fetch.mockRejectedValue(
        new Error('Unexpected API error'),
      );

      await expect(service.completeScheduledEvent(42)).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // updateDescription
  // ---------------------------------------------------------------------------
  describe('updateDescription', () => {
    it('updates only the description on the Discord Scheduled Event (AC-7)', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      await service.updateDescription(42, baseEventData);

      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
        'discord-se-id-1',
        expect.objectContaining({ description: expect.any(String) }),
      );
      // Should NOT include name or scheduled times
      const editArg = mockGuild.scheduledEvents.edit.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(editArg).not.toHaveProperty('name');
      expect(editArg).not.toHaveProperty('scheduledStartTime');
    });

    it('skips when no discordScheduledEventId in DB', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: null },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      await service.updateDescription(42, baseEventData);

      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('skips when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await service.updateDescription(42, baseEventData);

      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('handles 10070 by clearing the DB reference', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      const unknownError = makeDiscordApiError(
        10070,
        'Unknown Scheduled Event',
      );
      mockGuild.scheduledEvents.edit.mockRejectedValue(unknownError);

      await expect(
        service.updateDescription(42, baseEventData),
      ).resolves.not.toThrow();

      expect(updateChain.set).toHaveBeenCalledWith({
        discordScheduledEventId: null,
      });
    });

    it('does not throw on other Discord errors — logs and swallows', async () => {
      const selectChain = createSelectChain([
        { discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      mockGuild.scheduledEvents.edit.mockRejectedValue(
        new Error('Some other error'),
      );

      await expect(
        service.updateDescription(42, baseEventData),
      ).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // buildDescription (tested via createScheduledEvent side effects)
  // ---------------------------------------------------------------------------
  describe('description building', () => {
    it('includes game name, signup count, and view link in the description', async () => {
      await service.createScheduledEvent(42, baseEventData, 1, false);

      const editArg = mockGuild.scheduledEvents.create.mock.calls[0][0] as {
        description: string;
      };
      expect(editArg.description).toContain('World of Warcraft');
      expect(editArg.description).toContain('5/25 signed up');
      expect(editArg.description).toContain('https://raidledger.app/events/42');
    });

    it('shows signup count without max when maxAttendees is null', async () => {
      const data: ScheduledEventData = {
        ...baseEventData,
        maxAttendees: null,
        signupCount: 7,
      };

      await service.createScheduledEvent(42, data, 1, false);

      const editArg = mockGuild.scheduledEvents.create.mock.calls[0][0] as {
        description: string;
      };
      expect(editArg.description).toContain('7 signed up');
      // "7/25" pattern should not appear — no slash between count and max
      expect(editArg.description).not.toMatch(/\d+\/\d+/);
    });

    it('uses "Event" as game name when no game provided', async () => {
      const data: ScheduledEventData = {
        ...baseEventData,
        game: null,
      };

      await service.createScheduledEvent(42, data, 1, false);

      const editArg = mockGuild.scheduledEvents.create.mock.calls[0][0] as {
        description: string;
      };
      expect(editArg.description).toContain('Event —');
    });

    it('omits view link when clientUrl is null', async () => {
      settingsService.getClientUrl.mockResolvedValue(null);

      await service.createScheduledEvent(42, baseEventData, 1, false);

      const editArg = mockGuild.scheduledEvents.create.mock.calls[0][0] as {
        description: string;
      };
      expect(editArg.description).not.toContain('View event');
      expect(editArg.description).not.toContain('/events/');
    });

    it('truncates long descriptions to 1000 characters', async () => {
      const longDesc = 'a'.repeat(2000);
      const data: ScheduledEventData = {
        ...baseEventData,
        description: longDesc,
      };

      await service.createScheduledEvent(42, data, 1, false);

      const editArg = mockGuild.scheduledEvents.create.mock.calls[0][0] as {
        description: string;
      };
      expect(editArg.description.length).toBeLessThanOrEqual(1000);
    });

    it('preserves header even when description is extremely long', async () => {
      const longDesc = 'x'.repeat(2000);
      const data: ScheduledEventData = {
        ...baseEventData,
        description: longDesc,
      };

      await service.createScheduledEvent(42, data, 1, false);

      const editArg = mockGuild.scheduledEvents.create.mock.calls[0][0] as {
        description: string;
      };
      // Should still contain the header info
      expect(editArg.description).toContain('World of Warcraft');
    });

    it('returns full description unchanged when it is under 1000 chars', async () => {
      const shortDesc = 'Short description.';
      const data: ScheduledEventData = {
        ...baseEventData,
        description: shortDesc,
      };

      await service.createScheduledEvent(42, data, 1, false);

      const editArg = mockGuild.scheduledEvents.create.mock.calls[0][0] as {
        description: string;
      };
      expect(editArg.description).toContain(shortDesc);
      expect(editArg.description.length).toBeLessThanOrEqual(1000);
    });

    it('handles null/undefined description gracefully', async () => {
      const data: ScheduledEventData = { ...baseEventData, description: null };

      await service.createScheduledEvent(42, data, 1, false);

      const editArg = mockGuild.scheduledEvents.create.mock.calls[0][0] as {
        description: string;
      };
      // Should still produce a valid description
      expect(editArg.description).toContain('World of Warcraft');
    });
  });

  // ---------------------------------------------------------------------------
  // startScheduledEvents (ROK-573)
  // ---------------------------------------------------------------------------
  describe('startScheduledEvents', () => {
    /** Helper to build a select chain that resolves at .where() (no .limit()). */
    const createSelectChainNoLimit = (rows: unknown[] = []) => {
      const chain: Record<string, jest.Mock> = {};
      chain.select = jest.fn().mockReturnValue(chain);
      chain.from = jest.fn().mockReturnValue(chain);
      chain.where = jest.fn().mockResolvedValue(rows);
      return chain;
    };

    it('starts a Discord scheduled event that is still in SCHEDULED state', async () => {
      const selectChain = createSelectChainNoLimit([
        { id: 42, discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      mockGuild.scheduledEvents.fetch.mockResolvedValue({
        id: 'discord-se-id-1',
        status: GuildScheduledEventStatus.Scheduled,
      });

      await service.startScheduledEvents();

      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
        'discord-se-id-1',
        { status: GuildScheduledEventStatus.Active },
      );
    });

    it('skips events already in ACTIVE state', async () => {
      const selectChain = createSelectChainNoLimit([
        { id: 42, discordScheduledEventId: 'discord-se-id-1' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      mockGuild.scheduledEvents.fetch.mockResolvedValue({
        id: 'discord-se-id-1',
        status: GuildScheduledEventStatus.Active,
      });

      await service.startScheduledEvents();

      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('skips when no candidates found', async () => {
      const selectChain = createSelectChainNoLimit([]);
      mockDb.select.mockReturnValue(selectChain);

      await service.startScheduledEvents();

      expect(mockGuild.scheduledEvents.fetch).not.toHaveBeenCalled();
      expect(mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
    });

    it('skips when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await service.startScheduledEvents();

      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('skips when no guild is available', async () => {
      clientService.getGuild.mockReturnValue(null);

      await service.startScheduledEvents();

      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('clears DB reference when Discord event was manually deleted (10070)', async () => {
      const selectChain = createSelectChainNoLimit([
        { id: 42, discordScheduledEventId: 'deleted-se-id' },
      ]);
      mockDb.select.mockReturnValue(selectChain);
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      const unknownError = makeDiscordApiError(
        10070,
        'Unknown Scheduled Event',
      );
      mockGuild.scheduledEvents.fetch.mockRejectedValue(unknownError);

      await service.startScheduledEvents();

      expect(updateChain.set).toHaveBeenCalledWith({
        discordScheduledEventId: null,
      });
    });

    it('handles multiple candidates — starts only SCHEDULED ones', async () => {
      const selectChain = createSelectChainNoLimit([
        { id: 42, discordScheduledEventId: 'se-1' },
        { id: 43, discordScheduledEventId: 'se-2' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      mockGuild.scheduledEvents.fetch
        .mockResolvedValueOnce({
          id: 'se-1',
          status: GuildScheduledEventStatus.Scheduled,
        })
        .mockResolvedValueOnce({
          id: 'se-2',
          status: GuildScheduledEventStatus.Active,
        });

      await service.startScheduledEvents();

      // Only se-1 should be started
      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledTimes(1);
      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-1', {
        status: GuildScheduledEventStatus.Active,
      });
    });

    it('does not throw on Discord API errors — logs and continues', async () => {
      const selectChain = createSelectChainNoLimit([
        { id: 42, discordScheduledEventId: 'se-1' },
        { id: 43, discordScheduledEventId: 'se-2' },
      ]);
      mockDb.select.mockReturnValue(selectChain);

      // First event fails with a non-10070 error
      mockGuild.scheduledEvents.fetch
        .mockRejectedValueOnce(new Error('Rate limited'))
        .mockResolvedValueOnce({
          id: 'se-2',
          status: GuildScheduledEventStatus.Scheduled,
        });

      await expect(service.startScheduledEvents()).resolves.not.toThrow();

      // Second event should still be started despite first failing
      expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-2', {
        status: GuildScheduledEventStatus.Active,
      });
    });
  });
});
