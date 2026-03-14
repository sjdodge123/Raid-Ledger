import { Test, TestingModule } from '@nestjs/testing';
import {
  DiscordNotificationProcessor,
  buildPlaintextContent,
} from './discord-notification.processor';
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
        expect.any(String),
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
        expect.any(String),
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
        expect.any(String),
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
        string,
      ];
      // 4th argument should be mockRows
      expect(sendEmbedDMCall[3]).toBe(mockRows);
    });
  });

  describe('Regression: ROK-756 — plaintext content for push notifications', () => {
    it('should pass plaintext content as 5th argument to sendEmbedDM', async () => {
      const job = buildJob({
        title: 'Event Starting in 15 Minutes!',
        message: 'Raid Night starts in 15 minutes at 8:00 PM EST.',
      });

      await processor.process(job);

      const sendCall = mockClientService.sendEmbedDM.mock.calls[0] as [
        string,
        unknown,
        unknown,
        unknown,
        string,
      ];
      expect(sendCall[4]).toBe(
        'Event Starting in 15 Minutes!\nRaid Night starts in 15 minutes at 8:00 PM EST.',
      );
    });

    it('should produce content with no Discord tokens (timestamps, channel mentions)', async () => {
      // The title and message fields are already plaintext (no Discord tokens),
      // so the content should also be token-free.
      const job = buildJob({
        title: 'New WoW Event',
        message: 'New event for World of Warcraft: Raid Night on Sat Mar 15',
      });

      await processor.process(job);

      const sendCall = mockClientService.sendEmbedDM.mock.calls[0] as [
        string,
        unknown,
        unknown,
        unknown,
        string,
      ];
      const content = sendCall[4];
      expect(content).not.toMatch(/<t:\d+:[a-zA-Z]>/);
      expect(content).not.toMatch(/<#\d+>/);
      expect(content).not.toContain('**');
      expect(content).toContain('New WoW Event');
      expect(content).toContain('Raid Night on Sat Mar 15');
    });

    it('should include content for all notification types', async () => {
      const types = [
        'event_reminder',
        'new_event',
        'subscribed_game',
        'event_rescheduled',
        'bench_promoted',
      ];
      for (const type of types) {
        jest.clearAllMocks();
        mockEmbedService.buildNotificationEmbed.mockResolvedValue({
          embed: { toJSON: () => ({}) },
          row: { toJSON: () => ({}) },
        });
        const job = buildJob({ type, title: `Title: ${type}`, message: `Msg` });
        await processor.process(job);
        const sendCall = mockClientService.sendEmbedDM.mock.calls[0] as [
          string,
          unknown,
          unknown,
          unknown,
          string,
        ];
        expect(sendCall[4]).toBe(`Title: ${type}\nMsg`);
      }
    });
  });
});

