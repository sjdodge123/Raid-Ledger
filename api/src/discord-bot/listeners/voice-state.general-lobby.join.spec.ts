/**
 * Tests for ROK-515: handleGeneralLobbyJoin and handlePresenceChange (mid-session game switching).
 */
import { Events } from 'discord.js';
import {
  createMockClient,
  setupGeneralLobbyTestModule,
  type GeneralLobbyMocks,
} from './voice-state.general-lobby.spec-helpers';
import type { VoiceStateListener } from './voice-state.listener';

let listener: VoiceStateListener;
let mocks: GeneralLobbyMocks;
let voiceHandler: (oldState: unknown, newState: unknown) => void;

async function setupJoinModule() {
  jest.useFakeTimers();
  const setup = await setupGeneralLobbyTestModule();
  listener = setup.listener;
  mocks = setup.mocks;
}

function teardownJoinModule() {
  listener.onBotDisconnected();
  jest.useRealTimers();
}

async function connectWithLobbyBinding() {
  const mockClient = createMockClient();
  mockClient.on.mockImplementation(
    (event: string, handler: (...args: unknown[]) => void) => {
      if (event === (Events.VoiceStateUpdate as string)) voiceHandler = handler;
    },
  );
  mocks.clientService.getClient.mockReturnValue(mockClient);
  mocks.channelBindingsService.getBindingsWithGameNames.mockResolvedValue([
    {
      id: 'bind-gl',
      channelId: 'gl-ch',
      bindingPurpose: 'general-lobby',
      gameId: null,
      gameName: null,
      config: { minPlayers: 2 },
    },
  ]);
  await listener.onBotConnected();
}

function makeJoinEvent(userId: string, displayName: string) {
  return {
    channelId: 'gl-ch',
    id: userId,
    member: {
      id: userId,
      displayName,
      user: { username: displayName, avatar: null },
      presence: null,
    },
  };
}

function gameDetectedJoinTest() {
  it('calls detectGameForMember when a member joins a general-lobby channel', async () => {
    mocks.adHocEventService.getActiveState.mockReturnValue({
      eventId: 1,
      memberSet: new Set(['existing-user']),
      lastExtendedAt: 0,
    });
    mocks.presenceDetector.detectGameForMember.mockResolvedValue({
      gameId: 5,
      gameName: 'WoW',
    });
    voiceHandler!(
      { channelId: null, id: 'u-join' },
      {
        channelId: 'gl-ch',
        id: 'u-join',
        member: {
          id: 'u-join',
          displayName: 'Joiner',
          user: { username: 'Joiner', avatar: null },
          presence: { activities: [{ type: 0, name: 'WoW' }] },
        },
      },
    );
    await jest.advanceTimersByTimeAsync(2100);
    expect(mocks.presenceDetector.detectGameForMember).toHaveBeenCalled();
    expect(mocks.adHocEventService.handleVoiceJoin).toHaveBeenCalledWith(
      'bind-gl',
      expect.any(Object),
      expect.any(Object),
      5,
      'WoW',
      'gl-ch',
    );
  });
}

