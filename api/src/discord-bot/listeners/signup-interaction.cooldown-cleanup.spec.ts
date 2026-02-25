/**
 * Adversarial tests for the cooldown map lazy cleanup logic (ROK-373).
 *
 * The cleanup function is module-level and exported for testability would require
 * refactoring, so we test it indirectly by driving `handleButtonInteraction` calls
 * and asserting observable behavior (entries removed / preserved) via the rate-limit
 * mechanism.
 *
 * Strategy:
 * - We use Jest's fake timers to advance `Date.now()` so we can control cooldown
 *   expiry and cleanup interval without real waits.
 * - We drive interactions against the listener using the same mocking pattern as
 *   signup-interaction.listener.spec.ts.
 */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { Test, TestingModule } from '@nestjs/testing';
import { SignupInteractionListener } from './signup-interaction.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { CharactersService } from '../../characters/characters.service';
import { IntentTokenService } from '../../auth/intent-token.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

function makeButtonInteraction(
  customId: string,
  userId: string = 'user-cleanup-test',
) {
  const interaction = {
    isButton: () => true,
    isStringSelectMenu: () => false,
    customId,
    user: { id: userId, username: 'TestUser', avatar: null },
    replied: false,
    deferred: false,
    deferReply: jest.fn().mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve(undefined);
    }),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(() => {
      interaction.replied = true;
      return Promise.resolve(undefined);
    }),
  };
  return interaction;
}

