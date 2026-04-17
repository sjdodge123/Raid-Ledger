/**
 * TDD tests for steam-link.listener.ts — Steam URL interest prompt (ROK-966).
 *
 * These tests define the expected behavior of the SteamLinkListener,
 * which detects Steam store URLs in Discord messages and prompts
 * users to mark interest in the game on Raid Ledger.
 *
 * The implementation file does NOT exist yet. These tests MUST fail
 * with "Cannot find module" until the dev agent creates the source.
 *
 * Follows the EventLinkListener test pattern with extracted setup functions
 * and function-scoped describe blocks.
 */
import { SteamLinkListener } from './steam-link.listener';
import { ChannelType, Events } from 'discord.js';

let listener: SteamLinkListener;
let mockClientService: Record<string, jest.Mock>;
let mockDb: Record<string, jest.Mock>;
let mockDmSend: jest.Mock;

let messageIdCounter = 0;

function setupSteamLinkModule() {
  mockClientService = {
    getClient: jest.fn(),
  };

  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue([]);
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.values = jest.fn().mockReturnValue(chain);
  chain.onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
  chain.onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  chain.select = jest.fn().mockReturnValue(chain);
  mockDb = chain;

  listener = new SteamLinkListener(
    mockDb as never,
    mockClientService as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

function callHandleMessage(message: unknown): Promise<void> {
  return (
    listener as unknown as { handleMessage: (m: unknown) => Promise<void> }
  ).handleMessage(message);
}

function callHandleButtonInteraction(interaction: unknown): Promise<void> {
  return (
    listener as unknown as {
      handleButtonInteraction: (i: unknown) => Promise<void>;
    }
  ).handleButtonInteraction(interaction);
}

function createMessage(
  content: string,
  overrides: Record<string, unknown> = {},
) {
  messageIdCounter++;
  return {
    id: `msg-${messageIdCounter}`,
    content,
    author: {
      bot: false,
      id: 'discord-user-1',
      createDM: jest.fn().mockResolvedValue({ send: mockDmSend }),
    },
    guild: { id: 'guild-123' },
    channel: { type: ChannelType.GuildText, id: 'chan-1' },
    ...overrides,
  };
}

function makeButtonInteraction(
  customId: string,
  userId: string = 'discord-user-1',
) {
  const interaction = {
    isButton: () => true,
    customId,
    user: { id: userId, username: 'TestUser' },
    replied: false,
    deferred: false,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(() => {
      interaction.replied = true;
      return Promise.resolve(undefined);
    }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  return interaction;
}

function stubGameLookup(
  game: { id: number; name: string; steamAppId: number } | null,
) {
  if (game) {
    mockDb.limit.mockResolvedValueOnce([game]);
  } else {
    mockDb.limit.mockResolvedValueOnce([]);
  }
}

function stubUserLookup(user: { id: number; discordId: string } | null) {
  if (user) {
    mockDb.limit.mockResolvedValueOnce([user]);
  } else {
    mockDb.limit.mockResolvedValueOnce([]);
  }
}

function stubInterestCheck(exists: boolean) {
  if (exists) {
    mockDb.limit.mockResolvedValueOnce([{ id: 1 }]);
  } else {
    mockDb.limit.mockResolvedValueOnce([]);
  }
}

function stubAutoHeartPref(enabled: boolean) {
  if (enabled) {
    mockDb.limit.mockResolvedValueOnce([
      { key: 'autoHeartSteamUrls', value: true },
    ]);
  } else {
    mockDb.limit.mockResolvedValueOnce([]);
  }
}

describe('SteamLinkListener', () => {
  beforeEach(() => {
    setupSteamLinkModule();
    mockDmSend = jest.fn().mockResolvedValue({ id: 'dm-1' });
    messageIdCounter = 0;
  });

  describe('handleBotConnected', () => {
    botConnectedTests();
  });

  describe('handleBotDisconnected', () => {
    botDisconnectedTests();
  });

  describe('message handling — Steam URL detection', () => {
    steamUrlDetectionTests();
  });

  describe('message handling — ephemeral prompt', () => {
    ephemeralPromptTests();
  });

  describe('message handling — silent skip conditions', () => {
    silentSkipTests();
  });

  describe('message handling — auto-heart preference', () => {
    autoHeartTests();
  });

  describe('message handling — DM confirmations (ROK-1054)', () => {
    dmConfirmationTests();
  });

  describe('button handlers', () => {
    buttonHandlerTests();
  });

  describe('rate limiting / dedup', () => {
    rateLimitTests();
  });
});

function botConnectedTests() {
  it('registers a messageCreate listener on the client', () => {
    const mockOn = jest.fn();
    mockClientService.getClient.mockReturnValue({ on: mockOn });

    listener.handleBotConnected();

    expect(mockOn).toHaveBeenCalledWith(
      Events.MessageCreate,
      expect.any(Function),
    );
  });

  it('does not register twice on duplicate connect events', () => {
    const mockOn = jest.fn();
    mockClientService.getClient.mockReturnValue({ on: mockOn });

    listener.handleBotConnected();
    listener.handleBotConnected();

    // 2 listeners per connect (messageCreate + interactionCreate), not 4
    expect(mockOn).toHaveBeenCalledTimes(2);
  });

  it('skips registration when client is null', () => {
    mockClientService.getClient.mockReturnValue(null);
    expect(() => listener.handleBotConnected()).not.toThrow();
  });
}

function botDisconnectedTests() {
  it('resets listener state so it can re-attach', () => {
    const mockOn = jest.fn();
    mockClientService.getClient.mockReturnValue({ on: mockOn });

    listener.handleBotConnected();
    listener.handleBotDisconnected();
    listener.handleBotConnected();

    // 2 listeners per connect (messageCreate + interactionCreate), x2 connects = 4
    expect(mockOn).toHaveBeenCalledTimes(4);
  });
}

function steamUrlDetectionTests() {
  it('detects store.steampowered.com/app/:id in a message', async () => {
    // Game exists in DB
    stubGameLookup({ id: 42, name: 'CS2', steamAppId: 730 });
    // User is linked
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    // No existing interest
    stubInterestCheck(false);
    // No auto-heart pref
    stubAutoHeartPref(false);

    const msg = createMessage(
      'Check out https://store.steampowered.com/app/730/CS2/',
    );
    await callHandleMessage(msg);

    // Should reply with ephemeral prompt
    expect(mockDmSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Raid Ledger'),
      }),
    );
  });

  it('skips messages from bots', async () => {
    const msg = createMessage('https://store.steampowered.com/app/730/CS2/', {
      author: { bot: true, id: 'bot-1' },
    });
    await callHandleMessage(msg);
    expect(mockDmSend).not.toHaveBeenCalled();
  });

  it('skips DM messages (no guild)', async () => {
    const msg = createMessage('https://store.steampowered.com/app/730/CS2/', {
      guild: null,
    });
    await callHandleMessage(msg);
    expect(mockDmSend).not.toHaveBeenCalled();
  });

  it('skips messages with no Steam URLs', async () => {
    const msg = createMessage('Just chatting about games!');
    await callHandleMessage(msg);
    expect(mockDmSend).not.toHaveBeenCalled();
  });
}

function ephemeralPromptTests() {
  it('shows game name in the ephemeral prompt', async () => {
    stubGameLookup({ id: 42, name: 'Counter-Strike 2', steamAppId: 730 });
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    stubInterestCheck(false);
    stubAutoHeartPref(false);

    const msg = createMessage('https://store.steampowered.com/app/730/CS2/');
    await callHandleMessage(msg);

    expect(mockDmSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Counter-Strike 2'),
      }),
    );
  });

  it('includes 3 button options in the prompt', async () => {
    stubGameLookup({ id: 42, name: 'CS2', steamAppId: 730 });
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    stubInterestCheck(false);
    stubAutoHeartPref(false);

    const msg = createMessage('https://store.steampowered.com/app/730/CS2/');
    await callHandleMessage(msg);

    expect(mockDmSend).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.arrayContaining([expect.anything()]),
      }),
    );
  });
}