function noGameNoChattingTest() {
  it('does NOT create event when no game detected and allowJustChatting is off', async () => {
    mocks.adHocEventService.getActiveState.mockReturnValue({
      eventId: 2,
      memberSet: new Set(['u-existing']),
      lastExtendedAt: 0,
    });
    mocks.presenceDetector.detectGameForMember.mockResolvedValue({
      gameId: null,
      gameName: 'Untitled Gaming Session',
    });
    voiceHandler!(
      { channelId: null, id: 'u-no-presence' },
      makeJoinEvent('u-no-presence', 'NoPresence'),
    );
    await jest.advanceTimersByTimeAsync(2100);
    expect(mocks.adHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
  });
}

function recheckTests() {
  it('schedules a delayed re-check when no game detected, and joins event if game appears', async () => {
    mocks.presenceDetector.detectGameForMember
      .mockResolvedValueOnce({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      })
      .mockResolvedValueOnce({
        gameId: 42,
        gameName: 'World of Warcraft Classic',
      })
      .mockResolvedValueOnce({
        gameId: 42,
        gameName: 'World of Warcraft Classic',
      });
    mocks.adHocEventService.getActiveState.mockReturnValue({
      eventId: 100,
      memberSet: new Set(['u-existing']),
    });
    voiceHandler!(
      { channelId: null, id: 'u-recheck' },
      makeJoinEvent('u-recheck', 'Rechecked'),
    );
    await jest.advanceTimersByTimeAsync(2100);
    expect(mocks.adHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(7100);
    expect(mocks.adHocEventService.handleVoiceJoin).toHaveBeenCalledWith(
      'bind-gl',
      expect.objectContaining({ discordUserId: 'u-recheck' }),
      expect.any(Object),
      42,
      'World of Warcraft Classic',
      'gl-ch',
    );
  });

  it('does NOT join event on re-check if game is still null', async () => {
    mocks.presenceDetector.detectGameForMember.mockResolvedValue({
      gameId: null,
      gameName: 'Untitled Gaming Session',
    });
    voiceHandler!(
      { channelId: null, id: 'u-still-null' },
      makeJoinEvent('u-still-null', 'StillNull'),
    );
    await jest.advanceTimersByTimeAsync(2100 + 7100);
    expect(mocks.adHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
  });

  it('cancels pending re-check when user leaves the channel', async () => {
    mocks.presenceDetector.detectGameForMember.mockResolvedValue({
      gameId: null,
      gameName: 'Untitled Gaming Session',
    });
    voiceHandler!(
      { channelId: null, id: 'u-leaves' },
      makeJoinEvent('u-leaves', 'Leaver'),
    );
    await jest.advanceTimersByTimeAsync(2100);
    voiceHandler!(
      { channelId: 'gl-ch', id: 'u-leaves' },
      { channelId: null, id: 'u-leaves', member: null },
    );
    await jest.advanceTimersByTimeAsync(2100);
    mocks.presenceDetector.detectGameForMember.mockResolvedValueOnce({
      gameId: 42,
      gameName: 'WoW Classic',
    });
    await jest.advanceTimersByTimeAsync(7100);
    expect(mocks.adHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
  });
}

function allowJustChattingTest() {
  it('creates "Just Chatting" event when allowJustChatting is enabled and no game detected', async () => {
    mocks.channelBindingsService.getBindingsWithGameNames.mockResolvedValue([
      {
        id: 'bind-gl',
        channelId: 'gl-ch',
        bindingPurpose: 'general-lobby',
        gameId: null,
        gameName: null,
        config: { minPlayers: 2, allowJustChatting: true },
      },
    ]);
    listener.onBotDisconnected();
    const mockClient = createMockClient();
    mockClient.on.mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === (Events.VoiceStateUpdate as string))
          voiceHandler = handler;
      },
    );
    mocks.clientService.getClient.mockReturnValue(mockClient);
    await listener.onBotConnected();
    mocks.adHocEventService.getActiveState.mockReturnValue({
      eventId: 3,
      memberSet: new Set(['u-existing']),
      lastExtendedAt: 0,
    });
    mocks.presenceDetector.detectGameForMember.mockResolvedValue({
      gameId: null,
      gameName: 'Untitled Gaming Session',
    });
    voiceHandler!(
      { channelId: null, id: 'u-chatting' },
      makeJoinEvent('u-chatting', 'Chatter'),
    );
    await jest.advanceTimersByTimeAsync(2100);
    expect(mocks.adHocEventService.handleVoiceJoin).toHaveBeenCalledWith(
      'bind-gl',
      expect.any(Object),
      expect.any(Object),
      null,
      'Just Chatting',
      'gl-ch',
    );
  });
}

function belowThresholdTest() {
  it('does not create event when below minPlayers threshold and no active event', async () => {
    mocks.adHocEventService.getActiveState.mockReturnValue(undefined);
    voiceHandler!(
      { channelId: null, id: 'u-solo' },
      makeJoinEvent('u-solo', 'Solo'),
    );
    await jest.advanceTimersByTimeAsync(2100);
    expect(mocks.adHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
  });
}

/**
 * ROK-1445 AC3 split this into two cases. The presence-change path used to mint
 * a NEW event unconditionally, so one member switching to a game nobody else
 * plays got their own 1-person event whatever `minPlayers` said. Joining an
 * EXISTING event is still unconditional (a 3rd member switching in must be able
 * to join); minting a new one now requires the group to clear the threshold.
 */
function presenceChangeGameSwitchTest() {
  /** Boot a general-lobby binding on `presence-ch` and return its handler. */
  async function bootPresenceLobby(): Promise<(...a: unknown[]) => void> {
    let presenceHandler: (...args: unknown[]) => void;
    const mockClient = createMockClient();
    mockClient.on.mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === (Events.PresenceUpdate as string))
          presenceHandler = handler;
      },
    );
    mocks.clientService.getClient.mockReturnValue(mockClient);
    mocks.channelBindingsService.getBindingsWithGameNames.mockResolvedValue([
      {
        id: 'bind-presence',
        channelId: 'presence-ch',
        bindingPurpose: 'general-lobby',
        gameId: null,
        gameName: null,
        config: { minPlayers: 2 },
      },
    ]);
    await listener.onBotConnected();
    (
      listener as unknown as { userChannelMap: Map<string, string> }
    ).userChannelMap.set('u-switch', 'presence-ch');
    mocks.presenceDetector.detectGameForMember.mockResolvedValue({
      gameId: 2,
      gameName: 'FFXIV',
    });
    return presenceHandler!;
  }

  /** Fire the PresenceUpdate that switches `u-switch` onto FFXIV. */
  async function fireSwitch(
    presenceHandler: (...a: unknown[]) => void,
  ): Promise<void> {
    presenceHandler(null, {
      userId: 'u-switch',
      member: {
        id: 'u-switch',
        displayName: 'Switcher',
        user: { username: 'Switcher', avatar: null },
        presence: { activities: [{ type: 0, name: 'FFXIV' }] },
        voice: { channelId: 'presence-ch' },
      },
    });
    await jest.advanceTimersByTimeAsync(100);
  }

  it('moves user into an EXISTING event for the game they switch to', async () => {
    const presenceHandler = await bootPresenceLobby();
    // Both the old (1) and the switched-to (2) game hold a live event; the
    // switcher is only on the old one.
    mocks.adHocEventService.getActiveState.mockImplementation(
      (_bindingId: string, gameId: number | null | undefined) => {
        if (gameId === 1)
          return {
            eventId: 10,
            memberSet: new Set(['u-switch']),
            lastExtendedAt: 0,
          };
        if (gameId === 2)
          return {
            eventId: 11,
            memberSet: new Set(['u-other']),
            lastExtendedAt: 0,
          };
        return undefined;
      },
    );

    await fireSwitch(presenceHandler);

    expect(mocks.adHocEventService.handleVoiceLeave).toHaveBeenCalledWith(
      'bind-presence',
      'u-switch',
    );
    expect(mocks.adHocEventService.handleVoiceJoin).toHaveBeenCalledWith(
      'bind-presence',
      expect.objectContaining({ discordUserId: 'u-switch' }),
      expect.any(Object),
      2,
      'FFXIV',
      'presence-ch',
    );
  });

  it('does NOT mint a new 1-person event when nobody else plays the new game (ROK-1445 AC3)', async () => {
    const presenceHandler = await bootPresenceLobby();
    mocks.adHocEventService.getActiveState.mockImplementation(
      (_bindingId: string, gameId: number | null | undefined) => {
        if (gameId === 1)
          return {
            eventId: 10,
            memberSet: new Set(['u-switch']),
            lastExtendedAt: 0,
          };
        return undefined;
      },
    );

    await fireSwitch(presenceHandler);

    // Still leaves the old event — they genuinely stopped playing that game.
    expect(mocks.adHocEventService.handleVoiceLeave).toHaveBeenCalledWith(
      'bind-presence',
      'u-switch',
    );
    expect(mocks.adHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
  });
}

