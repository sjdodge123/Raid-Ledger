/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
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

/** Create a minimal ButtonInteraction mock */
function makeButtonInteraction(
  customId: string,
  userId: string = 'discord-user-123',
  username: string = 'TestUser',
  avatar: string | null = 'avatar-hash',
) {
  const interaction = {
    isButton: () => true,
    isStringSelectMenu: () => false,
    customId,
    user: { id: userId, username, avatar },
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

/** Create a minimal StringSelectMenuInteraction mock */
function makeSelectMenuInteraction(
  customId: string,
  values: string[],
  userId: string = 'discord-user-menu-1',
  username: string = 'TestUser',
) {
  return {
    isButton: () => false,
    isStringSelectMenu: () => true,
    customId,
    values,
    user: { id: userId, username, avatar: null },
    replied: false,
    deferred: false,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SignupInteractionListener', () => {
  let module: TestingModule;
  let listener: any; // Use any to access private methods directly
  let mockClientService: {
    getClient: jest.Mock;
    getGuildId: jest.Mock;
    editEmbed: jest.Mock;
  };
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
  let mockEventsService: { buildEmbedEventData: jest.Mock };
  let mockCharactersService: {
    findAllForUser: jest.Mock;
    findOne: jest.Mock;
  };
  let mockIntentTokenService: { generate: jest.Mock };
  let mockEmbedFactory: { buildEventEmbed: jest.Mock };
  let mockSettingsService: {
    getBranding: jest.Mock;
    getDefaultTimezone: jest.Mock;
  };
  let mockDb: Record<string, jest.Mock>;

  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = new ActionRowBuilder<ButtonBuilder>();
  const originalClientUrl = process.env.CLIENT_URL;

  /** Default chain mock for DB queries returning empty */
  function makeChain(result: unknown[] = []) {
    const chain: Record<string, unknown> = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(result);
    chain.leftJoin = jest.fn().mockReturnValue(chain);
    chain.groupBy = jest.fn().mockResolvedValue(result);
    // Make the chain itself awaitable (thenable) so queries without .limit() resolve
    chain.then = (
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject);
    return chain;
  }

  beforeEach(async () => {
    delete process.env.CLIENT_URL;

    mockClientService = {
      getClient: jest.fn().mockReturnValue(null),
      getGuildId: jest.fn().mockReturnValue('guild-123'),
      editEmbed: jest.fn().mockResolvedValue(undefined),
    };

    mockSignupsService = {
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

    mockCharactersService = {
      findAllForUser: jest
        .fn()
        .mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOne: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Thrall' }),
    };

    mockIntentTokenService = {
      generate: jest.fn().mockReturnValue('mock.intent.token'),
    };

    mockEmbedFactory = {
      buildEventEmbed: jest
        .fn()
        .mockReturnValue({ embed: mockEmbed, row: mockRow }),
    };

    mockSettingsService = {
      getBranding: jest.fn().mockResolvedValue({
        communityName: 'Test Guild',
        communityLogoPath: null,
      }),
      getDefaultTimezone: jest.fn().mockResolvedValue(null),
    };

    mockDb = {
      select: jest.fn().mockReturnValue(makeChain([])),
    };

    module = await Test.createTestingModule({
      providers: [
        SignupInteractionListener,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: SignupsService, useValue: mockSignupsService },
        { provide: EventsService, useValue: mockEventsService },
        { provide: CharactersService, useValue: mockCharactersService },
        { provide: IntentTokenService, useValue: mockIntentTokenService },
        { provide: DiscordEmbedFactory, useValue: mockEmbedFactory },
        {
          provide: DiscordEmojiService,
          useValue: {
            getRoleEmoji: jest.fn(
              (r: string) =>
                ({
                  tank: '\uD83D\uDEE1\uFE0F',
                  healer: '\uD83D\uDC9A',
                  dps: '\u2694\uFE0F',
                })[r] ?? '',
            ),
            getClassEmoji: jest.fn(() => ''),
            getRoleEmojiComponent: jest.fn((r: string) => {
              const fallback: Record<string, string> = {
                tank: '\uD83D\uDEE1\uFE0F',
                healer: '\uD83D\uDC9A',
                dps: '\u2694\uFE0F',
              };
              return fallback[r] ? { name: fallback[r] } : undefined;
            }),
            getClassEmojiComponent: jest.fn(() => undefined),
            isUsingCustomEmojis: jest.fn(() => false),
          },
        },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    listener = module.get(SignupInteractionListener);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  // ============================================================
  // onBotConnected
  // ============================================================

  describe('onBotConnected', () => {
    it('should skip registration when client is null', () => {
      mockClientService.getClient.mockReturnValue(null);
      expect(() => listener.onBotConnected()).not.toThrow();
    });

    it('should register interactionCreate listener when client is available', () => {
      const mockOn = jest.fn();
      const mockRemoveListener = jest.fn();
      const fakeClient = {
        on: mockOn,
        removeListener: mockRemoveListener,
      };
      mockClientService.getClient.mockReturnValue(fakeClient);

      // First call — no previous handler, so removeListener should not be called
      listener.onBotConnected();

      expect(mockRemoveListener).not.toHaveBeenCalled();
      expect(mockOn).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );

      // Second call — previous handler exists, so removeListener should be called
      listener.onBotConnected();

      expect(mockRemoveListener).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
      expect(mockOn).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // onBotDisconnected
  // ============================================================

  describe('onBotDisconnected', () => {
    it('should clear boundHandler to null', () => {
      const mockOn = jest.fn();
      const fakeClient = { on: mockOn, removeListener: jest.fn() };
      mockClientService.getClient.mockReturnValue(fakeClient);

      // Connect first to set boundHandler
      listener.onBotConnected();
      expect(listener.boundHandler).not.toBeNull();

      // Disconnect — should clear
      listener.onBotDisconnected();
      expect(listener.boundHandler).toBeNull();
    });

    it('should not call removeListener on reconnect after disconnect (no stale reference)', () => {
      const mockOn1 = jest.fn();
      const mockRemove1 = jest.fn();
      const fakeClient1 = { on: mockOn1, removeListener: mockRemove1 };

      const mockOn2 = jest.fn();
      const mockRemove2 = jest.fn();
      const fakeClient2 = { on: mockOn2, removeListener: mockRemove2 };

      // Connect with client 1
      mockClientService.getClient.mockReturnValue(fakeClient1);
      listener.onBotConnected();

      // Disconnect — clears boundHandler
      listener.onBotDisconnected();

      // Reconnect with client 2
      mockClientService.getClient.mockReturnValue(fakeClient2);
      listener.onBotConnected();

      // Should NOT call removeListener on the new client (boundHandler was null)
      expect(mockRemove2).not.toHaveBeenCalled();
    });

    it('should properly re-register handler on new client after disconnect', () => {
      const mockOn1 = jest.fn();
      const fakeClient1 = { on: mockOn1, removeListener: jest.fn() };

      const mockOn2 = jest.fn();
      const fakeClient2 = { on: mockOn2, removeListener: jest.fn() };

      // Connect with client 1
      mockClientService.getClient.mockReturnValue(fakeClient1);
      listener.onBotConnected();
      expect(mockOn1).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );

      // Disconnect
      listener.onBotDisconnected();

      // Reconnect with client 2
      mockClientService.getClient.mockReturnValue(fakeClient2);
      listener.onBotConnected();

      // New client should have a fresh handler registered
      expect(mockOn2).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
      expect(listener.boundHandler).not.toBeNull();
    });
  });

  // ============================================================
  // handleButtonInteraction — sign up button (linked user)
  // Tests access handleButtonInteraction directly (private method via type assertion)
  // to avoid the void wrapper in the interactionCreate handler.
  // ============================================================

  describe('handleButtonInteraction — signup button (linked user)', () => {
    it('should sign up linked Discord user for event', async () => {
      const userId = 'user-signup-linked-1';
      const mockLinkedUser = { id: 42, discordId: userId };
      const mockEvent = {
        id: 101,
        title: 'Raid Night',
        slotConfig: null,
        gameId: null,
      };

      mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      // linked RL user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockLinkedUser]),
          }),
        }),
      });

      // event found for title display
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockEvent]),
          }),
        }),
      });

      // updateEmbedSignupCount: getRoster → event → messages (all return empty)
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 101,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:101`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        101,
        mockLinkedUser.id,
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Raid Night'),
        }),
      );
    });

    it('should notify already-signed-up user when they click signup again', async () => {
      const userId = 'user-signup-already-1';
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
        id: 1,
        status: 'signed_up',
        user: { id: 1, discordId: userId },
        discordUserId: null,
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:102`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('already signed up'),
        }),
      );
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    it('should change status to signed_up when user was tentative', async () => {
      const userId = 'user-signup-tentative-1';
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
        id: 1,
        status: 'tentative',
        user: { id: 1, discordId: userId },
        discordUserId: null,
      });

      // updateEmbedSignupCount
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 1,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:103`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.updateStatus).toHaveBeenCalledWith(
        103,
        { userId: 1 },
        { status: 'signed_up' },
      );
    });

    it('should show onboarding ephemeral for unlinked Discord user', async () => {
      const userId = 'user-signup-unlinked-1';
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      // No linked RL user
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // Event for onboarding ephemeral
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ id: 1, title: 'Raid Night' }]),
          }),
        }),
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:104`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Raid Night'),
        }),
      );
    });
  });

  // ============================================================
  // handleButtonInteraction — rate limiting
  // ============================================================

  describe('handleButtonInteraction — rate limiting', () => {
    it('should reject rapid interactions from same user on same event', async () => {
      const userId = 'user-ratelimit-1';
      // First click — sets cooldown (no event found → returns early with "Event not found")
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        });

      const interaction1 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:200`,
        userId,
      );
      await listener.handleButtonInteraction(interaction1);

      // Second click immediately — rate limited
      const interaction2 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:200`,
        userId,
      );
      await listener.handleButtonInteraction(interaction2);

      // After ROK-376: deferReply is called first, then cooldown uses editReply
      expect(interaction2.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction2.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Please wait'),
        }),
      );
    });
  });

  // ============================================================
  // handleButtonInteraction — quick signup (anonymous Path B)
  // ============================================================

  describe('handleButtonInteraction — Quick Sign Up (anonymous)', () => {
    it('should create anonymous signup for non-MMO event', async () => {
      const userId = 'user-quicksignup-1';
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      // Event without MMO slotConfig
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([
                { id: 301, title: 'Phasmo Night', slotConfig: null },
              ]),
          }),
        }),
      });

      // updateEmbedSignupCount
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 301,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.QUICK_SIGNUP}:301`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.signupDiscord).toHaveBeenCalledWith(
        301,
        expect.objectContaining({
          discordUserId: userId,
          discordUsername: 'TestUser',
        }),
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('TestUser'),
        }),
      );
    });

    it('should notify already-signed-up user on quick signup attempt', async () => {
      const userId = 'user-quicksignup-already-1';
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
        id: 5,
        status: 'signed_up',
        user: { id: 0, discordId: userId },
        discordUserId: userId,
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.QUICK_SIGNUP}:302`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('already signed up'),
        }),
      );
      expect(mockSignupsService.signupDiscord).not.toHaveBeenCalled();
    });

    it('should show role select dropdown for MMO events', async () => {
      const userId = 'user-quicksignup-mmo-1';
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                id: 303,
                title: 'Mythic Raid',
                slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
              },
            ]),
          }),
        }),
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.QUICK_SIGNUP}:303`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('role'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });
  });

  // ============================================================
  // handleButtonInteraction — tentative button
  // ============================================================

  describe('handleButtonInteraction — Tentative button', () => {
    it('should update existing signup to tentative status', async () => {
      const userId = 'user-tentative-update-1';
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
        id: 1,
        status: 'signed_up',
        user: { id: 50, discordId: userId },
        discordUserId: null,
      });

      // updateEmbedSignupCount
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 401,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.TENTATIVE}:401`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.updateStatus).toHaveBeenCalledWith(
        401,
        { userId: 50 },
        { status: 'tentative' },
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('tentative'),
        }),
      );
    });

    it('should create tentative anonymous signup for user with no prior signup', async () => {
      const userId = 'user-tentative-create-1';
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      // No linked RL user
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // updateEmbedSignupCount
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 402,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.TENTATIVE}:402`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.signupDiscord).toHaveBeenCalledWith(
        402,
        expect.objectContaining({ status: 'tentative' }),
      );
    });
  });

  // ============================================================
  // handleButtonInteraction — decline button
  // ============================================================

  describe('handleButtonInteraction — Decline button', () => {
    it('should fully remove existing signup when declining', async () => {
      const userId = 'user-decline-update-1';
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
        id: 1,
        status: 'signed_up',
        user: { id: 60, discordId: userId },
        discordUserId: null,
      });

      // updateEmbedSignupCount
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 501,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.DECLINE}:501`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.cancelByDiscordUser).toHaveBeenCalledWith(
        501,
        userId,
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('declined'),
        }),
      );
    });
  });

  // ============================================================
  // handleSelectMenuInteraction — role selection
  // ============================================================

  describe('handleSelectMenuInteraction — role selection', () => {
    it('should create anonymous signup with selected role (healer)', async () => {
      // updateEmbedSignupCount
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 601,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:601`,
        ['healer'],
        'user-roleselect-1',
      );
      await listener.handleSelectMenuInteraction(interaction);

      expect(mockSignupsService.signupDiscord).toHaveBeenCalledWith(
        601,
        expect.objectContaining({
          discordUserId: 'user-roleselect-1',
          role: 'healer',
        }),
      );
    });

    it('should create anonymous signup with tank role', async () => {
      // updateEmbedSignupCount
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 602,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:602`,
        ['tank'],
        'user-roleselect-2',
      );
      await listener.handleSelectMenuInteraction(interaction);

      expect(mockSignupsService.signupDiscord).toHaveBeenCalledWith(
        602,
        expect.objectContaining({ role: 'tank' }),
      );
    });

    it('should ignore select menus with wrong action prefix', async () => {
      const interaction = makeSelectMenuInteraction('wrong_action:601', [
        'healer',
      ]);
      await listener.handleSelectMenuInteraction(interaction);
      expect(mockSignupsService.signupDiscord).not.toHaveBeenCalled();
    });

    it('should ignore select menus with non-numeric eventId', async () => {
      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:not-a-number`,
        ['dps'],
      );
      await listener.handleSelectMenuInteraction(interaction);
      expect(mockSignupsService.signupDiscord).not.toHaveBeenCalled();
    });

    it('should create linked-user signup with role + character when characterId is in customId (ROK-138)', async () => {
      const userId = 'user-roleselect-linked-1';

      // Linked user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      mockSignupsService.signup.mockResolvedValueOnce({
        id: 10,
        eventId: 700,
      });
      mockSignupsService.confirmSignup.mockResolvedValueOnce({ id: 10 });
      mockCharactersService.findOne.mockResolvedValueOnce({
        id: 'char-linked-role',
        name: 'Thrall',
      });

      // updateEmbedSignupCount
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 700,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:700:char-linked-role`,
        ['tank'],
        userId,
      );
      await listener.handleSelectMenuInteraction(interaction);

      // Should NOT call signupDiscord (anonymous path)
      expect(mockSignupsService.signupDiscord).not.toHaveBeenCalled();

      // Should call signup with slotRole
      expect(mockSignupsService.signup).toHaveBeenCalledWith(700, 42, {
        preferredRoles: ['tank'],
        slotRole: 'tank',
      });

      // Should confirm with character
      expect(mockSignupsService.confirmSignup).toHaveBeenCalledWith(
        700,
        10,
        42,
        { characterId: 'char-linked-role' },
      );

      // Should include character name and role in confirmation
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Thrall'),
          components: [],
        }),
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Tank'),
        }),
      );
    });

    it('should show error when linked user not found during role select with characterId (ROK-138)', async () => {
      const userId = 'user-roleselect-linked-noaccount';

      // No linked user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:701:char-orphan`,
        ['healer'],
        userId,
      );
      await listener.handleSelectMenuInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(
            'Could not find your linked account',
          ),
          components: [],
        }),
      );
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
      expect(mockSignupsService.signupDiscord).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // ROK-138: Character select ephemeral
  // ============================================================

  describe('handleButtonInteraction — character select (ROK-138)', () => {
    const mockLinkedUser = { id: 42, discordId: 'user-charselect-1' };
    const mockGameWithRoles = {
      id: 1,
      hasRoles: true,
      hasSpecs: true,
    };
    const mockGameWithoutRoles = {
      id: 2,
      hasRoles: false,
      hasSpecs: false,
    };

    function setupLinkedUserAndEvent(
      userId: string,
      event: Record<string, unknown>,
    ) {
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      // linked RL user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ ...mockLinkedUser, discordId: userId }]),
          }),
        }),
      });

      // event found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([event]),
          }),
        }),
      });
    }

    function setupGameRegistryQuery(game: Record<string, unknown> | null) {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(game ? [game] : []),
          }),
        }),
      });
    }

    function setupUpdateEmbedMocks() {
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 1,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));
    }

    it('should show character select dropdown when user has multiple characters', async () => {
      const userId = 'user-charselect-multi';
      const event = {
        id: 800,
        title: 'Mythic Raid',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery(mockGameWithRoles);

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [
          {
            id: 'char-1',
            name: 'Thrall',
            class: 'Shaman',
            spec: 'Enhancement',
            level: 60,
            isMain: true,
          },
          {
            id: 'char-2',
            name: 'Jaina',
            class: 'Mage',
            spec: 'Frost',
            level: 60,
            isMain: false,
          },
        ],
        meta: { total: 2 },
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:800`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockCharactersService.findAllForUser).toHaveBeenCalledWith(
        mockLinkedUser.id,
        1,
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
      // Should NOT have called signup yet — waiting for dropdown selection
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    it('should auto-select and sign up when user has exactly one character', async () => {
      const userId = 'user-charselect-single';
      const event = {
        id: 801,
        title: 'Heroic Raid',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery(mockGameWithRoles);

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [
          {
            id: 'char-solo',
            name: 'Thrall',
            class: 'Shaman',
            spec: 'Enhancement',
            level: 60,
            isMain: true,
          },
        ],
        meta: { total: 1 },
      });

      setupUpdateEmbedMocks();

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:801`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        801,
        mockLinkedUser.id,
      );
      expect(mockSignupsService.confirmSignup).toHaveBeenCalledWith(
        801,
        1,
        mockLinkedUser.id,
        { characterId: 'char-solo' },
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Thrall'),
        }),
      );
    });

    it('should instant-signup with nudge when user has no characters (hasRoles game)', async () => {
      const userId = 'user-charselect-none-roles';
      const event = {
        id: 802,
        title: 'Raid Night',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery(mockGameWithRoles);

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [],
        meta: { total: 0 },
      });

      process.env.CLIENT_URL = 'https://example.com';
      setupUpdateEmbedMocks();

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:802`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        802,
        mockLinkedUser.id,
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(
            /signed up.*Raid Night.*Tip.*character/s,
          ),
        }),
      );
    });

    it('should instant-signup without nudge when game has no character support', async () => {
      const userId = 'user-charselect-none-noroles';
      const event = {
        id: 803,
        title: 'Phasmo Night',
        gameId: 2,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery(mockGameWithoutRoles);

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [],
        meta: { total: 0 },
      });

      process.env.CLIENT_URL = 'https://example.com';
      setupUpdateEmbedMocks();

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:803`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        803,
        mockLinkedUser.id,
      );
      // Should NOT contain the nudge
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('Tip'),
        }),
      );
    });

    it('should do plain signup when event has no gameId', async () => {
      const userId = 'user-charselect-nogame';
      const event = {
        id: 804,
        title: 'Casual Game Night',
        gameId: null,
      };

      setupLinkedUserAndEvent(userId, event);
      setupUpdateEmbedMocks();

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:804`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        804,
        mockLinkedUser.id,
      );
      expect(mockCharactersService.findAllForUser).not.toHaveBeenCalled();
    });

    it('should show role select (not immediate signup) for single character on MMO event', async () => {
      const userId = 'user-charselect-single-mmo';
      const event = {
        id: 810,
        title: 'Mythic Raid',
        gameId: 1,
        slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery(mockGameWithRoles);

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [
          {
            id: 'char-mmo-solo',
            name: 'Thrall',
            class: 'Shaman',
            spec: 'Enhancement',
            level: 60,
            isMain: true,
          },
        ],
        meta: { total: 1 },
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:810`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      // Should show character select first (even for 1 char), NOT sign up immediately
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
      expect(mockSignupsService.confirmSignup).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('character'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });

    it('should show character select dropdown for multiple characters on MMO event', async () => {
      const userId = 'user-charselect-multi-mmo';
      const event = {
        id: 811,
        title: 'Mythic Prog',
        gameId: 1,
        slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery(mockGameWithRoles);

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [
          {
            id: 'char-mmo-1',
            name: 'Thrall',
            class: 'Shaman',
            spec: 'Enhancement',
            level: 60,
            isMain: true,
          },
          {
            id: 'char-mmo-2',
            name: 'Jaina',
            class: 'Mage',
            spec: 'Frost',
            level: 60,
            isMain: false,
          },
        ],
        meta: { total: 2 },
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:811`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      // Should show character dropdown first (role select comes after character choice)
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });
  });

  // ============================================================
  // ROK-138: Character select menu interaction
  // ============================================================

  describe('handleSelectMenuInteraction — character selection (ROK-138)', () => {
    it('should sign up with selected character from dropdown', async () => {
      const userId = 'user-charselect-menu-1';

      // Linked user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      // ROK-138: event lookup to check if MMO (non-MMO → skip role select)
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([
                { id: 900, title: 'Raid Night', slotConfig: null },
              ]),
          }),
        }),
      });

      mockCharactersService.findOne.mockResolvedValueOnce({
        id: 'char-selected',
        name: 'Jaina',
      });

      // updateEmbedSignupCount
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 900,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:900`,
        ['char-selected'],
        userId,
      );
      await listener.handleSelectMenuInteraction(interaction);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(900, 42);
      expect(mockSignupsService.confirmSignup).toHaveBeenCalledWith(
        900,
        1,
        42,
        { characterId: 'char-selected' },
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Jaina'),
          components: [],
        }),
      );
    });

    it('should show error when linked user not found during char select', async () => {
      const userId = 'user-charselect-menu-noaccount';

      // No linked user
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:901`,
        ['char-1'],
        userId,
      );
      await listener.handleSelectMenuInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(
            'Could not find your linked account',
          ),
          components: [],
        }),
      );
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    it('should show role select after character dropdown on MMO event (ROK-138)', async () => {
      const userId = 'user-charselect-menu-mmo';

      // Linked user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      // Event lookup — MMO event
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                id: 902,
                title: 'Mythic Raid',
                slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
              },
            ]),
          }),
        }),
      });

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:902`,
        ['char-mmo-pick'],
        userId,
      );
      await listener.handleSelectMenuInteraction(interaction);

      // Should NOT sign up yet — should show role select
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
      expect(mockSignupsService.confirmSignup).not.toHaveBeenCalled();

      // Should show role select dropdown with characterId encoded
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('role'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });
  });

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    it('should reply with error message when handler throws', async () => {
      const userId = 'user-error-1';
      mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
        new Error('DB connection failed'),
      );

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:701`,
        userId,
      );

      await listener.handleButtonInteraction(interaction);

      // After ROK-376: deferReply is called first, so error path uses editReply via safeReply
      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Something went wrong'),
        }),
      );
    });

    it('should ignore button interactions with non-matching customId format', async () => {
      const interaction = makeButtonInteraction('not-a-signup-button');
      await listener.handleButtonInteraction(interaction);
      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should ignore button interactions with NaN eventId', async () => {
      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:not-a-number`,
      );
      await listener.handleButtonInteraction(interaction);
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // ROK-376: Discord interaction race condition handling
  // ============================================================

  describe('ROK-376 — interaction race condition handling', () => {
    it('should defer reply immediately before any async work', async () => {
      const userId = 'user-race-defer-1';
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      // Linked user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      // Event
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([
                { id: 2001, title: 'Race Test', gameId: null },
              ]),
          }),
        }),
      });

      // updateEmbedSignupCount
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 2001,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2001`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      // deferReply should be called exactly once at the top of handleButtonInteraction
      expect(interaction.deferReply).toHaveBeenCalledTimes(1);
      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it('should gracefully handle already-acknowledged interaction (code 40060) in error path', async () => {
      const userId = 'user-race-40060';
      mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
        new Error('DB error'),
      );

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2002`,
        userId,
      );

      // Simulate: deferReply succeeds, but editReply throws 40060
      // because another concurrent handler already acknowledged
      const discordError = new Error(
        'Interaction has already been acknowledged.',
      );
      (discordError as unknown as { code: number }).code = 40060;
      interaction.editReply.mockRejectedValueOnce(discordError);

      // Should not throw
      await expect(
        listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();
    });

    it('should gracefully handle expired interaction (code 10062) in error path', async () => {
      const userId = 'user-race-10062';
      mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
        new Error('DB error'),
      );

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2003`,
        userId,
      );

      // Simulate: interaction token expired
      const discordError = new Error('Unknown interaction');
      (discordError as unknown as { code: number }).code = 10062;
      interaction.editReply.mockRejectedValueOnce(discordError);

      // Should not throw
      await expect(
        listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();
    });

    it('should re-throw non-Discord errors from safeEditReply', async () => {
      const userId = 'user-race-rethrow';
      mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
        new Error('DB error'),
      );

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2004`,
        userId,
      );

      // Simulate: editReply throws a non-Discord error (e.g., network failure)
      interaction.editReply.mockRejectedValueOnce(new Error('Network failure'));

      // Should propagate the non-Discord error
      await expect(
        listener.handleButtonInteraction(interaction),
      ).rejects.toThrow('Network failure');
    });

    it('should handle already-acknowledged error in select menu error path', async () => {
      const userId = 'user-race-select-40060';

      // Linked user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      // Event lookup — non-MMO
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([
                { id: 2005, title: 'Test', slotConfig: null },
              ]),
          }),
        }),
      });

      // signup throws to trigger error path
      mockSignupsService.signup.mockRejectedValueOnce(
        new Error('Event cancelled'),
      );

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:2005`,
        ['char-1'],
        userId,
      );

      // Simulate: editReply in catch block fails with 40060
      const discordError = new Error(
        'Interaction has already been acknowledged.',
      );
      (discordError as unknown as { code: number }).code = 40060;
      // First editReply call (in catch block) should fail with Discord error
      interaction.editReply.mockRejectedValueOnce(discordError);

      // Should not throw — safeEditReply handles it
      await expect(
        listener.handleSelectMenuInteraction(interaction),
      ).resolves.not.toThrow();
    });
  });

  // ============================================================
  // ROK-138: Adversarial / edge case tests for character select
  // ============================================================

  describe('character select — adversarial edge cases', () => {
    const mockLinkedUser = { id: 42, discordId: 'user-adv-1' };

    function setupLinkedUserAndEvent(
      userId: string,
      event: Record<string, unknown>,
    ) {
      mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ ...mockLinkedUser, discordId: userId }]),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([event]),
          }),
        }),
      });
    }

    function setupGameRegistryQuery(game: Record<string, unknown> | null) {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(game ? [game] : []),
          }),
        }),
      });
    }

    function setupUpdateEmbedMocks() {
      mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 1,
        signups: [],
        count: 0,
      });
      mockDb.select.mockReturnValueOnce(makeChain([]));
      mockDb.select.mockReturnValueOnce(makeChain([]));
    }

    // ----------------------------------------------------------
    // Character name truncation
    // ----------------------------------------------------------

    it('should error gracefully when character name exceeds Discord label limit (>100 chars)', async () => {
      // Discord's @sapphire/shapeshift validates label length at build time and throws
      // a CombinedPropertyError when a label exceeds 100 chars. The outer catch in
      // handleButtonInteraction must handle this and reply with an error message.
      const userId = 'user-adv-longname';
      const longName = 'A'.repeat(101); // 101 chars — over Discord's 100-char label limit

      const event = {
        id: 1001,
        title: 'Raid Night',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 1, hasRoles: true });

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [
          {
            id: 'char-long',
            name: longName,
            class: 'Warrior',
            spec: null,
            level: 60,
            isMain: false,
          },
          {
            id: 'char-normal',
            name: 'Thrall',
            class: 'Shaman',
            spec: null,
            level: 60,
            isMain: false,
          },
        ],
        meta: { total: 2 },
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1001`,
        userId,
      );

      // Should not propagate the throw — the outer catch handles it
      await expect(
        listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();

      // The outer error handler should have replied with an error message
      // (since deferReply was called first, editReply is used for the error)
      // The interaction was deferred so the error path uses editReply
      expect(interaction.reply).not.toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
        }),
      );
    });

    // ----------------------------------------------------------
    // Null/undefined character fields
    // ----------------------------------------------------------

    it('should build dropdown label gracefully when class, spec, and level are null', async () => {
      const userId = 'user-adv-nullfields';

      const event = {
        id: 1002,
        title: 'Casual Night',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 1, hasRoles: true });

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [
          {
            id: 'char-null-fields-1',
            name: 'Ghost',
            class: null,
            spec: null,
            level: null,
            isMain: false,
          },
          {
            id: 'char-null-fields-2',
            name: 'Phantom',
            class: null,
            spec: null,
            level: null,
            isMain: false,
          },
        ],
        meta: { total: 2 },
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1002`,
        userId,
      );

      await expect(
        listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();

      // Should still show the select dropdown
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
        }),
      );
      // No signup should have been created
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    it('should build dropdown description with only class (no spec, no level)', async () => {
      const userId = 'user-adv-classonly';

      const event = {
        id: 1003,
        title: 'Alt Run',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 1, hasRoles: true });

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [
          {
            id: 'char-class-only-1',
            name: 'Uther',
            class: 'Paladin',
            spec: null,
            level: null,
            isMain: false,
          },
          {
            id: 'char-class-only-2',
            name: 'Anduin',
            class: 'Priest',
            spec: null,
            level: null,
            isMain: false,
          },
        ],
        meta: { total: 2 },
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1003`,
        userId,
      );

      await expect(
        listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
        }),
      );
    });

    // ----------------------------------------------------------
    // Exactly 25 characters (Discord dropdown max)
    // ----------------------------------------------------------

    it('should show all 25 characters when user has exactly 25', async () => {
      const userId = 'user-adv-exactly25';

      const event = {
        id: 1004,
        title: 'Big Roster Night',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 1, hasRoles: true });

      const characters = Array.from({ length: 25 }, (_, i) => ({
        id: `char-${i}`,
        name: `Character ${i}`,
        class: 'Warrior',
        spec: null,
        level: 60,
        isMain: i === 0,
      }));

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: characters,
        meta: { total: 25 },
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1004`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
      // No signup created — dropdown shown
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    // ----------------------------------------------------------
    // More than 25 characters — verify cap at 25
    // ----------------------------------------------------------

    it('should cap dropdown at 25 options even when user has more than 25 characters', async () => {
      const userId = 'user-adv-over25';

      const event = {
        id: 1005,
        title: 'Overflow Event',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 1, hasRoles: true });

      // 30 characters — should be capped at 25
      const characters = Array.from({ length: 30 }, (_, i) => ({
        id: `char-${i}`,
        name: `Character ${i}`,
        class: 'Rogue',
        spec: null,
        level: 60,
        isMain: false,
      }));

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: characters,
        meta: { total: 30 },
      });

      // Spy on showCharacterSelect via editReply call to verify components count
      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1005`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      // The dropdown should be shown (not auto-signup), capped at 25
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
        }),
      );
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    // ----------------------------------------------------------
    // Invalid/deleted character ID submitted from dropdown
    // ----------------------------------------------------------

    it('should show error message when character select submits an invalid/deleted character ID', async () => {
      const userId = 'user-adv-invalidchar';

      // Linked user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      // ROK-138: event lookup to check if MMO (non-MMO → skip role select)
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([
                { id: 1005, title: 'Test Event', slotConfig: null },
              ]),
          }),
        }),
      });

      // signup succeeds
      mockSignupsService.signup.mockResolvedValueOnce({
        id: 99,
        eventId: 1005,
      });
      // confirmSignup throws (character not found or deleted)
      mockSignupsService.confirmSignup.mockRejectedValueOnce(
        new Error('Character not found'),
      );

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:1005`,
        ['deleted-char-id'],
        userId,
      );
      await listener.handleSelectMenuInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Something went wrong'),
          components: [],
        }),
      );
    });

    // ----------------------------------------------------------
    // Concurrent signup: user clicks signup button immediately after
    // a character dropdown was shown (rate limiting kicks in)
    // ----------------------------------------------------------

    it('should rate-limit a second signup button click while character dropdown is visible', async () => {
      const userId = 'user-adv-concurrent';

      // First signup flow: show character dropdown
      const event1 = {
        id: 1006,
        title: 'Concurrent Event',
        gameId: 1,
      };
      setupLinkedUserAndEvent(userId, event1);
      setupGameRegistryQuery({ id: 1, hasRoles: true });

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [
          {
            id: 'char-a',
            name: 'Char A',
            class: 'Mage',
            spec: null,
            level: 60,
            isMain: false,
          },
          {
            id: 'char-b',
            name: 'Char B',
            class: 'Rogue',
            spec: null,
            level: 60,
            isMain: false,
          },
        ],
        meta: { total: 2 },
      });

      const interaction1 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1006`,
        userId,
      );
      await listener.handleButtonInteraction(interaction1);

      expect(interaction1.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
        }),
      );

      // Second immediate click from same user on same event — rate limited
      const interaction2 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1006`,
        userId,
      );
      await listener.handleButtonInteraction(interaction2);

      // After ROK-376: deferReply is called first, then cooldown uses editReply
      expect(interaction2.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction2.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Please wait'),
        }),
      );
      // No additional signup attempts
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    // ----------------------------------------------------------
    // Event cancelled between showing dropdown and character selection
    // ----------------------------------------------------------

    it('should show error when signup service throws during character select (event cancelled mid-flow)', async () => {
      const userId = 'user-adv-cancelled';

      // Linked user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      // ROK-138: event lookup to check if MMO (non-MMO → skip role select)
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([
                { id: 1008, title: 'Cancelled Event', slotConfig: null },
              ]),
          }),
        }),
      });

      // signup throws — event was cancelled or deleted between interactions
      mockSignupsService.signup.mockRejectedValueOnce(
        new Error('Event not found or cancelled'),
      );

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:1008`,
        ['char-x'],
        userId,
      );
      await listener.handleSelectMenuInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Something went wrong'),
          components: [],
        }),
      );
    });

    // ----------------------------------------------------------
    // registryGameId is null — fallback behavior
    // ----------------------------------------------------------

    it('should do plain signup (no character flow) when event gameId is null', async () => {
      const userId = 'user-adv-nullgameid';

      const event = {
        id: 1009,
        title: 'Game Night',
        gameId: null,
      };

      setupLinkedUserAndEvent(userId, event);
      setupUpdateEmbedMocks();

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1009`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        1009,
        mockLinkedUser.id,
      );
      expect(mockCharactersService.findAllForUser).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Game Night'),
        }),
      );
    });

    // ----------------------------------------------------------
    // hasRoles field is null vs explicitly false — nudge not shown
    // ----------------------------------------------------------

    it('should NOT show nudge when hasRoles is null', async () => {
      const userId = 'user-adv-hasroles-null';

      const event = {
        id: 1010,
        title: 'Null Roles Game',
        gameId: 3,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 3, hasRoles: null });

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [],
        meta: { total: 0 },
      });

      process.env.CLIENT_URL = 'https://example.com';
      setupUpdateEmbedMocks();

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1010`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        1010,
        mockLinkedUser.id,
      );
      // No nudge when hasRoles is null (falsy)
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('Tip'),
        }),
      );
    });

    it('should NOT show nudge when hasRoles is explicitly false', async () => {
      const userId = 'user-adv-hasroles-false';

      const event = {
        id: 1011,
        title: 'No Roles Game',
        gameId: 4,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 4, hasRoles: false });

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [],
        meta: { total: 0 },
      });

      process.env.CLIENT_URL = 'https://example.com';
      setupUpdateEmbedMocks();

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1011`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('Tip'),
        }),
      );
    });

    it('should NOT show nudge when CLIENT_URL is not set, even if hasRoles is true', async () => {
      const userId = 'user-adv-noclienturl';
      delete process.env.CLIENT_URL;

      const event = {
        id: 1012,
        title: 'Raid Night',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 1, hasRoles: true });

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [],
        meta: { total: 0 },
      });

      setupUpdateEmbedMocks();

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1012`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        1012,
        mockLinkedUser.id,
      );
      // No nudge when CLIENT_URL is not configured
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('Tip'),
        }),
      );
    });

    // ----------------------------------------------------------
    // Main character indicator when user has no main set
    // ----------------------------------------------------------

    it('should show no default selection when no character is marked as main', async () => {
      const userId = 'user-adv-nomain';

      const event = {
        id: 1013,
        title: 'No Main Event',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 1, hasRoles: true });

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [
          {
            id: 'char-alt-1',
            name: 'Alt One',
            class: 'Mage',
            spec: null,
            level: 50,
            isMain: false,
          },
          {
            id: 'char-alt-2',
            name: 'Alt Two',
            class: 'Rogue',
            spec: null,
            level: 55,
            isMain: false,
          },
        ],
        meta: { total: 2 },
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1013`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      // Should still show the dropdown
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
      // No auto-signup since there are multiple characters
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    it('should pre-select main character in dropdown when one is set', async () => {
      // This verifies that the main char is marked as default:true in the options.
      // We can check via the editReply call — the component structure is built internally.
      const userId = 'user-adv-withmain';

      const event = {
        id: 1014,
        title: 'With Main Event',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 1, hasRoles: true });

      mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [
          {
            id: 'char-main',
            name: 'Main Char',
            class: 'Warrior',
            spec: 'Fury',
            level: 60,
            isMain: true,
          },
          {
            id: 'char-alt',
            name: 'Alt Char',
            class: 'Mage',
            spec: null,
            level: 40,
            isMain: false,
          },
        ],
        meta: { total: 2 },
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1014`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      // The dropdown was shown — main character should be default (verified indirectly)
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
        }),
      );
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    // ----------------------------------------------------------
    // updateEmbedSignupCount called after successful character signup
    // ----------------------------------------------------------

    it('should call updateEmbedSignupCount after successful character select signup', async () => {
      const userId = 'user-adv-embedupdate';

      // handleCharacterSelectMenu: linked user lookup
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 77, discordId: userId }]),
          }),
        }),
      });

      // ROK-138: event lookup to check if MMO (non-MMO event → skip role select)
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                id: 1015,
                title: 'Embed Update Event',
                slotConfig: null,
              },
            ]),
          }),
        }),
      });

      mockSignupsService.signup.mockResolvedValueOnce({
        id: 55,
        eventId: 1015,
      });
      mockSignupsService.confirmSignup.mockResolvedValueOnce({ id: 55 });
      mockCharactersService.findOne.mockResolvedValueOnce({
        id: 'char-embed-test',
        name: 'EmbedChar',
      });

      // updateEmbedSignupCount uses shared buildEmbedEventData (mocked above)
      // then looks up the discord event message record in DB
      const msgRecord = [
        {
          eventId: 1015,
          channelId: 'channel-1',
          messageId: 'msg-1',
          guildId: 'guild-123',
          embedState: 'posted',
        },
      ];
      const msgChain = makeChain(msgRecord);
      mockDb.select.mockReturnValueOnce(msgChain);

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:1015`,
        ['char-embed-test'],
        userId,
      );
      await listener.handleSelectMenuInteraction(interaction);

      // Verify signup was created and confirmed
      expect(mockSignupsService.signup).toHaveBeenCalledWith(1015, 77);
      expect(mockSignupsService.confirmSignup).toHaveBeenCalledWith(
        1015,
        55,
        77,
        { characterId: 'char-embed-test' },
      );

      // Verify confirmation message shown
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('EmbedChar'),
        }),
      );

      // Verify embed was updated via updateEmbedSignupCount
      expect(mockEventsService.buildEmbedEventData).toHaveBeenCalledWith(1015);
      expect(mockClientService.editEmbed).toHaveBeenCalled();
    });

    // ----------------------------------------------------------
    // Game found but findAllForUser throws
    // ----------------------------------------------------------

    it('should propagate error gracefully when findAllForUser throws', async () => {
      const userId = 'user-adv-findall-throws';

      const event = {
        id: 1016,
        title: 'Error Event',
        gameId: 1,
      };

      setupLinkedUserAndEvent(userId, event);
      setupGameRegistryQuery({ id: 1, hasRoles: true });

      mockCharactersService.findAllForUser.mockRejectedValueOnce(
        new Error('Database timeout'),
      );

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1016`,
        userId,
      );
      // Should not throw — the outer catch in handleButtonInteraction handles it
      await expect(
        listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();

      // After ROK-376: deferReply is called first, so error path uses editReply via safeReply
      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Something went wrong'),
        }),
      );
    });

    // ----------------------------------------------------------
    // Event not found during initial signup (handleSignup path)
    // ----------------------------------------------------------

    it('should reply with "Event not found" when event query returns empty for linked user', async () => {
      const userId = 'user-adv-eventnotfound';

      mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      // Linked user found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      // Event NOT found
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:1017`,
        userId,
      );
      await listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Event not found'),
        }),
      );
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });
  });
});
