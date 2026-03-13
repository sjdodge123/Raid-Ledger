/**
 * Adversarial integration-level tests for embed threading through signup handlers.
 * Verifies that buildReplyEmbed returning undefined never blocks selection UIs,
 * and that the embed is correctly wired into editReply calls.
 */
import { EmbedBuilder } from 'discord.js';
import * as replyEmbedModule from './signup-reply-embed.helpers';
import * as dropdownBuildersModule from '../utils/signup-dropdown-builders';

// ─── shared mocks ────────────────────────────────────────────────────────────

function buildMockInteraction() {
  return { editReply: jest.fn().mockResolvedValue(undefined) };
}

function buildMockEmojiService() {
  return {
    getClassEmojiComponent: jest.fn(() => undefined),
    getRoleEmojiComponent: jest.fn(() => undefined),
  };
}

function buildMockSignupsService() {
  return {
    findByDiscordUser: jest.fn().mockResolvedValue(null),
    signup: jest.fn().mockResolvedValue({ id: 1, assignedSlot: null }),
    signupDiscord: jest.fn().mockResolvedValue({ id: 1, assignedSlot: null }),
    confirmSignup: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    cancelByDiscordUser: jest.fn().mockResolvedValue(undefined),
  };
}

function buildMockCharactersService(characters = []) {
  return {
    findAllForUser: jest.fn().mockResolvedValue({ data: characters }),
    findOne: jest.fn().mockResolvedValue({ name: 'Hero', role: null, roleOverride: null }),
  };
}

function buildMockDb(overrides: Record<string, unknown> = {}) {
  const chainResult = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  // Make select() return an object where subsequent calls chain correctly
  const db: Record<string, jest.Mock> = {};
  db.select = jest.fn(() => chainResult);
  db.transaction = jest.fn();
  return db;
}

function buildBaseDeps(overrides: Record<string, unknown> = {}) {
  return {
    db: buildMockDb(),
    logger: { warn: jest.fn(), error: jest.fn() },
    emojiService: buildMockEmojiService(),
    signupsService: buildMockSignupsService(),
    charactersService: buildMockCharactersService(),
    embedFactory: {
      buildEventEmbed: jest.fn().mockReturnValue({ embed: new EmbedBuilder(), row: {} }),
    },
    eventsService: {
      buildEmbedEventData: jest.fn().mockResolvedValue({ id: 1, title: 'Raid' }),
    },
    settingsService: {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Guild', communityLogoPath: null }),
      getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
    },
    updateEmbedSignupCount: jest.fn().mockResolvedValue(undefined),
    intentTokenService: { generate: jest.fn().mockReturnValue('tok') },
    ...overrides,
  };
}

// ─── tryMmoTentativeRedirect ──────────────────────────────────────────────────

describe('tryMmoTentativeRedirect — embed threading', () => {
  let spyBuildReplyEmbed: jest.SpyInstance;
  let spyShowRoleSelect: jest.SpyInstance;

  beforeEach(() => {
    spyBuildReplyEmbed = jest.spyOn(replyEmbedModule, 'buildReplyEmbed');
    spyShowRoleSelect = jest.spyOn(dropdownBuildersModule, 'showRoleSelect').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes embed to showRoleSelect on MMO event', async () => {
    const { tryMmoTentativeRedirect } = await import('./signup-status-tentative.handlers');

    const mockEmbed = new EmbedBuilder().setTitle('Live Roster');
    spyBuildReplyEmbed.mockResolvedValue(mockEmbed);

    const interaction = buildMockInteraction();
    const deps = buildBaseDeps();

    // Supply an MMO event via the db chain
    const mmoEvent = {
      id: 7,
      title: 'Dragon Keep',
      slotConfig: { type: 'mmo' },
      gameId: null,
    };
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([mmoEvent]),
    });

    const result = await tryMmoTentativeRedirect(interaction as never, 7, deps as never);

    expect(result).toBe(true);
    expect(spyShowRoleSelect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embed: mockEmbed }),
    );
  });

  it('still shows role select when buildReplyEmbed returns undefined', async () => {
    const { tryMmoTentativeRedirect } = await import('./signup-status-tentative.handlers');

    spyBuildReplyEmbed.mockResolvedValue(undefined);

    const interaction = buildMockInteraction();
    const deps = buildBaseDeps();

    const mmoEvent = {
      id: 7,
      title: 'Dragon Keep',
      slotConfig: { type: 'mmo' },
      gameId: null,
    };
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([mmoEvent]),
    });

    const result = await tryMmoTentativeRedirect(interaction as never, 7, deps as never);

    expect(result).toBe(true);
    expect(spyShowRoleSelect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embed: undefined }),
    );
  });

  it('returns false and does not call showRoleSelect for non-MMO event', async () => {
    const { tryMmoTentativeRedirect } = await import('./signup-status-tentative.handlers');

    const interaction = buildMockInteraction();
    const deps = buildBaseDeps();

    const nonMmoEvent = {
      id: 8,
      title: 'Chill Night',
      slotConfig: { type: 'generic' },
      gameId: null,
    };
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([nonMmoEvent]),
    });

    const result = await tryMmoTentativeRedirect(interaction as never, 8, deps as never);

    expect(result).toBe(false);
    expect(spyShowRoleSelect).not.toHaveBeenCalled();
  });

  it('returns false when event is not found', async () => {
    const { tryMmoTentativeRedirect } = await import('./signup-status-tentative.handlers');

    const interaction = buildMockInteraction();
    const deps = buildBaseDeps();

    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    const result = await tryMmoTentativeRedirect(interaction as never, 99, deps as never);

    expect(result).toBe(false);
  });
});