function presenceChangeNoOpTests() {
  it('does nothing when user is not in a tracked channel', async () => {
    let presenceHandler: (...args: unknown[]) => void;
    const mockClient = createMockClient();
    mockClient.on.mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === (Events.PresenceUpdate as string))
          presenceHandler = handler;
      },
    );
    mocks.clientService.getClient.mockReturnValue(mockClient);
    await listener.onBotConnected();
    presenceHandler!(null, { userId: 'user-not-in-channel', member: null });
    await jest.advanceTimersByTimeAsync(100);
    expect(mocks.presenceDetector.detectGameForMember).not.toHaveBeenCalled();
    expect(mocks.adHocEventService.handleVoiceLeave).not.toHaveBeenCalled();
    expect(mocks.adHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
  });

  it('does nothing on presence update when member is not in a tracked channel', async () => {
    let presenceHandler: (...args: unknown[]) => void;
    const mockClient = createMockClient();
    mockClient.on.mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === (Events.PresenceUpdate as string))
          presenceHandler = handler;
      },
    );
    mocks.clientService.getClient.mockReturnValue(mockClient);
    await listener.onBotConnected();
    presenceHandler!(null, { userId: 'unknown-user', member: null });
    await jest.advanceTimersByTimeAsync(100);
    expect(mocks.presenceDetector.detectGameForMember).not.toHaveBeenCalled();
  });
}

