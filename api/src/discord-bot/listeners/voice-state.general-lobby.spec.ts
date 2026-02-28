/**
 * voice-state.general-lobby.spec.ts
 *
 * Tests for ROK-515 additions to VoiceStateListener:
 * - general-lobby binding resolution
 * - PresenceGameDetector delegation on channel join
 * - handlePresenceChange (mid-session game switching)
 * - PresenceUpdate listener registration
 */
import { Test, TestingModule } from '@nestjs/testing';
import { VoiceStateListener } from './voice-state.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { UsersService } from '../../users/users.service';
import { Events, Collection } from 'discord.js';

function makeCollection<K, V>(entries: [K, V][] = []): Collection<K, V> {
  const col = new Collection<K, V>();
  for (const [key, val] of entries) {
    col.set(key, val);
  }
  return col;
}

describe('VoiceStateListener — general lobby (ROK-515)', () => {
  let listener: VoiceStateListener;
  let mockClientService: { getClient: jest.Mock; getGuildId: jest.Mock };
  let mockAdHocEventService: {
    handleVoiceJoin: jest.Mock;
    handleVoiceLeave: jest.Mock;
    getActiveState: jest.Mock;
    hasAnyActiveEvent: jest.Mock;
  };
  let mockChannelBindingsService: { getBindings: jest.Mock };
  let mockPresenceDetector: {
    detectGameForMember: jest.Mock;
    detectGames: jest.Mock;
  };
  let mockUsersService: { findByDiscordId: jest.Mock };

  beforeEach(async () => {
    jest.useFakeTimers();

    mockClientService = {
      getClient: jest.fn(),
      getGuildId: jest.fn().mockReturnValue('guild-1'),
    };

    mockAdHocEventService = {
      handleVoiceJoin: jest.fn().mockResolvedValue(undefined),
      handleVoiceLeave: jest.fn().mockResolvedValue(undefined),
      getActiveState: jest.fn().mockReturnValue(undefined),
      hasAnyActiveEvent: jest.fn().mockReturnValue(false),
    };

    mockChannelBindingsService = {
      getBindings: jest.fn().mockResolvedValue([]),
    };

    mockPresenceDetector = {
      detectGameForMember: jest
        .fn()
        .mockResolvedValue({ gameId: null, gameName: 'Untitled Gaming Session' }),
      detectGames: jest.fn().mockResolvedValue([]),
    };

    mockUsersService = {
      findByDiscordId: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceStateListener,
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: AdHocEventService, useValue: mockAdHocEventService },
        { provide: ChannelBindingsService, useValue: mockChannelBindingsService },
        {
          provide: PresenceGameDetectorService,
          useValue: mockPresenceDetector,
        },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    listener = module.get(VoiceStateListener);
  });

  afterEach(() => {
    listener.onBotDisconnected();
    jest.useRealTimers();
  });

  function createMockClient(
    guildChannels: Map<string, unknown> = new Map(),
  ) {
    const guild = {
      channels: {
        cache: makeCollection(
          Array.from(guildChannels.entries()).map(([id, ch]) => [id, ch]),
        ),
      },
    };

    return {
      on: jest.fn(),
      removeListener: jest.fn(),
      guilds: {
        cache: makeCollection([['guild-1', guild]]),
      },
    };
  }

  // ─── PresenceUpdate listener registration ──────────────────────────────────

  describe('PresenceUpdate listener registration', () => {
    it('registers PresenceUpdate listener on bot connect', async () => {
      const mockClient = createMockClient();
      mockClientService.getClient.mockReturnValue(mockClient);

      await listener.onBotConnected();

      expect(mockClient.on).toHaveBeenCalledWith(
        Events.PresenceUpdate,
        expect.any(Function),
      );
    });

    it('removes PresenceUpdate listener on bot disconnect', async () => {
      const mockClient = createMockClient();
      mockClientService.getClient.mockReturnValue(mockClient);

      await listener.onBotConnected();
      listener.onBotDisconnected();

      expect(mockClient.removeListener).toHaveBeenCalledWith(
        Events.PresenceUpdate,
        expect.any(Function),
      );
    });

    it('replaces old PresenceUpdate listener on reconnect', async () => {
      const mockClient = createMockClient();
      mockClientService.getClient.mockReturnValue(mockClient);

      await listener.onBotConnected();
      await listener.onBotConnected(); // second connect

      expect(mockClient.removeListener).toHaveBeenCalledWith(
        Events.PresenceUpdate,
        expect.any(Function),
      );
    });
  });

  // ─── General-lobby binding resolution ─────────────────────────────────────

  describe('resolveBinding — general-lobby purpose', () => {
    it('resolves general-lobby bindings correctly', async () => {
      const voiceChannel = {
        isVoiceBased: () => true,
        members: makeCollection([
          [
            'u1',
            {
              id: 'u1',
              displayName: 'Player1',
              user: { username: 'Player1', avatar: null },
              presence: null,
            },
          ],
        ]),
      };

      const mockClient = createMockClient(
        new Map([['lobby-ch-1', voiceChannel]]),
      );
      mockClientService.getClient.mockReturnValue(mockClient);

      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-lobby',
          channelId: 'lobby-ch-1',
          bindingPurpose: 'general-lobby',
          gameId: null,
          config: { minPlayers: 2 },
        },
      ]);

      await listener.onBotConnected();

      // Bindings were queried — general-lobby purpose is recognized
      expect(mockChannelBindingsService.getBindings).toHaveBeenCalledWith(
        'guild-1',
      );
    });

    it('does NOT recognize unknown binding purposes', async () => {
      let voiceHandler: (oldState: unknown, newState: unknown) => void;
      const mockClient = createMockClient();
      mockClient.on.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === Events.VoiceStateUpdate) voiceHandler = handler;
        },
      );
      mockClientService.getClient.mockReturnValue(mockClient);

      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-other',
          channelId: 'unknown-ch',
          bindingPurpose: 'some-unknown-purpose',
          gameId: null,
          config: null,
        },
      ]);

      await listener.onBotConnected();

      voiceHandler!(
        { channelId: null, id: 'user-x' },
        {
          channelId: 'unknown-ch',
          id: 'user-x',
          member: {
            displayName: 'X',
            user: { username: 'X', avatar: null },
          },
        },
      );

      await jest.advanceTimersByTimeAsync(2100);

      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });
  });

  // ─── General-lobby join behavior ───────────────────────────────────────────

  describe('handleGeneralLobbyJoin', () => {
    let voiceHandler: (oldState: unknown, newState: unknown) => void;

    beforeEach(async () => {
      const mockClient = createMockClient();
      mockClient.on.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === Events.VoiceStateUpdate) voiceHandler = handler;
        },
      );
      mockClientService.getClient.mockReturnValue(mockClient);

      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-gl',
          channelId: 'gl-ch',
          bindingPurpose: 'general-lobby',
          gameId: null,
          config: { minPlayers: 2 },
        },
      ]);

      await listener.onBotConnected();
    });

    it('calls detectGameForMember when a member joins a general-lobby channel', async () => {
      // Active state exists so threshold check passes
      mockAdHocEventService.getActiveState.mockReturnValue({
        eventId: 1,
        memberSet: new Set(['existing-user']),
        lastExtendedAt: 0,
      });

      mockPresenceDetector.detectGameForMember.mockResolvedValue({
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
            presence: {
              activities: [{ type: 0, name: 'WoW' }],
            },
          },
        },
      );

      await jest.advanceTimersByTimeAsync(2100);

      expect(mockPresenceDetector.detectGameForMember).toHaveBeenCalled();
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalledWith(
        'bind-gl',
        expect.any(Object),
        expect.any(Object),
        5,
        'WoW',
      );
    });

    it('falls back to Untitled Gaming Session when member has no presence', async () => {
      mockAdHocEventService.getActiveState.mockReturnValue({
        eventId: 2,
        memberSet: new Set(['u-existing']),
        lastExtendedAt: 0,
      });

      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });

      voiceHandler!(
        { channelId: null, id: 'u-no-presence' },
        {
          channelId: 'gl-ch',
          id: 'u-no-presence',
          member: {
            id: 'u-no-presence',
            displayName: 'NoPresence',
            user: { username: 'NoPresence', avatar: null },
            presence: null,
          },
        },
      );

      await jest.advanceTimersByTimeAsync(2100);

      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalledWith(
        'bind-gl',
        expect.any(Object),
        expect.any(Object),
        null,
        'Untitled Gaming Session',
      );
    });

    it('does not create event when below minPlayers threshold and no active event', async () => {
      // No active event, below threshold
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      voiceHandler!(
        { channelId: null, id: 'u-solo' },
        {
          channelId: 'gl-ch',
          id: 'u-solo',
          member: {
            id: 'u-solo',
            displayName: 'Solo',
            user: { username: 'Solo', avatar: null },
            presence: null,
          },
        },
      );

      await jest.advanceTimersByTimeAsync(2100);

      // Only 1 member, minPlayers=2, no active event → no join
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });
  });

  // ─── Presence change handling (mid-session game switch) ───────────────────

  describe('handlePresenceChange (mid-session game switching)', () => {
    it('moves user to new game event when they switch games mid-session', async () => {
      let presenceHandler: (...args: unknown[]) => void;

      const mockClient = createMockClient();
      mockClient.on.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === Events.PresenceUpdate) presenceHandler = handler;
        },
      );
      mockClientService.getClient.mockReturnValue(mockClient);

      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-presence',
          channelId: 'presence-ch',
          bindingPurpose: 'general-lobby',
          gameId: null,
          config: { minPlayers: 2 },
        },
      ]);

      await listener.onBotConnected();

      // Manually set the user's channel in the listener's internal map
      // (simulates the user having already joined and the listener tracking them)
      (listener as any).userChannelMap.set('u-switch', 'presence-ch');

      // Active state for WoW (gameId=1) exists and already has 'u-switch'
      mockAdHocEventService.getActiveState.mockImplementation(
        (_bindingId: string, gameId: number | null | undefined) => {
          if (gameId === 1) {
            return {
              eventId: 10,
              memberSet: new Set(['u-switch']),
              lastExtendedAt: 0,
            };
          }
          // FFXIV event (gameId=2) doesn't exist yet
          return undefined;
        },
      );

      // Presence update: user is now playing FFXIV
      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: 2,
        gameName: 'FFXIV',
      });

      const guildMember = {
        id: 'u-switch',
        displayName: 'Switcher',
        user: { username: 'Switcher', avatar: null },
        presence: {
          activities: [{ type: 0, name: 'FFXIV' }],
        },
      };

      presenceHandler!(null, {
        userId: 'u-switch',
        guild: {
          members: {
            cache: makeCollection([['u-switch', guildMember]]),
          },
        },
      });

      // Allow async processing
      await jest.advanceTimersByTimeAsync(100);

      // Should have left the WoW event and joined the FFXIV event
      expect(mockAdHocEventService.handleVoiceLeave).toHaveBeenCalledWith(
        'bind-presence',
        'u-switch',
      );
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalledWith(
        'bind-presence',
        expect.objectContaining({ discordUserId: 'u-switch' }),
        expect.any(Object),
        2,
        'FFXIV',
      );
    });

    it('does nothing when user is not in a tracked channel', async () => {
      let presenceHandler: (...args: unknown[]) => void;

      const mockClient = createMockClient();
      mockClient.on.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === Events.PresenceUpdate) presenceHandler = handler;
        },
      );
      mockClientService.getClient.mockReturnValue(mockClient);

      await listener.onBotConnected();

      // User is not in userChannelMap (never joined a tracked channel)
      presenceHandler!(null, {
        userId: 'user-not-in-channel',
        guild: { members: { cache: new Map() } },
      });

      await jest.advanceTimersByTimeAsync(100);

      expect(mockPresenceDetector.detectGameForMember).not.toHaveBeenCalled();
      expect(mockAdHocEventService.handleVoiceLeave).not.toHaveBeenCalled();
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });

    it('does nothing when channel is not a general-lobby binding', async () => {
      let voiceHandler: (oldState: unknown, newState: unknown) => void;
      let presenceHandler: (...args: unknown[]) => void;

      const mockClient = createMockClient();
      mockClient.on.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === Events.VoiceStateUpdate) voiceHandler = handler;
          if (event === Events.PresenceUpdate) presenceHandler = handler;
        },
      );
      mockClientService.getClient.mockReturnValue(mockClient);

      // Game-specific binding (not general-lobby)
      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-game',
          channelId: 'game-ch',
          bindingPurpose: 'game-voice-monitor',
          gameId: 5,
          config: { minPlayers: 1 },
        },
      ]);

      mockAdHocEventService.getActiveState.mockReturnValue({
        eventId: 20,
        memberSet: new Set(['u-nogame']),
        lastExtendedAt: 0,
      });

      await listener.onBotConnected();

      // User joins a game-specific channel
      voiceHandler!(
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

      // Clear any calls from the join
      mockPresenceDetector.detectGameForMember.mockClear();
      mockAdHocEventService.handleVoiceLeave.mockClear();

      // Now simulate a presence update
      presenceHandler!(null, {
        userId: 'u-nogame',
        guild: {
          members: {
            cache: makeCollection([
              [
                'u-nogame',
                {
                  id: 'u-nogame',
                  displayName: 'NoSwitch',
                  user: { username: 'NoSwitch', avatar: null },
                },
              ],
            ]),
          },
        },
      });

      await jest.advanceTimersByTimeAsync(100);

      // Not a general-lobby channel → presence handler should not do anything
      expect(mockPresenceDetector.detectGameForMember).not.toHaveBeenCalled();
      expect(mockAdHocEventService.handleVoiceLeave).not.toHaveBeenCalled();
    });

    it('does nothing on presence update when null presence passed', async () => {
      let presenceHandler: (...args: unknown[]) => void;

      const mockClient = createMockClient();
      mockClient.on.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === Events.PresenceUpdate) presenceHandler = handler;
        },
      );
      mockClientService.getClient.mockReturnValue(mockClient);
      await listener.onBotConnected();

      // Should not throw when newPresence is null
      expect(() => {
        presenceHandler!(null, null);
      }).not.toThrow();
    });
  });
});
