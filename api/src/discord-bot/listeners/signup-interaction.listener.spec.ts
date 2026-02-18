/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { SignupInteractionListener } from './signup-interaction.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SignupsService } from '../../events/signups.service';
import { IntentTokenService } from '../../auth/intent-token.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
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
  return {
    isButton: () => true,
    isStringSelectMenu: () => false,
    customId,
    user: { id: userId, username, avatar },
    replied: false,
    deferred: false,
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  };
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
  };
  let mockIntentTokenService: { generate: jest.Mock };
  let mockEmbedFactory: { buildEventUpdate: jest.Mock };
  let mockSettingsService: { getBranding: jest.Mock };
  let mockDb: Record<string, jest.Mock>;

  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = new ActionRowBuilder<ButtonBuilder>();
  const originalClientUrl = process.env.CLIENT_URL;

  /** Default chain mock for DB queries returning empty */
  function makeChain(result: unknown[] = []) {
    const chain: Record<string, jest.Mock> = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(result);
    chain.leftJoin = jest.fn().mockReturnValue(chain);
    chain.groupBy = jest.fn().mockResolvedValue(result);
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
    };

    mockIntentTokenService = {
      generate: jest.fn().mockReturnValue('mock.intent.token'),
    };

    mockEmbedFactory = {
      buildEventUpdate: jest
        .fn()
        .mockReturnValue({ embed: mockEmbed, row: mockRow }),
    };

    mockSettingsService = {
      getBranding: jest.fn().mockResolvedValue({
        communityName: 'Test Guild',
        communityLogoPath: null,
      }),
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
        { provide: IntentTokenService, useValue: mockIntentTokenService },
        { provide: DiscordEmbedFactory, useValue: mockEmbedFactory },
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

      expect(interaction2.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Please wait'),
          ephemeral: true,
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
    it('should update existing signup to declined status', async () => {
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

      expect(mockSignupsService.updateStatus).toHaveBeenCalledWith(
        501,
        { userId: 60 },
        { status: 'declined' },
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
  });

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    it('should reply with error message when handler throws and not yet replied', async () => {
      const userId = 'user-error-1';
      mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
        new Error('DB connection failed'),
      );

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:701`,
        userId,
      );
      interaction.replied = false;
      interaction.deferred = false;

      await listener.handleButtonInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Something went wrong'),
          ephemeral: true,
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
});
