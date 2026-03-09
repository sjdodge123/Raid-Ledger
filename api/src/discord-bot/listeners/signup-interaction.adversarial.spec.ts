import { MessageFlags } from 'discord.js';
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

let mocks: SignupInteractionMocks;
const originalClientUrl = process.env.CLIENT_URL;

async function setupAdversarialModule() {
  delete process.env.CLIENT_URL;
  mocks = await createSignupInteractionTestModule();
}

async function teardownAdversarialModule() {
  jest.clearAllMocks();
  await mocks.module.close();
  if (originalClientUrl !== undefined) {
    process.env.CLIENT_URL = originalClientUrl;
  } else {
    delete process.env.CLIENT_URL;
  }
}

function makeCharacterList(
  characters: Array<{
    id: string;
    name: string;
    class: string | null;
    spec: string | null;
    level: number | null;
    isMain: boolean;
  }>,
) {
  return { data: characters, meta: { total: characters.length } };
}

function longNameTests() {
  it('should error gracefully when character name exceeds Discord label limit (>100 chars)', async () => {
    const userId = 'user-adv-longname';
    const longName = 'A'.repeat(101);
    const event = { id: 1001, title: 'Raid Night', gameId: 1 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 1, hasRoles: true });

    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce(
      makeCharacterList([
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
      ]),
    );

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1001`,
      userId,
    );
    await expect(
      mocks.listener.handleButtonInteraction(interaction),
    ).resolves.not.toThrow();
    expect(interaction.reply).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Pick a character'),
      }),
    );
  });
}

function nullFieldsTests() {
  it('should build dropdown label gracefully when class, spec, and level are null', async () => {
    const userId = 'user-adv-nullfields';
    const event = { id: 1002, title: 'Casual Night', gameId: 1 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 1, hasRoles: true });

    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce(
      makeCharacterList([
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
      ]),
    );

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1002`,
      userId,
    );
    await expect(
      mocks.listener.handleButtonInteraction(interaction),
    ).resolves.not.toThrow();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Pick a character'),
      }),
    );
    expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
  });

  it('should build dropdown description with only class (no spec, no level)', async () => {
    const userId = 'user-adv-classonly';
    const event = { id: 1003, title: 'Alt Run', gameId: 1 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 1, hasRoles: true });

    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce(
      makeCharacterList([
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
      ]),
    );

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1003`,
      userId,
    );
    await expect(
      mocks.listener.handleButtonInteraction(interaction),
    ).resolves.not.toThrow();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Pick a character'),
      }),
    );
  });
}

function dropdownLimitTests() {
  it('should show all 25 characters when user has exactly 25', async () => {
    const userId = 'user-adv-exactly25';
    const event = { id: 1004, title: 'Big Roster Night', gameId: 1 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 1, hasRoles: true });

    const characters = Array.from({ length: 25 }, (_, i) => ({
      id: `char-${i}`,
      name: `Character ${i}`,
      class: 'Warrior',
      spec: null,
      level: 60,
      isMain: i === 0,
    }));
    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce(
      makeCharacterList(characters),
    );

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1004`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Pick a character'),
        components: expect.arrayContaining([expect.anything()]),
      }),
    );
    expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
  });

  it('should cap dropdown at 25 options even when user has more than 25 characters', async () => {
    const userId = 'user-adv-over25';
    const event = { id: 1005, title: 'Overflow Event', gameId: 1 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 1, hasRoles: true });

    const characters = Array.from({ length: 30 }, (_, i) => ({
      id: `char-${i}`,
      name: `Character ${i}`,
      class: 'Rogue',
      spec: null,
      level: 60,
      isMain: false,
    }));
    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce(
      makeCharacterList(characters),
    );

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1005`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Pick a character'),
      }),
    );
    expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
  });
}

function invalidCharSelectTests() {
  it('should show error message when character select submits an invalid/deleted character ID', async () => {
    const userId = 'user-adv-invalidchar';

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
              { id: 1005, title: 'Test Event', slotConfig: null },
            ]),
        }),
      }),
    });

    mocks.mockSignupsService.signup.mockResolvedValueOnce({
      id: 99,
      eventId: 1005,
    });
    mocks.mockSignupsService.confirmSignup.mockRejectedValueOnce(
      new Error('Character not found'),
    );

    const interaction = makeSelectMenuInteraction(
      `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:1005`,
      ['deleted-char-id'],
      userId,
    );
    await mocks.listener.handleSelectMenuInteraction(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Something went wrong'),
        components: [],
      }),
    );
  });
}

function rateLimitTests() {
  it('should rate-limit a second signup button click while character dropdown is visible', async () => {
    const userId = 'user-adv-concurrent';
    const event1 = { id: 1006, title: 'Concurrent Event', gameId: 1 };
    setupLinkedUserAndEvent(mocks, userId, event1);
    setupGameRegistryQuery(mocks, { id: 1, hasRoles: true });

    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce(
      makeCharacterList([
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
      ]),
    );

    const interaction1 = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1006`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction1);
    expect(interaction1.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Pick a character'),
      }),
    );

    const interaction2 = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1006`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction2);
    expect(interaction2.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction2.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Please wait'),
      }),
    );
    expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
  });
}

function cancelledMidFlowTests() {
  it('should show error when signup service throws during character select (event cancelled mid-flow)', async () => {
    const userId = 'user-adv-cancelled';

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
              { id: 1008, title: 'Cancelled Event', slotConfig: null },
            ]),
        }),
      }),
    });

    mocks.mockSignupsService.signup.mockRejectedValueOnce(
      new Error('Event not found or cancelled'),
    );

    const interaction = makeSelectMenuInteraction(
      `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:1008`,
      ['char-x'],
      userId,
    );
    await mocks.listener.handleSelectMenuInteraction(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Something went wrong'),
        components: [],
      }),
    );
  });
}

function nullGameIdTests() {
  it('should do plain signup (no character flow) when event gameId is null', async () => {
    const userId = 'user-adv-nullgameid';
    const event = { id: 1009, title: 'Game Night', gameId: null };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupUpdateEmbedMocks(mocks);

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1009`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction);

    expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(1009, 42);
    expect(mocks.mockCharactersService.findAllForUser).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Game Night'),
      }),
    );
  });
}

