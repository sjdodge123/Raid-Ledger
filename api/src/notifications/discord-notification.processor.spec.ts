import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DiscordNotificationProcessor } from './discord-notification.processor';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { DiscordNotificationService } from './discord-notification.service';
import { SettingsService } from '../settings/settings.service';
import { DISCORD_NOTIFICATION_QUEUE } from './discord-notification.constants';
import { QueueHealthService } from '../queue/queue-health.service';
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
    deactivateUser: jest.fn().mockResolvedValue(undefined),
    isUserDeactivated: jest.fn().mockResolvedValue(false),
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
        {
          provide: getQueueToken(DISCORD_NOTIFICATION_QUEUE),
          useValue: {
            drain: jest.fn(),
            getJobCounts: jest.fn().mockResolvedValue({
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0,
            }),
          },
        },
        { provide: QueueHealthService, useValue: { register: jest.fn() } },
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

  // ── ROK-1260: terminal classification for DiscordAPIError codes ──
  //
  // When buildAndSendDM throws a DiscordAPIError:
  //   - code 50278 ("no mutual guilds") → user has left the guild;
  //     classify as `permanent-deactivate`. Processor MUST call
  //     `deactivateUser(userId)` and MUST NOT call `recordFailure` or
  //     re-throw — so BullMQ marks the job `completed` and Sentry's
  //     auto-instrumentation does not capture the error.
  //   - code 50007 ("Cannot send messages to this user") → DMs are
  //     blocked but the user is still in the guild; classify as
  //     `permanent-prefs-only`. Processor MUST call `recordFailure`
  //     (so the existing 3-strike auto-disable kicks in) and MUST NOT
  //     re-throw or call `deactivateUser`.
  //   - any other error → existing transient retry path preserved:
  //     handleProcessError is still invoked AND the error rethrows.
  describe('ROK-1260: terminal DiscordAPIError classification', () => {
    // Synthesizes a discord.js v14 DiscordAPIError-shaped error so the
    // processor's classifier can detect the code AND the name prefix.
    //
    // ROK-1354: discord.js v14's `DiscordAPIError` (`@discordjs/rest`) has a
    // `name` GETTER that returns `DiscordAPIError[<code>]` (e.g.
    // `DiscordAPIError[50278]`) — never the bare string `DiscordAPIError`.
    // Production NEVER produces the bare name, so the classifier must match
    // on `name.startsWith('DiscordAPIError')`. This helper mirrors the real
    // production shape (bracketed name); a separate bare-name helper below
    // keeps transition-compat coverage.
    function makeDiscordApiError(
      code: number,
      message: string,
    ): Error & { code: number } {
      class DiscordAPIError extends Error {
        public code: number;
        constructor(c: number, m: string) {
          super(m);
          this.code = c;
          // Production getter shape — the bug ROK-1354 fixes.
          this.name = `DiscordAPIError[${c}]`;
        }
      }
      return new DiscordAPIError(code, message);
    }

    // ROK-1354: transition-compat helper — emits the BARE `DiscordAPIError`
    // name (the shape ROK-1260's simulation produced). The classifier's
    // `startsWith('DiscordAPIError')` gate must still match this so a future
    // discord.js downgrade or a wrapped re-throw keeps classifying.
    function makeBareNameDiscordApiError(
      code: number,
      message: string,
    ): Error & { code: number } {
      class DiscordAPIError extends Error {
        public code: number;
        constructor(c: number, m: string) {
          super(m);
          this.code = c;
          this.name = 'DiscordAPIError';
        }
      }
      return new DiscordAPIError(code, message);
    }

    describe('DiscordAPIError[50278] — user left the guild', () => {
      it('resolves cleanly (does NOT rethrow)', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(
            50278,
            'Cannot send messages to this user due to having no mutual guilds with the recipient (code 50278)',
          ),
        );
        const job = buildJob({}, { attemptsMade: 0, opts: { attempts: 3 } });

        await expect(processor.process(job)).resolves.toBeUndefined();
      });

      it('calls deactivateUser(userId) exactly once', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(
            50278,
            'Cannot send messages to this user due to having no mutual guilds with the recipient (code 50278)',
          ),
        );
        const job = buildJob();

        await processor.process(job);

        expect(
          mockDiscordNotificationService.deactivateUser,
        ).toHaveBeenCalledTimes(1);
        expect(
          mockDiscordNotificationService.deactivateUser,
        ).toHaveBeenCalledWith(1);
      });

      it('does NOT call recordFailure (counter is irrelevant — user is gone)', async () => {
        // Even on the FINAL attempt, recordFailure must not fire for
        // 50278 — the channel-pref counter exists for the prefs-only
        // case (DMs blocked but user in guild), not for users who have
        // left. Calling recordFailure here just produces noise as the
        // 3-strike auto-disable runs against an already-deactivated user.
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(
            50278,
            'Cannot send messages to this user due to having no mutual guilds with the recipient (code 50278)',
          ),
        );
        const job = buildJob({}, { attemptsMade: 2, opts: { attempts: 3 } });

        await processor.process(job);

        expect(
          mockDiscordNotificationService.recordFailure,
        ).not.toHaveBeenCalled();
      });

      it('does NOT reset failures (success path only)', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(50278, 'no mutual guilds (code 50278)'),
        );
        const job = buildJob();

        await processor.process(job);

        expect(
          mockDiscordNotificationService.resetFailures,
        ).not.toHaveBeenCalled();
      });
    });

    describe('DiscordAPIError[50007] — Cannot send messages to this user', () => {
      it('resolves cleanly (does NOT rethrow)', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(
            50007,
            'Cannot send messages to this user (code 50007)',
          ),
        );
        const job = buildJob({}, { attemptsMade: 0, opts: { attempts: 3 } });

        await expect(processor.process(job)).resolves.toBeUndefined();
      });

      it('calls recordFailure(userId) exactly once', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(
            50007,
            'Cannot send messages to this user (code 50007)',
          ),
        );
        const job = buildJob();

        await processor.process(job);

        expect(
          mockDiscordNotificationService.recordFailure,
        ).toHaveBeenCalledTimes(1);
        expect(
          mockDiscordNotificationService.recordFailure,
        ).toHaveBeenCalledWith(1);
      });

      it('does NOT call deactivateUser (user is still in the guild)', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(
            50007,
            'Cannot send messages to this user (code 50007)',
          ),
        );
        const job = buildJob();

        await processor.process(job);

        expect(
          mockDiscordNotificationService.deactivateUser,
        ).not.toHaveBeenCalled();
      });
    });

    // ── ROK-1354: 10013 Unknown User — deleted account, behaves like 50278 ──
    //
    // 10013 throws at `client.users.fetch(discordId)` (the account no longer
    // exists) BEFORE `user.send` is ever called. The classifier sees it from
    // the same catch in process(); the account is GONE, so it must map to
    // `permanent-deactivate` (same terminal handling as 50278).
    describe('DiscordAPIError[10013] — Unknown User (deleted account)', () => {
      it('resolves cleanly (does NOT rethrow)', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(10013, 'Unknown User (code 10013)'),
        );
        const job = buildJob({}, { attemptsMade: 0, opts: { attempts: 3 } });

        await expect(processor.process(job)).resolves.toBeUndefined();
      });

      it('calls deactivateUser(userId) exactly once (account is gone)', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(10013, 'Unknown User (code 10013)'),
        );
        const job = buildJob();

        await processor.process(job);

        expect(
          mockDiscordNotificationService.deactivateUser,
        ).toHaveBeenCalledTimes(1);
        expect(
          mockDiscordNotificationService.deactivateUser,
        ).toHaveBeenCalledWith(1);
      });

      it('does NOT call recordFailure (counter irrelevant — account deleted)', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(10013, 'Unknown User (code 10013)'),
        );
        const job = buildJob({}, { attemptsMade: 2, opts: { attempts: 3 } });

        await processor.process(job);

        expect(
          mockDiscordNotificationService.recordFailure,
        ).not.toHaveBeenCalled();
      });

      it('does NOT reset failures (success path only)', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(10013, 'Unknown User (code 10013)'),
        );
        const job = buildJob();

        await processor.process(job);

        expect(
          mockDiscordNotificationService.resetFailures,
        ).not.toHaveBeenCalled();
      });
    });

    // ── ROK-1354: bare-name transition compat ──
    //
    // ROK-1260's tests (and any wrapped/legacy re-throw) produce the BARE
    // `DiscordAPIError` name. The new `startsWith('DiscordAPIError')` gate
    // must STILL classify these so the fix is backwards-compatible.
    describe('ROK-1354: bare DiscordAPIError name still classifies (transition compat)', () => {
      it('50278 with bare name → permanent-deactivate', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeBareNameDiscordApiError(
            50278,
            'Cannot send messages to this user due to having no mutual guilds (code 50278)',
          ),
        );
        const job = buildJob();

        await expect(processor.process(job)).resolves.toBeUndefined();
        expect(
          mockDiscordNotificationService.deactivateUser,
        ).toHaveBeenCalledWith(1);
      });

      it('50007 with bare name → permanent-prefs-only', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeBareNameDiscordApiError(
            50007,
            'Cannot send messages to this user (code 50007)',
          ),
        );
        const job = buildJob();

        await expect(processor.process(job)).resolves.toBeUndefined();
        expect(
          mockDiscordNotificationService.recordFailure,
        ).toHaveBeenCalledWith(1);
        expect(
          mockDiscordNotificationService.deactivateUser,
        ).not.toHaveBeenCalled();
      });

      it('10013 with bare name → permanent-deactivate', async () => {
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeBareNameDiscordApiError(10013, 'Unknown User (code 10013)'),
        );
        const job = buildJob();

        await expect(processor.process(job)).resolves.toBeUndefined();
        expect(
          mockDiscordNotificationService.deactivateUser,
        ).toHaveBeenCalledWith(1);
      });
    });

    // ── ROK-1354: name-prefix gate guards unrelated libs reusing `.code` ──
    describe('ROK-1354: non-DiscordAPIError name with matching code → transient', () => {
      it('does NOT deactivate when code is 50278 but name is unrelated', async () => {
        // An error from an unrelated library that happens to carry
        // `.code === 50278` but whose name does NOT start with
        // `DiscordAPIError` must follow the transient path (rethrow, no
        // deactivate) — the name prefix is the disambiguator.
        const foreignError = new Error('Some unrelated failure') as Error & {
          code: number;
        };
        foreignError.name = 'SomeOtherError';
        foreignError.code = 50278;
        mockClientService.sendEmbedDM.mockRejectedValueOnce(foreignError);
        const job = buildJob();

        await expect(processor.process(job)).rejects.toThrow();
        expect(
          mockDiscordNotificationService.deactivateUser,
        ).not.toHaveBeenCalled();
      });
    });

    describe('generic / transient errors — existing path preserved', () => {
      it('still rethrows non-Discord errors', async () => {
        const transientError = new Error('Discord API: 500 Internal Error');
        mockClientService.sendEmbedDM.mockRejectedValueOnce(transientError);
        const job = buildJob();

        await expect(processor.process(job)).rejects.toThrow(
          'Discord API: 500 Internal Error',
        );
      });

      it('still records failure on FINAL attempt for transient errors', async () => {
        const transientError = new Error('Discord API: 500 Internal Error');
        mockClientService.sendEmbedDM.mockRejectedValueOnce(transientError);
        // attemptsMade = 2, attempts = 3 → final attempt
        const job = buildJob({}, { attemptsMade: 2, opts: { attempts: 3 } });

        await expect(processor.process(job)).rejects.toThrow();

        expect(
          mockDiscordNotificationService.recordFailure,
        ).toHaveBeenCalledWith(1);
        expect(
          mockDiscordNotificationService.deactivateUser,
        ).not.toHaveBeenCalled();
      });

      it('does NOT call deactivateUser for unrelated DiscordAPIError codes', async () => {
        // Code 10003 = Unknown Channel — not a terminal-deactivate signal.
        // Must follow the transient path (rethrow, no deactivate).
        mockClientService.sendEmbedDM.mockRejectedValueOnce(
          makeDiscordApiError(10003, 'Unknown Channel (code 10003)'),
        );
        const job = buildJob();

        await expect(processor.process(job)).rejects.toThrow();
        expect(
          mockDiscordNotificationService.deactivateUser,
        ).not.toHaveBeenCalled();
      });
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