function presenceChangeNonLobbyTest() {
  it('does nothing when channel is not a general-lobby binding', async () => {
    let localVoiceHandler: (oldState: unknown, newState: unknown) => void;
    let presenceHandler: (...args: unknown[]) => void;
    const mockClient = createMockClient();
    mockClient.on.mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === (Events.VoiceStateUpdate as string))
          localVoiceHandler = handler;
        if (event === (Events.PresenceUpdate as string))
          presenceHandler = handler;
      },
    );
    mocks.clientService.getClient.mockReturnValue(mockClient);
    mocks.channelBindingsService.getBindingsWithGameNames.mockResolvedValue([
      {
        id: 'bind-game',
        channelId: 'game-ch',
        bindingPurpose: 'game-voice-monitor',
        gameId: 5,
        gameName: 'SomeGame',
        config: { minPlayers: 1 },
      },
    ]);
    mocks.adHocEventService.getActiveState.mockReturnValue({
      eventId: 20,
      memberSet: new Set(['u-nogame']),
      lastExtendedAt: 0,
    });
    await listener.onBotConnected();
    localVoiceHandler!(
      { channelId: null, id: 'u-nogame' },
      {
        channelId: 'game-ch',
        id: 'u-nogame',
        member: {
          displayName: 'NoSwitch',
          user: { username: 'NoSwitch', avatar: null },
        },
      },
    );
    await jest.advanceTimersByTimeAsync(2100);
    mocks.presenceDetector.detectGameForMember.mockClear();
    mocks.adHocEventService.handleVoiceLeave.mockClear();
    presenceHandler!(null, {
      userId: 'u-nogame',
      member: {
        id: 'u-nogame',
        displayName: 'NoSwitch',
        user: { username: 'NoSwitch', avatar: null },
      },
    });
    await jest.advanceTimersByTimeAsync(100);
    expect(mocks.presenceDetector.detectGameForMember).not.toHaveBeenCalled();
    expect(mocks.adHocEventService.handleVoiceLeave).not.toHaveBeenCalled();
  });
}

describe('VoiceStateListener — join & presence (ROK-515)', () => {
  beforeEach(async () => {
    await setupJoinModule();
    await connectWithLobbyBinding();
  });

  afterEach(() => {
    teardownJoinModule();
  });

  describe('handleGeneralLobbyJoin', () => {
    gameDetectedJoinTest();
    noGameNoChattingTest();

    describe('re-check logic', () => {
      recheckTests();
    });

    allowJustChattingTest();
    belowThresholdTest();
  });

  describe('handlePresenceChange (mid-session game switching)', () => {
    presenceChangeGameSwitchTest();
    presenceChangeNoOpTests();
    presenceChangeNonLobbyTest();
  });
});