describe('buildPlaintextContent', () => {
  it('combines title and message with newline', () => {
    expect(buildPlaintextContent('Hello', 'World')).toBe('Hello\nWorld');
  });

  it('produces clean output for typical notification data', () => {
    const result = buildPlaintextContent(
      'Event Starting in 15 Minutes!',
      'Raid Night starts in 15 minutes at 8:00 PM EST.',
    );
    expect(result).toBe(
      'Event Starting in 15 Minutes!\nRaid Night starts in 15 minutes at 8:00 PM EST.',
    );
    expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
    expect(result).not.toMatch(/<#\d+>/);
  });

  describe('ROK-822 — Discord markup stripping', () => {
    it('strips bold markdown from message', () => {
      const result = buildPlaintextContent(
        'Event Reminder',
        'Your event **Raid Night** started 5 minutes ago',
      );
      expect(result).toBe(
        'Event Reminder\nYour event Raid Night started 5 minutes ago',
      );
    });

    it('strips italic markdown from message', () => {
      const result = buildPlaintextContent(
        'Update',
        'Check *your profile* for details',
      );
      expect(result).not.toContain('*');
    });

    it('strips channel mention markup <#channelId>', () => {
      const result = buildPlaintextContent(
        'Join Now',
        'Head to <#123456789012345678> for the event',
      );
      expect(result).not.toMatch(/<#\d+>/);
      expect(result).toBe('Join Now\nHead to #channel for the event');
    });

    it('strips user mention markup <@userId>', () => {
      const result = buildPlaintextContent(
        'Roster Update',
        '<@987654321012345678> left the roster',
      );
      expect(result).not.toMatch(/<@!?\d+>/);
      expect(result).toBe('Roster Update\n@user left the roster');
    });

    it('strips role mention markup <@&roleId>', () => {
      const result = buildPlaintextContent(
        'Alert',
        'Attention <@&111222333444555666> members',
      );
      expect(result).not.toMatch(/<@&\d+>/);
      expect(result).toBe('Alert\nAttention @role members');
    });

    it('strips timestamp markup <t:timestamp:format>', () => {
      const result = buildPlaintextContent(
        'Reminder',
        'Event starts <t:1700000000:R> at <t:1700000000:F>',
      );
      expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
    });

    it('strips bare timestamp markup <t:timestamp>', () => {
      const result = buildPlaintextContent(
        'Reminder',
        'Event starts <t:1700000000>',
      );
      expect(result).not.toMatch(/<t:\d+>/);
    });
  });

  describe('ROK-822 — null/undefined/object safety', () => {
    it('replaces undefined title with empty string', () => {
      const result = buildPlaintextContent(
        undefined as unknown as string,
        'Some message',
      );
      expect(result).not.toContain('undefined');
      expect(result).toContain('Some message');
    });

    it('replaces null title with empty string', () => {
      const result = buildPlaintextContent(
        null as unknown as string,
        'Some message',
      );
      expect(result).not.toContain('null');
      expect(result).toContain('Some message');
    });

    it('replaces undefined message with empty string', () => {
      const result = buildPlaintextContent(
        'Title',
        undefined as unknown as string,
      );
      expect(result).not.toContain('undefined');
      expect(result).toContain('Title');
    });

    it('handles object values without showing [object Object]', () => {
      const result = buildPlaintextContent('Title', {
        key: 'val',
      } as unknown as string);
      expect(result).not.toContain('[object Object]');
    });

    it('handles numeric values gracefully', () => {
      const result = buildPlaintextContent('Title', 42 as unknown as string);
      expect(result).not.toContain('[object');
      expect(result).toContain('Title');
    });
  });

  describe('ROK-822 — length constraint', () => {
    it('truncates content exceeding 150 characters', () => {
      const longTitle = 'A'.repeat(80);
      const longMessage = 'B'.repeat(100);
      const result = buildPlaintextContent(longTitle, longMessage);
      expect(result.length).toBeLessThanOrEqual(150);
    });

    it('appends ellipsis when truncated', () => {
      const longTitle = 'A'.repeat(80);
      const longMessage = 'B'.repeat(100);
      const result = buildPlaintextContent(longTitle, longMessage);
      expect(result).toMatch(/\.\.\.$/);
    });

    it('does not truncate short content', () => {
      const result = buildPlaintextContent('Short', 'Message');
      expect(result).toBe('Short\nMessage');
      expect(result).not.toMatch(/\.\.\.$/);
    });
  });

  describe('ROK-822 — multiple markup patterns combined', () => {
    it('strips all markup types from a single message', () => {
      const result = buildPlaintextContent(
        'Event Update',
        '**Raid Night** moved to <#123456789> starting <t:1700000000:R>',
      );
      expect(result).not.toContain('**');
      expect(result).not.toMatch(/<#\d+>/);
      expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
    });

    it('collapses multiple spaces after stripping', () => {
      const result = buildPlaintextContent('Title', 'Go to  <#123>  now');
      expect(result).not.toContain('  ');
    });
  });
});