function silentSkipTests() {
  it('silently skips when game is not in the DB', async () => {
    stubGameLookup(null);

    const msg = createMessage(
      'https://store.steampowered.com/app/99999/Unknown/',
    );
    await callHandleMessage(msg);

    expect(mockDmSend).not.toHaveBeenCalled();
  });

  it('silently skips when user is not linked to Raid Ledger', async () => {
    stubGameLookup({ id: 42, name: 'CS2', steamAppId: 730 });
    stubUserLookup(null);

    const msg = createMessage('https://store.steampowered.com/app/730/CS2/');
    await callHandleMessage(msg);

    expect(mockDmSend).not.toHaveBeenCalled();
  });

  it('does not send an interest prompt when user is already interested in the game', async () => {
    stubGameLookup({ id: 42, name: 'CS2', steamAppId: 730 });
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    stubInterestCheck(true);

    const msg = createMessage('https://store.steampowered.com/app/730/CS2/');
    await callHandleMessage(msg);

    // ROK-1054: a confirmation DM IS sent (see dmConfirmationTests),
    // but the interest prompt with buttons (components) is NOT sent.
    const calls = mockDmSend.mock.calls;
    const hasPromptWithComponents = calls.some(
      (call) =>
        Array.isArray((call[0] as Record<string, unknown>)?.components) &&
        ((call[0] as { components: unknown[] }).components.length ?? 0) > 0,
    );
    expect(hasPromptWithComponents).toBe(false);
    // Should not have inserted any new interest row either
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
}

function autoHeartTests() {
  it('auto-hearts without prompt when preference is enabled', async () => {
    stubGameLookup({ id: 42, name: 'CS2', steamAppId: 730 });
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    stubInterestCheck(false);
    stubAutoHeartPref(true);

    const msg = createMessage('https://store.steampowered.com/app/730/CS2/');
    await callHandleMessage(msg);

    // Should auto-insert the interest (calls insert)
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'discord',
      }),
    );
    // Should NOT show the ephemeral prompt (no interactive reply)
    // The reply should either not happen or be a confirmation, not a button prompt
  });
}