// ─── tryMmoQuickSignupRedirect (signup-status.handlers) ─────────────────────

describe('handleQuickSignup — MMO redirect embeds embed', () => {
  let spyBuildReplyEmbed: jest.SpyInstance;
  let spyShowRoleSelectDropdown: jest.SpyInstance;

  beforeEach(() => {
    spyBuildReplyEmbed = jest.spyOn(replyEmbedModule, 'buildReplyEmbed');
    spyShowRoleSelectDropdown = jest
      .spyOn(dropdownBuildersModule, 'showRoleSelect')
      .mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('includes embed in role select call for MMO quick signup', async () => {
    const { handleQuickSignup } = await import('./signup-status.handlers');

    const mockEmbed = new EmbedBuilder().setTitle('Event Roster');
    spyBuildReplyEmbed.mockResolvedValue(mockEmbed);

    const interaction = {
      ...buildMockInteraction(),
      user: { id: 'discord-123', username: 'Player', avatar: null },
    };
    const deps = buildBaseDeps();
    // No existing signup
    (deps.signupsService.findByDiscordUser as jest.Mock).mockResolvedValue(null);

    // MMO event returned by db
    const mmoEvent = { id: 5, title: 'MMO Raid', slotConfig: { type: 'mmo' }, gameId: null };
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([mmoEvent]),
    });

    await handleQuickSignup(interaction as never, 5, deps as never);

    expect(spyShowRoleSelectDropdown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embed: mockEmbed }),
    );
  });

  it('role select still shows when buildReplyEmbed fails for MMO quick signup', async () => {
    const { handleQuickSignup } = await import('./signup-status.handlers');

    spyBuildReplyEmbed.mockResolvedValue(undefined);

    const interaction = {
      ...buildMockInteraction(),
      user: { id: 'discord-123', username: 'Player', avatar: null },
    };
    const deps = buildBaseDeps();
    (deps.signupsService.findByDiscordUser as jest.Mock).mockResolvedValue(null);

    const mmoEvent = { id: 5, title: 'MMO Raid', slotConfig: { type: 'mmo' }, gameId: null };
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([mmoEvent]),
    });

    await handleQuickSignup(interaction as never, 5, deps as never);

    expect(spyShowRoleSelectDropdown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embed: undefined }),
    );
  });
});

// ─── signup-select-character.handlers — showRoleSelectForCharacter ────────────

