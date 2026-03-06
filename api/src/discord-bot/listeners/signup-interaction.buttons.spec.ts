import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import {
  type SignupInteractionMocks,
  createSignupInteractionTestModule,
  makeButtonInteraction,
  makeChain,
} from './signup-interaction.spec-helpers';

describe('SignupInteractionListener — buttons', () => {
  let mocks: SignupInteractionMocks;
  const originalClientUrl = process.env.CLIENT_URL;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mocks = await createSignupInteractionTestModule();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await mocks.module.close();
    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  describe('onBotConnected', () => {
    it('should skip registration when client is null', () => {
      mocks.mockClientService.getClient.mockReturnValue(null);
      expect(() => mocks.listener.onBotConnected()).not.toThrow();
    });

    it('should register interactionCreate listener when client is available', () => {
      const mockOn = jest.fn();
      const mockRemoveListener = jest.fn();
      const fakeClient = {
        on: mockOn,
        removeListener: mockRemoveListener,
      };
      mocks.mockClientService.getClient.mockReturnValue(fakeClient);

      mocks.listener.onBotConnected();

      expect(mockRemoveListener).not.toHaveBeenCalled();
      expect(mockOn).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );

      mocks.listener.onBotConnected();

      expect(mockRemoveListener).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
      expect(mockOn).toHaveBeenCalledTimes(2);
    });
  });

  describe('onBotDisconnected', () => {
    it('should clear boundHandler to null', () => {
      const mockOn = jest.fn();
      const fakeClient = { on: mockOn, removeListener: jest.fn() };
      mocks.mockClientService.getClient.mockReturnValue(fakeClient);

      mocks.listener.onBotConnected();
      expect(mocks.listener.boundHandler).not.toBeNull();

      mocks.listener.onBotDisconnected();
      expect(mocks.listener.boundHandler).toBeNull();
    });

    it('should not call removeListener on reconnect after disconnect (no stale reference)', () => {
      const mockOn1 = jest.fn();
      const mockRemove1 = jest.fn();
      const fakeClient1 = { on: mockOn1, removeListener: mockRemove1 };

      const mockOn2 = jest.fn();
      const mockRemove2 = jest.fn();
      const fakeClient2 = { on: mockOn2, removeListener: mockRemove2 };

      mocks.mockClientService.getClient.mockReturnValue(fakeClient1);
      mocks.listener.onBotConnected();

      mocks.listener.onBotDisconnected();

      mocks.mockClientService.getClient.mockReturnValue(fakeClient2);
      mocks.listener.onBotConnected();

      expect(mockRemove2).not.toHaveBeenCalled();
    });

    it('should properly re-register handler on new client after disconnect', () => {
      const mockOn1 = jest.fn();
      const fakeClient1 = { on: mockOn1, removeListener: jest.fn() };

      const mockOn2 = jest.fn();
      const fakeClient2 = { on: mockOn2, removeListener: jest.fn() };

      mocks.mockClientService.getClient.mockReturnValue(fakeClient1);
      mocks.listener.onBotConnected();
      expect(mockOn1).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );

      mocks.listener.onBotDisconnected();

      mocks.mockClientService.getClient.mockReturnValue(fakeClient2);
      mocks.listener.onBotConnected();

      expect(mockOn2).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
      expect(mocks.listener.boundHandler).not.toBeNull();
    });
  });

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

      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockLinkedUser]),
          }),
        }),
      });

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockEvent]),
          }),
        }),
      });

      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 101,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:101`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(
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
      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
        id: 1,
        status: 'signed_up',
        user: { id: 1, discordId: userId },
        discordUserId: null,
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:102`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('already signed up'),
        }),
      );
      expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
    });

    it('should change status to signed_up when user was tentative', async () => {
      const userId = 'user-signup-tentative-1';
      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
        id: 1,
        status: 'tentative',
        user: { id: 1, discordId: userId },
        discordUserId: null,
      });

      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 1,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:103`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.updateStatus).toHaveBeenCalledWith(
        103,
        { userId: 1 },
        { status: 'signed_up' },
      );
    });

    it('should show onboarding ephemeral for unlinked Discord user', async () => {
      const userId = 'user-signup-unlinked-1';
      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      mocks.mockDb.select.mockReturnValueOnce({
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
      await mocks.listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Raid Night'),
        }),
      );
    });
  });

  describe('handleButtonInteraction — rate limiting', () => {
    it('should reject rapid interactions from same user on same event', async () => {
      const userId = 'user-ratelimit-1';
      mocks.mockDb.select
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
      await mocks.listener.handleButtonInteraction(interaction1);

      const interaction2 = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:200`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction2);

      expect(interaction2.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction2.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Please wait'),
        }),
      );
    });
  });

  describe('handleButtonInteraction — Quick Sign Up (anonymous)', () => {
    it('should create anonymous signup for non-MMO event', async () => {
      const userId = 'user-quicksignup-1';
      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      mocks.mockDb.select.mockReturnValueOnce({
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

      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 301,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.QUICK_SIGNUP}:301`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.signupDiscord).toHaveBeenCalledWith(
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
      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
        id: 5,
        status: 'signed_up',
        user: { id: 0, discordId: userId },
        discordUserId: userId,
      });

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.QUICK_SIGNUP}:302`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('already signed up'),
        }),
      );
      expect(mocks.mockSignupsService.signupDiscord).not.toHaveBeenCalled();
    });

    it('should show role select dropdown for MMO events', async () => {
      const userId = 'user-quicksignup-mmo-1';
      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      mocks.mockDb.select.mockReturnValueOnce({
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
      await mocks.listener.handleButtonInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('role'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });
  });

  describe('handleButtonInteraction — Tentative button', () => {
    it('should update existing signup to tentative status', async () => {
      const userId = 'user-tentative-update-1';
      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
        id: 1,
        status: 'signed_up',
        user: { id: 50, discordId: userId },
        discordUserId: null,
      });

      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 401,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.TENTATIVE}:401`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.updateStatus).toHaveBeenCalledWith(
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
      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 402,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.TENTATIVE}:402`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.signupDiscord).toHaveBeenCalledWith(
        402,
        expect.objectContaining({ status: 'tentative' }),
      );
    });
  });

  describe('handleButtonInteraction — Decline button', () => {
    it('should fully remove existing signup when declining', async () => {
      const userId = 'user-decline-update-1';
      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
        id: 1,
        status: 'signed_up',
        user: { id: 60, discordId: userId },
        discordUserId: null,
      });

      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 501,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.DECLINE}:501`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.cancelByDiscordUser).toHaveBeenCalledWith(
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
});