function buttonHandlerTests() {
  it('heart button creates game_interests row with source discord', async () => {
    // Stub user lookup for button handler
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    mockDb.onConflictDoNothing.mockResolvedValueOnce(undefined);

    const interaction = makeButtonInteraction('steam_interest_heart:42');
    await callHandleButtonInteraction(interaction);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'discord',
      }),
    );
  });

  it('dismiss button does not create any interest row', async () => {
    const interaction = makeButtonInteraction('steam_interest_dismiss:42');
    await callHandleButtonInteraction(interaction);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('dismiss button updates the ephemeral message', async () => {
    const interaction = makeButtonInteraction('steam_interest_dismiss:42');
    await callHandleButtonInteraction(interaction);

    expect(interaction.update).toHaveBeenCalled();
  });

  it('auto button creates interest AND sets autoHeartSteamUrls preference', async () => {
    // Stub user lookup for button handler
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    mockDb.onConflictDoNothing.mockResolvedValueOnce(undefined);
    mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);

    const interaction = makeButtonInteraction('steam_interest_auto:42');
    await callHandleButtonInteraction(interaction);

    // Should insert the interest
    expect(mockDb.insert).toHaveBeenCalled();
    // The interaction should have values calls for both interest and preference
    const valuesCalls = mockDb.values.mock.calls;
    const hasDiscordSource = valuesCalls.some(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>)?.source === 'discord',
    );
    const hasAutoHeartPref = valuesCalls.some(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>)?.key === 'autoHeartSteamUrls',
    );
    expect(hasDiscordSource).toBe(true);
    expect(hasAutoHeartPref).toBe(true);
  });

  it('heart button updates the ephemeral message with confirmation', async () => {
    // Stub user lookup for button handler
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    mockDb.onConflictDoNothing.mockResolvedValueOnce(undefined);

    const interaction = makeButtonInteraction('steam_interest_heart:42');
    await callHandleButtonInteraction(interaction);

    expect(interaction.update).toHaveBeenCalled();
  });
}

function dmConfirmationTests() {
  it('AC1: DMs the user when they post a Steam link for a game they already have hearted', async () => {
    // Game exists, user linked, interest already present
    stubGameLookup({ id: 42, name: 'Counter-Strike 2', steamAppId: 730 });
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    stubInterestCheck(true);

    const msg = createMessage('https://store.steampowered.com/app/730/CS2/');
    await callHandleMessage(msg);

    // Expect a DM confirmation that matches the spec copy
    expect(mockDmSend).toHaveBeenCalledTimes(1);
    expect(mockDmSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          'You already have **Counter-Strike 2** hearted',
        ),
      }),
    );
  });

  it('AC2: DMs the user when auto-heart adds a game interest', async () => {
    stubGameLookup({ id: 42, name: 'Counter-Strike 2', steamAppId: 730 });
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    stubInterestCheck(false);
    stubAutoHeartPref(true);

    const msg = createMessage('https://store.steampowered.com/app/730/CS2/');
    await callHandleMessage(msg);

    // Auto-heart should still add the interest
    expect(mockDb.insert).toHaveBeenCalled();
    // And DM the user with an "Auto-hearted ..." confirmation
    expect(mockDmSend).toHaveBeenCalledTimes(1);
    expect(mockDmSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Auto-hearted **Counter-Strike 2**'),
      }),
    );
  });

  it('AC3: swallows DM send errors (user has DMs disabled) and logs a warning', async () => {
    stubGameLookup({ id: 42, name: 'Counter-Strike 2', steamAppId: 730 });
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    // Trigger the already-hearted branch so we exercise the new DM send
    stubInterestCheck(true);

    // Simulate DM send failing (e.g. user has DMs disabled)
    const dmError = new Error('Cannot send messages to this user');
    mockDmSend.mockRejectedValueOnce(dmError);

    // Spy on the listener's logger warn method
    const warnSpy = jest
      .spyOn(
        (listener as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation();

    const msg = createMessage('https://store.steampowered.com/app/730/CS2/');

    // Should NOT throw when DM send rejects
    await expect(callHandleMessage(msg)).resolves.toBeUndefined();

    // Should have attempted the DM once
    expect(mockDmSend).toHaveBeenCalledTimes(1);
    // Should have logged a warning instead of throwing
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
}

function rateLimitTests() {
  it('deduplicates the same message ID (HMR protection)', async () => {
    stubGameLookup({ id: 42, name: 'CS2', steamAppId: 730 });
    stubUserLookup({ id: 7, discordId: 'discord-user-1' });
    stubInterestCheck(false);
    stubAutoHeartPref(false);

    const msg = createMessage('https://store.steampowered.com/app/730/CS2/');
    // Call twice with the same message
    await callHandleMessage(msg);
    await callHandleMessage(msg);

    // Should only prompt once
    expect(mockDmSend).toHaveBeenCalledTimes(1);
  });
}
