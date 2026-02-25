import { Test, TestingModule } from '@nestjs/testing';
import { DiscordNotificationProcessor } from './discord-notification.processor';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { DiscordNotificationService } from './discord-notification.service';
import { SettingsService } from '../settings/settings.service';
import type { Job } from 'bullmq';
import type { DiscordNotificationJobData } from './discord-notification.constants';

describe('DiscordNotificationProcessor', () => {
  let processor: DiscordNotificationProcessor;

  const mockClientService = {
    isConnected: jest.fn().mockReturnValue(true),
    sendEmbedDM: jest.fn().mockResolvedValue(undefined),
  };

  const mockEmbedService = {
    buildNotificationEmbed: jest.fn().mockResolvedValue({
      embed: { toJSON: () => ({}) },
      row: { toJSON: () => ({}) },
    }),
  };

  const mockDiscordNotificationService = {
    resetFailures: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };

  const mockSettingsService = {
    getBranding: jest.fn().mockResolvedValue({
      communityName: 'Test Community',
      communityAccentColor: '#38bdf8',
    }),
  };

  const buildJob = (
    overrides: Partial<DiscordNotificationJobData> = {},
    jobOverrides: Record<string, unknown> = {},
  ): Job<DiscordNotificationJobData> =>
    ({
      id: 'job-1',
      data: {
        notificationId: 'notif-1',
        userId: 1,
        discordId: '123456789',
        type: 'event_reminder',
        title: 'Event Reminder',
        message: 'Your event starts soon',
        ...overrides,
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
      ...jobOverrides,
    }) as unknown as Job<DiscordNotificationJobData>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordNotificationProcessor,
        { provide: DiscordBotClientService, useValue: mockClientService },
        {
          provide: DiscordNotificationEmbedService,
          useValue: mockEmbedService,
        },
        {
          provide: DiscordNotificationService,
          useValue: mockDiscordNotificationService,
        },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    processor = module.get<DiscordNotificationProcessor>(
      DiscordNotificationProcessor,
    );
  });

  describe('process — success path', () => {
    it('should build embed and send DM on successful processing', async () => {
      const job = buildJob();

      await processor.process(job);

      expect(mockSettingsService.getBranding).toHaveBeenCalled();
      expect(mockEmbedService.buildNotificationEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Event Reminder',
          message: 'Your event starts soon',
        }),
        'Test Community',
      );
      expect(mockClientService.sendEmbedDM).toHaveBeenCalledWith(
        '123456789',
        expect.anything(),
        expect.anything(),
        undefined,
      );
    });

    it('should reset failures after successful DM send', async () => {
      const job = buildJob();

      await processor.process(job);

      expect(mockDiscordNotificationService.resetFailures).toHaveBeenCalledWith(
        1,
      );
    });

    it('should pass payload through to embed service', async () => {
      const job = buildJob({
        payload: { eventId: '42', eventTitle: 'Raid Night' },
      });

      await processor.process(job);

      expect(mockEmbedService.buildNotificationEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { eventId: '42', eventTitle: 'Raid Night' },
        }),
        'Test Community',
      );
    });
  });

  describe('process — bot not connected', () => {
    it('should throw when Discord bot is not connected', async () => {
      mockClientService.isConnected.mockReturnValueOnce(false);
      const job = buildJob();

      await expect(processor.process(job)).rejects.toThrow(
        'Discord bot not connected',
      );
      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should not record failure when bot is not connected', async () => {
      mockClientService.isConnected.mockReturnValueOnce(false);
      const job = buildJob();

      await expect(processor.process(job)).rejects.toThrow();
      expect(
        mockDiscordNotificationService.recordFailure,
      ).not.toHaveBeenCalled();
    });
  });

  describe('process — send failure and retry logic', () => {
    it('should throw error when sendEmbedDM fails', async () => {
      const error = new Error('Cannot send messages to this user');
      mockClientService.sendEmbedDM.mockRejectedValueOnce(error);
      const job = buildJob();

      await expect(processor.process(job)).rejects.toThrow(
        'Cannot send messages to this user',
      );
    });

    it('should NOT record failure on first attempt (not final)', async () => {
      const error = new Error('DM failed');
      mockClientService.sendEmbedDM.mockRejectedValueOnce(error);
      const job = buildJob({}, { attemptsMade: 0, opts: { attempts: 3 } });

      await expect(processor.process(job)).rejects.toThrow();
      expect(
        mockDiscordNotificationService.recordFailure,
      ).not.toHaveBeenCalled();
    });

    it('should NOT record failure on second attempt (not final)', async () => {
      const error = new Error('DM failed');
      mockClientService.sendEmbedDM.mockRejectedValueOnce(error);
      const job = buildJob({}, { attemptsMade: 1, opts: { attempts: 3 } });

      await expect(processor.process(job)).rejects.toThrow();
      expect(
        mockDiscordNotificationService.recordFailure,
      ).not.toHaveBeenCalled();
    });

    it('should record failure on final attempt (attemptsMade + 1 >= attempts)', async () => {
      const error = new Error('DM failed');
      mockClientService.sendEmbedDM.mockRejectedValueOnce(error);
      // attemptsMade = 2, attempts = 3 → 2 + 1 = 3 >= 3
      const job = buildJob({}, { attemptsMade: 2, opts: { attempts: 3 } });

      await expect(processor.process(job)).rejects.toThrow();
      expect(mockDiscordNotificationService.recordFailure).toHaveBeenCalledWith(
        1,
      );
    });

    it('should not reset failures when DM fails', async () => {
      const error = new Error('DM failed');
      mockClientService.sendEmbedDM.mockRejectedValueOnce(error);
      const job = buildJob();

      await expect(processor.process(job)).rejects.toThrow();
      expect(
        mockDiscordNotificationService.resetFailures,
      ).not.toHaveBeenCalled();
    });
  });

  describe('process — community name fallback', () => {
    it('should use "Raid Ledger" as community name fallback when null', async () => {
      mockSettingsService.getBranding.mockResolvedValueOnce({
        communityName: null,
        communityAccentColor: null,
      });
      const job = buildJob();

      await processor.process(job);

      expect(mockEmbedService.buildNotificationEmbed).toHaveBeenCalledWith(
        expect.anything(),
        'Raid Ledger',
      );
    });
  });

  describe('process — ROK-378 extra rows (Roach Out button)', () => {
    it('should pass rows to sendEmbedDM when embed service returns rows', async () => {
      const mockRows = [{ toJSON: () => ({ components: [] }) }];
      mockEmbedService.buildNotificationEmbed.mockResolvedValueOnce({
        embed: { toJSON: () => ({}) },
        row: { toJSON: () => ({}) },
        rows: mockRows,
      });
      const job = buildJob({
        type: 'event_reminder',
        payload: { eventId: '42' },
      });

      await processor.process(job);

      expect(mockClientService.sendEmbedDM).toHaveBeenCalledWith(
        job.data.discordId,
        expect.anything(),
        expect.anything(),
        mockRows,
      );
    });

    it('should pass undefined rows to sendEmbedDM when embed service does not return rows', async () => {
      // Default mock already returns no rows (undefined)
      const job = buildJob({ type: 'new_event', payload: { eventId: '42' } });

      await processor.process(job);

      expect(mockClientService.sendEmbedDM).toHaveBeenCalledWith(
        job.data.discordId,
        expect.anything(),
        expect.anything(),
        undefined,
      );
    });

    it('should pass rows for event_reminder type regardless of job type string casing', async () => {
      const mockRows = [{ toJSON: () => ({ components: [] }) }];
      mockEmbedService.buildNotificationEmbed.mockResolvedValueOnce({
        embed: { toJSON: () => ({}) },
        row: { toJSON: () => ({}) },
        rows: mockRows,
      });
      // Even if job data type happens to have different format
      const job = buildJob({ type: 'event_reminder' });

      await processor.process(job);

      const sendEmbedDMCall = mockClientService.sendEmbedDM.mock.calls[0] as [
        string,
        unknown,
        unknown,
        unknown,
      ];
      // 4th argument should be mockRows
      expect(sendEmbedDMCall[3]).toBe(mockRows);
    });
  });
});
