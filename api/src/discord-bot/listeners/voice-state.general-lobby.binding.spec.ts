/**
 * Tests for ROK-515: PresenceUpdate listener registration and general-lobby binding resolution.
 */
import { Events } from 'discord.js';
import {
  makeCollection,
  createMockClient,
  setupGeneralLobbyTestModule,
  type GeneralLobbyMocks,
} from './voice-state.general-lobby.spec-helpers';
import type { VoiceStateListener } from './voice-state.listener';

describe('VoiceStateListener — registration & binding (ROK-515)', () => {
  let listener: VoiceStateListener;
  let mocks: GeneralLobbyMocks;

  beforeEach(async () => {
    jest.useFakeTimers();
    const setup = await setupGeneralLobbyTestModule();
    listener = setup.listener;
    mocks = setup.mocks;
  });

  afterEach(() => {
    listener.onBotDisconnected();
    jest.useRealTimers();
  });

  describe('PresenceUpdate listener registration', () => {
    it('registers PresenceUpdate listener on bot connect', async () => {
      const mockClient = createMockClient();
      mocks.clientService.getClient.mockReturnValue(mockClient);
      await listener.onBotConnected();
      expect(mockClient.on).toHaveBeenCalledWith(Events.PresenceUpdate, expect.any(Function));
    });

    it('removes PresenceUpdate listener on bot disconnect', async () => {
      const mockClient = createMockClient();
      mocks.clientService.getClient.mockReturnValue(mockClient);
      await listener.onBotConnected();
      listener.onBotDisconnected();
      expect(mockClient.removeListener).toHaveBeenCalledWith(Events.PresenceUpdate, expect.any(Function));
    });

    it('replaces old PresenceUpdate listener on reconnect', async () => {
      const mockClient = createMockClient();
      mocks.clientService.getClient.mockReturnValue(mockClient);
      await listener.onBotConnected();
      await listener.onBotConnected();
      expect(mockClient.removeListener).toHaveBeenCalledWith(Events.PresenceUpdate, expect.any(Function));
    });
  });

  describe('resolveBinding — general-lobby purpose', () => {
    it('resolves general-lobby bindings correctly', async () => {
      const voiceChannel = {
        isVoiceBased: () => true,
        members: makeCollection([
          ['u1', { id: 'u1', displayName: 'Player1', user: { username: 'Player1', avatar: null }, presence: null }],
        ]),
      };
      const mockClient = createMockClient(new Map([['lobby-ch-1', voiceChannel]]));
      mocks.clientService.getClient.mockReturnValue(mockClient);
      mocks.channelBindingsService.getBindingsWithGameNames.mockResolvedValue([
        { id: 'bind-lobby', channelId: 'lobby-ch-1', bindingPurpose: 'general-lobby', gameId: null, gameName: null, config: { minPlayers: 2 } },
      ]);
      await listener.onBotConnected();
      expect(mocks.channelBindingsService.getBindingsWithGameNames).toHaveBeenCalledWith('guild-1');
    });

    it('does NOT recognize unknown binding purposes', async () => {
      let voiceHandler: (oldState: unknown, newState: unknown) => void;
      const mockClient = createMockClient();
      mockClient.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === (Events.VoiceStateUpdate as string)) voiceHandler = handler;
      });
      mocks.clientService.getClient.mockReturnValue(mockClient);
      mocks.channelBindingsService.getBindingsWithGameNames.mockResolvedValue([
        { id: 'bind-other', channelId: 'unknown-ch', bindingPurpose: 'some-unknown-purpose', gameId: null, gameName: null, config: null },
      ]);
      await listener.onBotConnected();
      voiceHandler!(
        { channelId: null, id: 'user-x' },
        { channelId: 'unknown-ch', id: 'user-x', member: { displayName: 'X', user: { username: 'X', avatar: null } } },
      );
      await jest.advanceTimersByTimeAsync(2100);
      expect(mocks.adHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });
  });
});
