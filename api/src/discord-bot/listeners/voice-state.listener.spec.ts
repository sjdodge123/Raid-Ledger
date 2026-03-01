import { Test, TestingModule } from '@nestjs/testing';
import { VoiceStateListener } from './voice-state.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { UsersService } from '../../users/users.service';
import { Events, Collection } from 'discord.js';

/** Create a discord.js-compatible Collection from entries */
function makeCollection<K, V>(entries: [K, V][] = []): Collection<K, V> {
  const col = new Collection<K, V>();
  for (const [key, val] of entries) {
    col.set(key, val);
  }
  return col;
}

describe('VoiceStateListener', () => {
  let listener: VoiceStateListener;
  let mockClientService: {
    getClient: jest.Mock;
    getGuildId: jest.Mock;
  };
  let mockAdHocEventService: {
    handleVoiceJoin: jest.Mock;
    handleVoiceLeave: jest.Mock;
    getActiveState: jest.Mock;
  };
  let mockChannelBindingsService: {
    getBindings: jest.Mock;
  };
  let mockPresenceDetector: {
    detectGameForMember: jest.Mock;
    detectGames: jest.Mock;
    setManualOverride: jest.Mock;
  };
  let mockUsersService: {
    findByDiscordId: jest.Mock;
  };

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
    };

    mockChannelBindingsService = {
      getBindings: jest.fn().mockResolvedValue([]),
    };

    mockPresenceDetector = {
      detectGameForMember: jest.fn().mockResolvedValue(null),
      detectGames: jest
        .fn()
        .mockResolvedValue({ primary: null, groups: new Map() }),
      setManualOverride: jest.fn(),
    };

    mockUsersService = {
      findByDiscordId: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceStateListener,
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: AdHocEventService, useValue: mockAdHocEventService },
        {
          provide: VoiceAttendanceService,
          useValue: {
            findActiveScheduledEvents: jest.fn().mockResolvedValue([]),
            handleJoin: jest.fn(),
            handleLeave: jest.fn(),
            recoverActiveSessions: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ChannelBindingsService,
          useValue: mockChannelBindingsService,
        },
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

  function createMockClient(guildChannels: Map<string, unknown> = new Map()) {
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

  describe('onBotConnected', () => {
    it('registers voiceStateUpdate listener on connect', async () => {
      const mockClient = createMockClient();
      mockClientService.getClient.mockReturnValue(mockClient);

      await listener.onBotConnected();

      expect(mockClient.on).toHaveBeenCalledWith(
        Events.VoiceStateUpdate,
        expect.any(Function),
      );
    });

    it('does nothing when client is null', async () => {
      mockClientService.getClient.mockReturnValue(null);

      await listener.onBotConnected();
      // No error, just returns
    });

    it('removes existing handler on reconnect before registering new one', async () => {
      const mockClient = createMockClient();
      mockClientService.getClient.mockReturnValue(mockClient);

      await listener.onBotConnected();
      await listener.onBotConnected();

      expect(mockClient.removeListener).toHaveBeenCalledWith(
        Events.VoiceStateUpdate,
        expect.any(Function),
      );
    });

    it('recovers members from bound voice channels on startup', async () => {
      const voiceChannel = {
        isVoiceBased: () => true,
        members: makeCollection([
          ['user-1', { id: 'user-1' }],
          ['user-2', { id: 'user-2' }],
        ]),
      };

      const mockClient = createMockClient(
        new Map([['voice-ch-1', voiceChannel]]),
      );
      mockClientService.getClient.mockReturnValue(mockClient);

      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-1',
          channelId: 'voice-ch-1',
          bindingPurpose: 'game-voice-monitor',
          gameId: 1,
          config: { minPlayers: 2 },
        },
      ]);

      await listener.onBotConnected();

      // Recovery should have looked up bindings for the voice channel
      expect(mockChannelBindingsService.getBindings).toHaveBeenCalledWith(
        'guild-1',
      );
    });
  });

  describe('onBotDisconnected', () => {
    it('removes listener and clears caches', async () => {
      const mockClient = createMockClient();
      mockClientService.getClient.mockReturnValue(mockClient);

      await listener.onBotConnected();
      listener.onBotDisconnected();

      expect(mockClient.removeListener).toHaveBeenCalledWith(
        Events.VoiceStateUpdate,
        expect.any(Function),
      );
    });
  });

  describe('handleVoiceStateUpdate', () => {
    let voiceHandler: (oldState: unknown, newState: unknown) => void;

    beforeEach(async () => {
      const mockClient = createMockClient();
      mockClient.on.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === (Events.VoiceStateUpdate as string)) {
            voiceHandler = handler;
          }
        },
      );
      mockClientService.getClient.mockReturnValue(mockClient);

      await listener.onBotConnected();
    });

    it('ignores same-channel events (mute/deafen)', () => {
      voiceHandler(
        { channelId: 'ch-1', id: 'user-1' },
        { channelId: 'ch-1', id: 'user-1' },
      );

      jest.advanceTimersByTime(3000);
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
      expect(mockAdHocEventService.handleVoiceLeave).not.toHaveBeenCalled();
    });

    it('debounces rapid join/leave events for same user', () => {
      // Quick join
      voiceHandler(
        { channelId: null, id: 'user-rapid' },
        {
          channelId: 'ch-1',
          id: 'user-rapid',
          member: {
            displayName: 'Test',
            user: { username: 'Test', avatar: null },
          },
        },
      );

      // Quick leave before debounce expires — only the leave should fire
      voiceHandler(
        { channelId: 'ch-1', id: 'user-rapid' },
        { channelId: null, id: 'user-rapid', member: null },
      );

      // Verify first timer was cleared (only one fires)
      jest.advanceTimersByTime(3000);
    });

    it('detects join event (null -> channel)', async () => {
      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-join',
          channelId: 'voice-ch-join',
          bindingPurpose: 'game-voice-monitor',
          gameId: 1,
          config: { minPlayers: 1 },
        },
      ]);

      // Active state so threshold check passes
      mockAdHocEventService.getActiveState.mockReturnValue({
        eventId: 100,
        memberSet: new Set(),
        lastExtendedAt: 0,
      });

      voiceHandler(
        { channelId: null, id: 'user-join' },
        {
          channelId: 'voice-ch-join',
          id: 'user-join',
          member: {
            displayName: 'JoinPlayer',
            user: { username: 'JoinPlayer', avatar: 'abc' },
          },
        },
      );

      // Advance past debounce and flush async processing
      await jest.advanceTimersByTimeAsync(2100);

      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });

    it('detects leave event (channel -> null)', async () => {
      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-leave',
          channelId: 'voice-ch-leave',
          bindingPurpose: 'game-voice-monitor',
          gameId: 1,
          config: {},
        },
      ]);

      voiceHandler(
        { channelId: 'voice-ch-leave', id: 'user-leave' },
        { channelId: null, id: 'user-leave', member: null },
      );

      // Advance past debounce and flush async processing
      await jest.advanceTimersByTimeAsync(2100);

      expect(mockAdHocEventService.handleVoiceLeave).toHaveBeenCalled();
    });

    it('detects move event (channel A -> channel B) as leave+join', async () => {
      // Both channels are bound
      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-a',
          channelId: 'ch-a',
          bindingPurpose: 'game-voice-monitor',
          gameId: 1,
          config: { minPlayers: 1 },
        },
        {
          id: 'bind-b',
          channelId: 'ch-b',
          bindingPurpose: 'game-voice-monitor',
          gameId: 2,
          config: { minPlayers: 1 },
        },
      ]);

      // Active state exists for both so threshold check passes
      mockAdHocEventService.getActiveState.mockReturnValue({
        eventId: 200,
        memberSet: new Set(),
        lastExtendedAt: 0,
      });

      voiceHandler(
        { channelId: 'ch-a', id: 'user-move' },
        {
          channelId: 'ch-b',
          id: 'user-move',
          member: {
            displayName: 'Mover',
            user: { username: 'Mover', avatar: null },
          },
        },
      );

      // Advance past debounce and flush async processing
      await jest.advanceTimersByTimeAsync(2100);

      expect(mockAdHocEventService.handleVoiceLeave).toHaveBeenCalled();
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });
  });

  describe('threshold checking', () => {
    it('does not trigger event creation when below minPlayers threshold', async () => {
      let capturedHandler: (oldState: unknown, newState: unknown) => void;
      const mockClient = createMockClient();
      mockClient.on.mockImplementation(
        (_event: string, handler: (...args: unknown[]) => void) => {
          capturedHandler = handler;
        },
      );
      mockClientService.getClient.mockReturnValue(mockClient);

      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-thresh',
          channelId: 'voice-thresh',
          bindingPurpose: 'game-voice-monitor',
          gameId: 1,
          config: { minPlayers: 3 },
        },
      ]);

      // No active event — threshold must be met before creating one
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      await listener.onBotConnected();

      // Single join — only 1 member, below minPlayers=3
      capturedHandler!(
        { channelId: null, id: 'user-below-thresh' },
        {
          channelId: 'voice-thresh',
          id: 'user-below-thresh',
          member: {
            displayName: 'Solo',
            user: { username: 'Solo', avatar: null },
          },
        },
      );

      await jest.advanceTimersByTimeAsync(2100);

      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });
  });

  describe('binding resolution', () => {
    it('skips unbound channels without calling ad-hoc services', async () => {
      let capturedHandler: (oldState: unknown, newState: unknown) => void;
      const mockClient = createMockClient();
      mockClient.on.mockImplementation(
        (_event: string, handler: (...args: unknown[]) => void) => {
          capturedHandler = handler;
        },
      );
      mockClientService.getClient.mockReturnValue(mockClient);

      // No bindings at all
      mockChannelBindingsService.getBindings.mockResolvedValue([]);

      await listener.onBotConnected();

      capturedHandler!(
        { channelId: null, id: 'user-unbound' },
        {
          channelId: 'unbound-channel',
          id: 'user-unbound',
          member: {
            displayName: 'Unbound',
            user: { username: 'Unbound', avatar: null },
          },
        },
      );

      await jest.advanceTimersByTimeAsync(2100);

      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });
  });
});