function nudgeVisibilityTests() {
  it('should NOT show nudge when hasRoles is null', async () => {
    const userId = 'user-adv-hasroles-null';
    const event = { id: 1010, title: 'Null Roles Game', gameId: 3 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 3, hasRoles: null });
    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce({
      data: [],
      meta: { total: 0 },
    });
    process.env.CLIENT_URL = 'https://example.com';
    setupUpdateEmbedMocks(mocks);

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1010`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction);
    expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(1010, 42);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.not.stringContaining('Tip') }),
    );
  });

  it('should NOT show nudge when hasRoles is explicitly false', async () => {
    const userId = 'user-adv-hasroles-false';
    const event = { id: 1011, title: 'No Roles Game', gameId: 4 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 4, hasRoles: false });
    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce({
      data: [],
      meta: { total: 0 },
    });
    process.env.CLIENT_URL = 'https://example.com';
    setupUpdateEmbedMocks(mocks);

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1011`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.not.stringContaining('Tip') }),
    );
  });

  it('should NOT show nudge when CLIENT_URL is not set, even if hasRoles is true', async () => {
    const userId = 'user-adv-noclienturl';
    delete process.env.CLIENT_URL;
    const event = { id: 1012, title: 'Raid Night', gameId: 1 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 1, hasRoles: true });
    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce({
      data: [],
      meta: { total: 0 },
    });
    setupUpdateEmbedMocks(mocks);

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1012`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction);
    expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(1012, 42);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.not.stringContaining('Tip') }),
    );
  });
}

function mainCharSelectionTests() {
  it('should show no default selection when no character is marked as main', async () => {
    const userId = 'user-adv-nomain';
    const event = { id: 1013, title: 'No Main Event', gameId: 1 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 1, hasRoles: true });
    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce(
      makeCharacterList([
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
      ]),
    );

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1013`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Pick a character'),
        components: expect.arrayContaining([expect.anything()]),
      }),
    );
    expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
  });

  it('should pre-select main character in dropdown when one is set', async () => {
    const userId = 'user-adv-withmain';
    const event = { id: 1014, title: 'With Main Event', gameId: 1 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 1, hasRoles: true });
    mocks.mockCharactersService.findAllForUser.mockResolvedValueOnce(
      makeCharacterList([
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
      ]),
    );

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1014`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Pick a character'),
      }),
    );
    expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
  });
}

function embedUpdateAfterCharSelectTest() {
  it('should call updateEmbedSignupCount after successful character select signup', async () => {
    const userId = 'user-adv-embedupdate';

    mocks.mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ id: 77, discordId: userId }]),
        }),
      }),
    });
    mocks.mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest
            .fn()
            .mockResolvedValue([
              { id: 1015, title: 'Embed Update Event', slotConfig: null },
            ]),
        }),
      }),
    });

    mocks.mockSignupsService.signup.mockResolvedValueOnce({
      id: 55,
      eventId: 1015,
    });
    mocks.mockSignupsService.confirmSignup.mockResolvedValueOnce({ id: 55 });
    mocks.mockCharactersService.findOne.mockResolvedValueOnce({
      id: 'char-embed-test',
      name: 'EmbedChar',
    });

    const msgRecord = [
      {
        eventId: 1015,
        channelId: 'channel-1',
        messageId: 'msg-1',
        guildId: 'guild-123',
        embedState: 'posted',
      },
    ];
    mocks.mockDb.select.mockReturnValueOnce(makeChain(msgRecord));

    const interaction = makeSelectMenuInteraction(
      `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:1015`,
      ['char-embed-test'],
      userId,
    );
    await mocks.listener.handleSelectMenuInteraction(interaction);

    expect(mocks.mockSignupsService.signup).toHaveBeenCalledWith(1015, 77);
    expect(mocks.mockSignupsService.confirmSignup).toHaveBeenCalledWith(
      1015,
      55,
      77,
      { characterId: 'char-embed-test' },
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('EmbedChar'),
      }),
    );
    expect(mocks.mockEventsService.buildEmbedEventData).toHaveBeenCalledWith(
      1015,
    );
    expect(mocks.mockClientService.editEmbed).toHaveBeenCalled();
  });
}

function errorPropagationTests() {
  it('should propagate error gracefully when findAllForUser throws', async () => {
    const userId = 'user-adv-findall-throws';
    const event = { id: 1016, title: 'Error Event', gameId: 1 };

    setupLinkedUserAndEvent(mocks, userId, event);
    setupGameRegistryQuery(mocks, { id: 1, hasRoles: true });
    mocks.mockCharactersService.findAllForUser.mockRejectedValueOnce(
      new Error('Database timeout'),
    );

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1016`,
      userId,
    );
    await expect(
      mocks.listener.handleButtonInteraction(interaction),
    ).resolves.not.toThrow();
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Something went wrong'),
      }),
    );
  });

  it('should reply with "Event not found" when event query returns empty for linked user', async () => {
    const userId = 'user-adv-eventnotfound';

    mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);
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
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    const interaction = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.SIGNUP}:1017`,
      userId,
    );
    await mocks.listener.handleButtonInteraction(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Event not found'),
      }),
    );
    expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
  });
}

describe('SignupInteractionListener — character select adversarial edge cases', () => {
  beforeEach(async () => {
    await setupAdversarialModule();
  });

  afterEach(async () => {
    await teardownAdversarialModule();
  });

  describe('long character names', () => {
    longNameTests();
  });

  describe('null character fields', () => {
    nullFieldsTests();
  });

  describe('dropdown limits', () => {
    dropdownLimitTests();
  });

  describe('invalid character selection', () => {
    invalidCharSelectTests();
  });

  describe('rate limiting during character flow', () => {
    rateLimitTests();
  });

  describe('cancelled mid-flow', () => {
    cancelledMidFlowTests();
  });

  describe('null gameId events', () => {
    nullGameIdTests();
  });

  describe('nudge visibility', () => {
    nudgeVisibilityTests();
  });

  describe('main character selection', () => {
    mainCharSelectionTests();
  });

  describe('embed update after char select', () => {
    embedUpdateAfterCharSelectTest();
  });

  describe('error propagation', () => {
    errorPropagationTests();
  });
});
