import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import {
  type SignupInteractionMocks,
  createSignupInteractionTestModule,
  makeButtonInteraction,
  makeSelectMenuInteraction,
  makeChain,
  setupLinkedUserAndEvent,
  setupGameRegistryQuery,
  setupUpdateEmbedMocks,
} from './signup-interaction.spec-helpers';

describe('SignupInteractionListener — menus', () => {
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

  describe('handleSelectMenuInteraction — role selection', () => {
    it('should create anonymous signup with selected role (healer)', async () => {
      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 601,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:601`,
        ['healer'],
        'user-roleselect-1',
      );
      await mocks.listener.handleSelectMenuInteraction(interaction);

      expect(mocks.mockSignupsService.signupDiscord).toHaveBeenCalledWith(
        601,
        expect.objectContaining({
          discordUserId: 'user-roleselect-1',
          role: 'healer',
        }),
      );
    });

    it('should create anonymous signup with tank role', async () => {
      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 602,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:602`,
        ['tank'],
        'user-roleselect-2',
      );
      await mocks.listener.handleSelectMenuInteraction(interaction);

      expect(mocks.mockSignupsService.signupDiscord).toHaveBeenCalledWith(
        602,
        expect.objectContaining({ role: 'tank' }),
      );
    });

    it('should ignore select menus with wrong action prefix', async () => {
      const interaction = makeSelectMenuInteraction('wrong_action:601', [
        'healer',
      ]);
      await mocks.listener.handleSelectMenuInteraction(interaction);
      expect(mocks.mockSignupsService.signupDiscord).not.toHaveBeenCalled();
    });

    it('should ignore select menus with non-numeric eventId', async () => {
      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:not-a-number`,
        ['dps'],
      );
      await mocks.listener.handleSelectMenuInteraction(interaction);
      expect(mocks.mockSignupsService.signupDiscord).not.toHaveBeenCalled();
    });

    async function testShouldcreatelinkedusersignupwithrolecharacterwhen() {
      const userId = 'user-roleselect-linked-1';

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      mocks.mockSignupsService.signup.mockResolvedValueOnce({
        id: 10,
        eventId: 700,
      });
      mocks.mockSignupsService.confirmSignup.mockResolvedValueOnce({ id: 10 });
      mocks.mockCharactersService.findOne.mockResolvedValueOnce({
        id: 'char-linked-role',
        name: 'Thrall',
      });

      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 700,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:700:char-linked-role`,
        ['tank'],
        userId,
      );
      await mocks.listener.handleSelectMenuInteraction(interaction);

      expect(mocks.mockSignupsService.signupDiscord).not.toHaveBeenCalled();
      expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(700, 42, {
        preferredRoles: ['tank'],
        slotRole: 'tank',
      });
      expect(mocks.mockSignupsService.confirmSignup).toHaveBeenCalledWith(
        700,
        10,
        42,
        { characterId: 'char-linked-role' },
      );
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
    }

    it('should create linked-user signup with role + character when characterId is in customId (ROK-138)', async () => {
      await testShouldcreatelinkedusersignupwithrolecharacterwhen();
    });

    it('should show error when linked user not found during role select with characterId (ROK-138)', async () => {
      const userId = 'user-roleselect-linked-noaccount';

      mocks.mockDb.select.mockReturnValueOnce({
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
      await mocks.listener.handleSelectMenuInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(
            'Could not find your linked account',
          ),
          components: [],
        }),
      );
      expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
      expect(mocks.mockSignupsService.signupDiscord).not.toHaveBeenCalled();
    });
  });

  describe('handleButtonInteraction — character select (ROK-138)', () => {
    const mockGameWithRoles = { id: 1, hasRoles: true, hasSpecs: true };
    const mockGameWithoutRoles = { id: 2, hasRoles: false, hasSpecs: false };

    async function testShouldshowcharacterselectdropdownwhenuserhas() {
      const userId = 'user-charselect-multi';
      const event = { id: 800, title: 'Mythic Raid', gameId: 1 };

      setupLinkedUserAndEvent(mocks, userId, event);
      setupGameRegistryQuery(mocks, mockGameWithRoles);

      mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce({
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
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockCharactersService.findAllForUser).toHaveBeenCalledWith(
        42,
        1,
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
      expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
    }

    it('should show character select dropdown when user has multiple characters', async () => {
      await testShouldshowcharacterselectdropdownwhenuserhas();
    });

    async function testShouldautoselectandsignupwhenuserhas() {
      const userId = 'user-charselect-single';
      const event = { id: 801, title: 'Heroic Raid', gameId: 1 };

      setupLinkedUserAndEvent(mocks, userId, event);
      setupGameRegistryQuery(mocks, mockGameWithRoles);

      mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce({
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

      setupUpdateEmbedMocks(mocks);

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:801`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(801, 42);
      expect(mocks.mockSignupsService.confirmSignup).toHaveBeenCalledWith(
        801,
        1,
        42,
        { characterId: 'char-solo' },
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Thrall') }),
      );
    }

    it('should auto-select and sign up when user has exactly one character', async () => {
      await testShouldautoselectandsignupwhenuserhas();
    });

    it('should instant-signup with nudge when user has no characters (hasRoles game)', async () => {
      const userId = 'user-charselect-none-roles';
      const event = { id: 802, title: 'Raid Night', gameId: 1 };

      setupLinkedUserAndEvent(mocks, userId, event);
      setupGameRegistryQuery(mocks, mockGameWithRoles);

      mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [],
        meta: { total: 0 },
      });

      process.env.CLIENT_URL = 'https://example.com';
      setupUpdateEmbedMocks(mocks);

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:802`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(802, 42);
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
      const event = { id: 803, title: 'Phasmo Night', gameId: 2 };

      setupLinkedUserAndEvent(mocks, userId, event);
      setupGameRegistryQuery(mocks, mockGameWithoutRoles);

      mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce({
        data: [],
        meta: { total: 0 },
      });

      process.env.CLIENT_URL = 'https://example.com';
      setupUpdateEmbedMocks(mocks);

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:803`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(803, 42);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('Tip'),
        }),
      );
    });

    it('should do plain signup when event has no gameId', async () => {
      const userId = 'user-charselect-nogame';
      const event = { id: 804, title: 'Casual Game Night', gameId: null };

      setupLinkedUserAndEvent(mocks, userId, event);
      setupUpdateEmbedMocks(mocks);

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:804`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(804, 42);
      expect(mocks.mockCharactersService.findAllForUser).not.toHaveBeenCalled();
    });

    async function testShouldshowroleselectnotimmediatesignupfor() {
      const userId = 'user-charselect-single-mmo';
      const event = {
        id: 810,
        title: 'Mythic Raid',
        gameId: 1,
        slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
      };

      setupLinkedUserAndEvent(mocks, userId, event);
      setupGameRegistryQuery(mocks, mockGameWithRoles);

      mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce({
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
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
      expect(mocks.mockSignupsService.confirmSignup).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('character'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    }

    it('should show role select (not immediate signup) for single character on MMO event', async () => {
      await testShouldshowroleselectnotimmediatesignupfor();
    });

    async function testShouldshowcharacterselectdropdownformultiplecharacters() {
      const userId = 'user-charselect-multi-mmo';
      const event = {
        id: 811,
        title: 'Mythic Prog',
        gameId: 1,
        slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
      };

      setupLinkedUserAndEvent(mocks, userId, event);
      setupGameRegistryQuery(mocks, mockGameWithRoles);

      mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce({
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
      await mocks.listener.handleButtonInteraction(interaction);

      expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    }

    it('should show character select dropdown for multiple characters on MMO event', async () => {
      await testShouldshowcharacterselectdropdownformultiplecharacters();
    });
  });

  describe('handleSelectMenuInteraction — character selection (ROK-138)', () => {
    async function testShouldsignupwithselectedcharacterfromdropdown() {
      const userId = 'user-charselect-menu-1';

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      mocks.mockDb.select.mockReturnValueOnce({
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

      mocks.mockCharactersService.findOne.mockResolvedValueOnce({
        id: 'char-selected',
        name: 'Jaina',
      });

      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 900,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:900`,
        ['char-selected'],
        userId,
      );
      await mocks.listener.handleSelectMenuInteraction(interaction);

      expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(900, 42);
      expect(mocks.mockSignupsService.confirmSignup).toHaveBeenCalledWith(
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
    }

    it('should sign up with selected character from dropdown', async () => {
      await testShouldsignupwithselectedcharacterfromdropdown();
    });

    it('should show error when linked user not found during char select', async () => {
      const userId = 'user-charselect-menu-noaccount';

      mocks.mockDb.select.mockReturnValueOnce({
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
      await mocks.listener.handleSelectMenuInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(
            'Could not find your linked account',
          ),
          components: [],
        }),
      );
      expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
    });

    async function testShouldshowroleselectaftercharacterdropdownon() {
      const userId = 'user-charselect-menu-mmo';

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      mocks.mockDb.select.mockReturnValueOnce({
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
      await mocks.listener.handleSelectMenuInteraction(interaction);

      expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
      expect(mocks.mockSignupsService.confirmSignup).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('role'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    }

    it('should show role select after character dropdown on MMO event (ROK-138)', async () => {
      await testShouldshowroleselectaftercharacterdropdownon();
    });
  });
});
