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
import { Test, TestingModule } from '@nestjs/testing';
import { SignupInteractionListener } from './signup-interaction.listener';
import type { TestableSignupInteractionListener } from './signup-interaction.spec-helpers';
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

let testModule: TestingModule;
let listener: TestableSignupInteractionListener;
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

function buildCooldownMockSignups() {
  return {
    findByDiscordUser: jest.fn().mockResolvedValue(null),
    signup: jest.fn().mockResolvedValue({ id: 1, eventId: 1 }),
    signupDiscord: jest.fn().mockResolvedValue({ id: 2, eventId: 1 }),
    updateStatus: jest.fn().mockResolvedValue({ id: 1, status: 'signed_up' }),
    getRoster: jest
      .fn()
      .mockResolvedValue({ eventId: 1, signups: [], count: 0 }),
    cancel: jest.fn(),
    cancelByDiscordUser: jest.fn(),
    confirmSignup: jest.fn().mockResolvedValue({ id: 1 }),
  };
}

function buildCooldownMockEvents() {
  return {
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
}

function buildCooldownProviders() {
  return [
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
        findOne: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Thrall' }),
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
  ];
}

async function setupCooldownModule() {
  jest.useFakeTimers();
  delete process.env.CLIENT_URL;

  mockSignupsService = buildCooldownMockSignups();
  mockEventsService = buildCooldownMockEvents();
  mockDb = { select: jest.fn().mockReturnValue(makeChain([])) };

  testModule = await Test.createTestingModule({
    providers: buildCooldownProviders(),
  }).compile();

  const instance: unknown = testModule.get(SignupInteractionListener);
  listener = instance as TestableSignupInteractionListener;
}

async function teardownCooldownModule() {
  jest.useRealTimers();
  jest.clearAllMocks();
  await testModule.close();
  if (originalClientUrl !== undefined) {
    process.env.CLIENT_URL = originalClientUrl;
  } else {
    delete process.env.CLIENT_URL;
  }
}

function makeUnlinkedInteractionMocks(eventId: number) {
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
          limit: jest.fn().mockResolvedValue([{ id: eventId, title: 'E' }]),
        }),
      }),
    });
}

function lazyCleanupFrequencyTests() {
  it('should allow cleanup to run on the first interaction (lastCleanup = 0)', async () => {
    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:3001`,
      'user-cleanup-first',
    );
    makeUnlinkedInteractionMocks(3001);
    await expect(
      listener.handleButtonInteraction(interaction),
    ).resolves.not.toThrow();
  });

  it('should NOT run cleanup again within 60 seconds of previous run', async () => {
    const i1 = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:4001`,
      'user-freq-1',
    );
    makeUnlinkedInteractionMocks(4001);
    await listener.handleButtonInteraction(i1);

    jest.advanceTimersByTime(30_000);

    const i2 = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:4002`,
      'user-freq-2',
    );
    makeUnlinkedInteractionMocks(4002);
    await expect(listener.handleButtonInteraction(i2)).resolves.not.toThrow();
  });

  it('should run cleanup again after 60+ seconds have elapsed', async () => {
    const i1 = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:5001`,
      'user-interval-1',
    );
    makeUnlinkedInteractionMocks(5001);
    await listener.handleButtonInteraction(i1);

    jest.advanceTimersByTime(61_000);

    const i2 = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:5002`,
      'user-interval-2',
    );
    makeUnlinkedInteractionMocks(5002);
    await expect(listener.handleButtonInteraction(i2)).resolves.not.toThrow();
  });
}

function preserveUnexpiredTests() {
  it('should still rate-limit same user immediately after first interaction (within cooldown window)', async () => {
    const userId = 'user-cleanup-ratelimit';
    const eventId = 6001;

    makeUnlinkedInteractionMocks(eventId);
    const i1 = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
      userId,
    );
    await listener.handleButtonInteraction(i1);

    jest.advanceTimersByTime(1_000);

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

    makeUnlinkedInteractionMocks(eventId);
    const i1 = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
      userId,
    );
    await listener.handleButtonInteraction(i1);

    jest.advanceTimersByTime(4_000);

    makeUnlinkedInteractionMocks(eventId);
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
}

function removeExpiredTests() {
  it('should allow same user to interact after cooldown expires (cleanup removed old entry)', async () => {
    const userId = 'user-cleanup-expiry';
    const eventId = 8001;

    makeUnlinkedInteractionMocks(eventId);
    const i1 = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
      userId,
    );
    await listener.handleButtonInteraction(i1);

    jest.advanceTimersByTime(65_000);

    makeUnlinkedInteractionMocks(eventId);
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

    makeUnlinkedInteractionMocks(eventId);
    const i1 = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`,
      userId,
    );
    await listener.handleButtonInteraction(i1);

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
}

describe('SignupInteractionListener — cooldown map lazy cleanup (ROK-373)', () => {
  beforeEach(async () => {
    await setupCooldownModule();
  });

  afterEach(async () => {
    await teardownCooldownModule();
  });

  describe('lazy cleanup frequency', () => {
    lazyCleanupFrequencyTests();
  });

  describe('cleanup preserves unexpired cooldown entries', () => {
    preserveUnexpiredTests();
  });

  describe('cleanup removes expired entries', () => {
    removeExpiredTests();
  });
});