describe('handleCharacterSelectMenu — MMO role redirect embeds embed', () => {
  let spyBuildReplyEmbed: jest.SpyInstance;
  let spyShowRoleSelectDropdown: jest.SpyInstance;

  beforeEach(() => {
    spyBuildReplyEmbed = jest.spyOn(replyEmbedModule, 'buildReplyEmbed');
    spyShowRoleSelectDropdown = jest
      .spyOn(dropdownBuildersModule, 'showRoleSelect')
      .mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('includes embed in role select after character is chosen on MMO event', async () => {
    const { handleCharacterSelectMenu } = await import('./signup-select-character.handlers');

    const mockEmbed = new EmbedBuilder().setTitle('Current Roster');
    spyBuildReplyEmbed.mockResolvedValue(mockEmbed);

    const interaction = {
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'discord-456' },
      values: ['char-xyz'],
    };

    const deps = buildBaseDeps({
      charactersService: {
        findAllForUser: jest.fn().mockResolvedValue({ data: [] }),
        findOne: jest.fn().mockResolvedValue({
          name: 'Thrall',
          role: 'healer',
          roleOverride: null,
        }),
      },
    });

    // findLinkedUser returns a user
    const linkedUser = { id: 10, discordId: 'discord-456' };
    // MMO event
    const mmoEvent = { id: 3, title: 'MMO Run', slotConfig: { type: 'mmo' } };
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn()
        .mockResolvedValueOnce([linkedUser])   // findLinkedUser
        .mockResolvedValueOnce([mmoEvent]),    // tryMmoRoleRedirect
    });

    await handleCharacterSelectMenu(interaction as never, 3, deps as never);

    expect(spyShowRoleSelectDropdown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embed: mockEmbed }),
    );
  });

  it('role select still shows when buildReplyEmbed returns undefined after character selection', async () => {
    const { handleCharacterSelectMenu } = await import('./signup-select-character.handlers');

    spyBuildReplyEmbed.mockResolvedValue(undefined);

    const interaction = {
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'discord-456' },
      values: ['char-xyz'],
    };

    const deps = buildBaseDeps({
      charactersService: {
        findAllForUser: jest.fn().mockResolvedValue({ data: [] }),
        findOne: jest.fn().mockResolvedValue({
          name: 'Thrall',
          role: null,
          roleOverride: null,
        }),
      },
    });

    const linkedUser = { id: 10, discordId: 'discord-456' };
    const mmoEvent = { id: 3, title: 'MMO Run', slotConfig: { type: 'mmo' } };
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn()
        .mockResolvedValueOnce([linkedUser])
        .mockResolvedValueOnce([mmoEvent]),
    });

    await handleCharacterSelectMenu(interaction as never, 3, deps as never);

    expect(spyShowRoleSelectDropdown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embed: undefined }),
    );
  });

  it('does NOT call showRoleSelect for non-MMO event — goes straight to signup', async () => {
    const { handleCharacterSelectMenu } = await import('./signup-select-character.handlers');

    const interaction = {
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'discord-456' },
      values: ['char-xyz'],
    };

    const deps = buildBaseDeps({
      signupsService: {
        ...buildMockSignupsService(),
        signup: jest.fn().mockResolvedValue({ id: 1, assignedSlot: null }),
        confirmSignup: jest.fn().mockResolvedValue(undefined),
      },
      charactersService: {
        findAllForUser: jest.fn().mockResolvedValue({ data: [] }),
        findOne: jest.fn().mockResolvedValue({
          name: 'Thrall',
          role: null,
          roleOverride: null,
          preferredRoles: null,
        }),
      },
    });

    const linkedUser = { id: 10, discordId: 'discord-456' };
    // Generic (non-MMO) event
    const genericEvent = { id: 4, title: 'Generic Run', slotConfig: { type: 'generic' } };
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn()
        .mockResolvedValueOnce([linkedUser])
        .mockResolvedValueOnce([genericEvent]),
    });

    await handleCharacterSelectMenu(interaction as never, 4, deps as never);

    expect(spyShowRoleSelectDropdown).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Thrall') }),
    );
  });
});

// ─── tryGameSignupFlow — embed threading ─────────────────────────────────────

describe('tryGameSignupFlow — embed threading', () => {
  let spyBuildReplyEmbed: jest.SpyInstance;
  let spyShowCharacterSelect: jest.SpyInstance;

  beforeEach(() => {
    spyBuildReplyEmbed = jest.spyOn(replyEmbedModule, 'buildReplyEmbed');
    spyShowCharacterSelect = jest
      .spyOn(dropdownBuildersModule, 'showCharacterSelect')
      .mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('includes embed in character select for MMO events with multiple characters', async () => {
    const { tryGameSignupFlow } = await import('./signup-signup-game.handlers');

    const mockEmbed = new EmbedBuilder().setTitle('Roster');
    spyBuildReplyEmbed.mockResolvedValue(mockEmbed);

    const interaction = buildMockInteraction();
    const characters = [
      { id: 'c1', name: 'Thrall', isMain: true },
      { id: 'c2', name: 'Alt', isMain: false },
    ];

    const deps = buildBaseDeps({
      charactersService: buildMockCharactersService(characters),
    });

    const game = { id: 1, name: 'WoW', hasRoles: true };
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([game]),
    });

    const linkedUser = { id: 5 };
    const event = { id: 10, title: 'MMO Raid', gameId: 1, slotConfig: { type: 'mmo' } };

    const result = await tryGameSignupFlow({
      interaction: interaction as never,
      eventId: 10,
      linkedUser: linkedUser as never,
      event: event as never,
      deps: deps as never,
    });

    expect(result).toBe(true);
    expect(spyShowCharacterSelect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embed: mockEmbed }),
    );
  });

  it('character select still shows when buildReplyEmbed returns undefined', async () => {
    const { tryGameSignupFlow } = await import('./signup-signup-game.handlers');

    spyBuildReplyEmbed.mockResolvedValue(undefined);

    const interaction = buildMockInteraction();
    const characters = [
      { id: 'c1', name: 'Thrall', isMain: true },
      { id: 'c2', name: 'Alt', isMain: false },
    ];

    const deps = buildBaseDeps({
      charactersService: buildMockCharactersService(characters),
    });

    const game = { id: 1, name: 'WoW', hasRoles: true };
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([game]),
    });

    const linkedUser = { id: 5 };
    const event = { id: 10, title: 'MMO Raid', gameId: 1, slotConfig: { type: 'mmo' } };

    const result = await tryGameSignupFlow({
      interaction: interaction as never,
      eventId: 10,
      linkedUser: linkedUser as never,
      event: event as never,
      deps: deps as never,
    });

    expect(result).toBe(true);
    expect(spyShowCharacterSelect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embed: undefined }),
    );
  });
});