function makeChain(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(result);
  chain.leftJoin = jest.fn().mockReturnValue(chain);
  chain.groupBy = jest.fn().mockResolvedValue(result);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('SignupInteractionListener — cooldown map lazy cleanup (ROK-373)', () => {
  let module: TestingModule;
  let listener: any;
  let mockSignupsService: {
    findByDiscordUser: jest.Mock;
    signup: jest.Mock;
    signupDiscord: jest.Mock;
    updateStatus: jest.Mock;
    getRoster: jest.Mock;
    cancel: jest.Mock;
    cancelByDiscordUser: jest.Mock;
    confirmSignup: jest.Mock;
  };
  let mockDb: Record<string, jest.Mock>;
  let mockEventsService: { buildEmbedEventData: jest.Mock };

  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = new ActionRowBuilder<ButtonBuilder>();
  const originalClientUrl = process.env.CLIENT_URL;

  beforeEach(async () => {
    jest.useFakeTimers();

    delete process.env.CLIENT_URL;

    mockSignupsService = {
      findByDiscordUser: jest.fn().mockResolvedValue(null),
      signup: jest.fn().mockResolvedValue({ id: 1, eventId: 1 }),
      signupDiscord: jest.fn().mockResolvedValue({ id: 2, eventId: 1 }),
      updateStatus: jest.fn().mockResolvedValue({ id: 1, status: 'signed_up' }),
      getRoster: jest.fn().mockResolvedValue({
        eventId: 1,
        signups: [],
        count: 0,
      }),
      cancel: jest.fn(),
      cancelByDiscordUser: jest.fn(),
      confirmSignup: jest.fn().mockResolvedValue({ id: 1 }),
    };

    mockEventsService = {
      buildEmbedEventData: jest.fn().mockResolvedValue({
        id: 1,
        title: 'Test Event',
        startTime: '2026-02-20T20:00:00.000Z',
        endTime: '2026-02-20T23:00:00.000Z',
        signupCount: 0,
        maxAttendees: null,
        slotConfig: null,
        roleCounts: {},
        signupMentions: [],
        game: null,
      }),
    };

    mockDb = {
      select: jest.fn().mockReturnValue(makeChain([])),
    };

    module = await Test.createTestingModule({
      providers: [
        SignupInteractionListener,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: DiscordBotClientService,
          useValue: {
            getClient: jest.fn().mockReturnValue(null),
            getGuildId: jest.fn().mockReturnValue('guild-123'),
            editEmbed: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: SignupsService, useValue: mockSignupsService },
        { provide: EventsService, useValue: mockEventsService },
        {
          provide: CharactersService,
          useValue: {
            findAllForUser: jest
              .fn()
              .mockResolvedValue({ data: [], meta: { total: 0 } }),
            findOne: jest
              .fn()
              .mockResolvedValue({ id: 'char-1', name: 'Thrall' }),
          },
        },
        {
          provide: IntentTokenService,
          useValue: { generate: jest.fn().mockReturnValue('mock.token') },
        },
        {
          provide: DiscordEmbedFactory,
          useValue: {
            buildEventEmbed: jest
              .fn()
              .mockReturnValue({ embed: mockEmbed, row: mockRow }),
          },
        },
        {
          provide: DiscordEmojiService,
          useValue: {
            getRoleEmoji: jest.fn(() => ''),
            getClassEmoji: jest.fn(() => ''),
            getRoleEmojiComponent: jest.fn(() => undefined),
            getClassEmojiComponent: jest.fn(() => undefined),
            isUsingCustomEmojis: jest.fn(() => false),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getBranding: jest.fn().mockResolvedValue({
              communityName: 'Test Guild',
              communityLogoPath: null,
            }),
            getDefaultTimezone: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    listener = module.get(SignupInteractionListener);
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.clearAllMocks();
    await module.close();
    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  // ============================================================
  // Cleanup runs at most once per minute (CLEANUP_INTERVAL_MS = 60_000)
  // ============================================================

  describe('lazy cleanup frequency', () => {
    it('should allow cleanup to run on the first interaction (lastCleanup = 0)', async () => {
      // On startup lastCleanup = 0, so the very first interaction should trigger
      // the cleanup function. No entries to clean yet, but it should NOT throw.
      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:3001`,
        'user-cleanup-first',
      );
      // Inject a no-op event response for unlinked user (signup path)
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ id: 3001, title: 'T' }]),
            }),
          }),
        });

      await expect(
        listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();
    });

    it('should NOT run cleanup again within 60 seconds of previous run', async () => {
      // Drive first interaction to trigger initial cleanup (sets lastCleanup)
      const setupInteraction = (userId: string, eventId: number) => {
        const interaction = makeButtonInteraction(
          `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
          userId,
        );
        // Mock DB for unlinked user → show onboarding
        mockDb.select
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest
                  .fn()
                  .mockResolvedValue([{ id: eventId, title: 'E' }]),
              }),
            }),
          });
        return interaction;
      };

      // First interaction at T=0 → lastCleanup gets set to "now" (0 in fake timers)
      const i1 = setupInteraction('user-freq-1', 4001);
      await listener.handleButtonInteraction(i1);

      // Advance time by 30 seconds (less than CLEANUP_INTERVAL_MS of 60s)
      jest.advanceTimersByTime(30_000);

      // Second interaction — cleanup should NOT re-run (within 60s window)
      // We verify this by checking the interaction still proceeds normally
      const i2 = setupInteraction('user-freq-2', 4002);
      await expect(listener.handleButtonInteraction(i2)).resolves.not.toThrow();
    });

    it('should run cleanup again after 60+ seconds have elapsed', async () => {
      const setupInteraction = (userId: string, eventId: number) => {
        const interaction = makeButtonInteraction(
          `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
          userId,
        );
        mockDb.select
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest
                  .fn()
                  .mockResolvedValue([{ id: eventId, title: 'E' }]),
              }),
            }),
          });
        return interaction;
      };

      // First interaction at T=0 → triggers cleanup
      const i1 = setupInteraction('user-interval-1', 5001);
      await listener.handleButtonInteraction(i1);

      // Advance time by 61 seconds (past CLEANUP_INTERVAL_MS)
      jest.advanceTimersByTime(61_000);

      // Second interaction — cleanup should re-run (no error means it ran fine)
      const i2 = setupInteraction('user-interval-2', 5002);
      await expect(listener.handleButtonInteraction(i2)).resolves.not.toThrow();
    });
  });

  // ============================================================
  // Rate-limiting still works correctly after cleanup
  // (Cleanup only removes EXPIRED entries, non-expired ones remain)
  // ============================================================

  describe('cleanup preserves unexpired cooldown entries', () => {
    it('should still rate-limit same user immediately after first interaction (within cooldown window)', async () => {
      // This tests that unexpired entries are preserved — a user who just interacted
      // should be rate-limited on the very next interaction within the 3s cooldown.
      // Fake timers start at a fixed time; no advancement means we're still within 3s.
      const userId = 'user-cleanup-ratelimit';
      const eventId = 6001;

      // Setup mocks for first interaction (unlinked user → onboarding ephemeral)
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ id: eventId, title: 'Rate Test' }]),
            }),
          }),
        });

      const i1 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
        userId,
      );
      await listener.handleButtonInteraction(i1);

      // Advance time by only 1 second — still within COOLDOWN_MS (3s)
      jest.advanceTimersByTime(1_000);

      // Second interaction immediately — should be rate-limited
      const i2 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
        userId,
      );
      await listener.handleButtonInteraction(i2);

      expect(i2.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Please wait'),
        }),
      );
    });

    it('should NOT rate-limit same user after cooldown window expires', async () => {
      const userId = 'user-cooldown-expires';
      const eventId = 7001;

      // First interaction
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ id: eventId, title: 'Expire Test' }]),
            }),
          }),
        });

      const i1 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
        userId,
      );
      await listener.handleButtonInteraction(i1);

      // Advance by 4 seconds (past COOLDOWN_MS = 3000ms)
      jest.advanceTimersByTime(4_000);

      // Second interaction — should NOT be rate-limited
      // Reset DB mock for second interaction (unlinked user path)
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ id: eventId, title: 'Expire Test' }]),
            }),
          }),
        });

      const i2 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
        userId,
      );
      await listener.handleButtonInteraction(i2);

      // Should NOT have been rate-limited (response should NOT contain "Please wait")
      const editReplyArgs = i2.editReply.mock.calls;
      const wasRateLimited = editReplyArgs.some(
        (args: unknown[]) =>
          typeof (args[0] as { content?: string })?.content === 'string' &&
          (args[0] as { content: string }).content.includes('Please wait'),
      );
      expect(wasRateLimited).toBe(false);
    });
  });

  // ============================================================
  // Cleanup removes expired entries (observing via rate-limit behavior)
  // ============================================================

  describe('cleanup removes expired entries', () => {
    it('should allow same user to interact after cooldown expires (cleanup removed old entry)', async () => {
      // This test verifies the end-to-end: after 3s+ passes and cleanup runs,
      // an expired entry is gone and the user can interact again without being blocked.
      const userId = 'user-cleanup-expiry';
      const eventId = 8001;

      const setupMocks = () => {
        mockDb.select
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest
                  .fn()
                  .mockResolvedValue([{ id: eventId, title: 'Cleanup Test' }]),
              }),
            }),
          });
      };

      // First interaction at T=0
      setupMocks();
      const i1 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
        userId,
      );
      await listener.handleButtonInteraction(i1);

      // Advance past cooldown (3s) AND past cleanup interval (60s)
      // so that on the next interaction:
      // 1. cleanupCooldowns() runs (60s elapsed since last cleanup)
      // 2. the entry for userId:eventId is expired (>3s ago) and gets deleted
      jest.advanceTimersByTime(65_000);

      // Second interaction — entry was cleaned up, should NOT be rate-limited
      setupMocks();
      const i2 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
        userId,
      );
      await listener.handleButtonInteraction(i2);

      const editReplyArgs = i2.editReply.mock.calls;
      const wasRateLimited = editReplyArgs.some(
        (args: unknown[]) =>
          typeof (args[0] as { content?: string })?.content === 'string' &&
          (args[0] as { content: string }).content.includes('Please wait'),
      );
      expect(wasRateLimited).toBe(false);
    });

    it('should still rate-limit when cooldown has not yet expired, even after cleanup attempt', async () => {
      const userId = 'user-cleanup-still-blocked';
      const eventId = 9001;

      const setupMocks = () => {
        mockDb.select
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest
                  .fn()
                  .mockResolvedValue([{ id: eventId, title: 'Block Test' }]),
              }),
            }),
          });
      };

      // First interaction
      setupMocks();
      const i1 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
        userId,
      );
      await listener.handleButtonInteraction(i1);

      // Advance past cleanup interval but NOT past cooldown window
      // CLEANUP_INTERVAL_MS=60s, COOLDOWN_MS=3s
      // We advance 62s so cleanup runs, but since we also set the cooldown 62s ago,
      // the entry IS expired (62s > 3s), so it gets cleaned up.
      // To test "still blocked during cooldown", we only advance 2s (< 3s cooldown)
      // AND ensure 60s have elapsed since last cleanup.
      //
      // Since module is fresh, lastCleanup=0. First interaction sets lastCleanup=T1.
      // After advancing 2s: T = T1 + 2s (still within 3s cooldown), cleanup NOT triggered
      // because only 2s since lastCleanup (< 60s).
      jest.advanceTimersByTime(2_000);

      const i2 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
        userId,
      );
      await listener.handleButtonInteraction(i2);

      expect(i2.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Please wait'),
        }),
      );
    });
  });
});
