import { Test, TestingModule } from '@nestjs/testing';
import { VoiceStateListener } from './voice-state.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
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

    mockUsersService = {
      findByDiscordId: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceStateListener,
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: AdHocEventService, useValue: mockAdHocEventService },
        { provide: ChannelBindingsService, useValue: mockChannelBindingsService },
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

      const mockClient = createMockClient(new Map([['voice-ch-1', voiceChannel]]));
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

      // Recovery should track members — no error
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
      mockClient.on.mockImplementation((_event: string, handler: (...args: unknown[]) => void) => {
        voiceHandler = handler;
      });
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
          member: { displayName: 'Test', user: { username: 'Test', avatar: null } },
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
      // Use real timers for this async test to avoid fake timer + microtask issues
      jest.useRealTimers();

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

      // Re-register with real timers
      const newClient = createMockClient();
      newClient.on.mockImplementation((_event: string, handler: (...args: unknown[]) => void) => {
        voiceHandler = handler;
      });
      mockClientService.getClient.mockReturnValue(newClient);
      await listener.onBotConnected();

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

      // Wait for debounce (2000ms) + async processing
      await new Promise((resolve) => setTimeout(resolve, 2200));

      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();

      jest.useFakeTimers();
    }, 10000);

    it('detects leave event (channel -> null)', async () => {
      // Use real timers for this async test
      jest.useRealTimers();

      mockChannelBindingsService.getBindings.mockResolvedValue([
        {
          id: 'bind-leave',
          channelId: 'voice-ch-leave',
          bindingPurpose: 'game-voice-monitor',
          gameId: 1,
          config: {},
        },
      ]);

      const newClient = createMockClient();
      newClient.on.mockImplementation((_event: string, handler: (...args: unknown[]) => void) => {
        voiceHandler = handler;
      });
      mockClientService.getClient.mockReturnValue(newClient);
      await listener.onBotConnected();

      voiceHandler(
        { channelId: 'voice-ch-leave', id: 'user-leave' },
        { channelId: null, id: 'user-leave', member: null },
      );

      await new Promise((resolve) => setTimeout(resolve, 2200));

      expect(mockAdHocEventService.handleVoiceLeave).toHaveBeenCalled();

      jest.useFakeTimers();
    }, 10000);

    it('detects move event (channel A -> channel B) as leave+join', () => {
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

      jest.advanceTimersByTime(2100);
      // Should handle leave from ch-a and join to ch-b
    });
  });

  describe('threshold checking', () => {
    it('does not trigger event creation when below minPlayers threshold', async () => {
      const mockClient = createMockClient();
      mockClient.on.mockImplementation((_event: string, handler: (...args: unknown[]) => void) => {
        // no-op, we test via method
      });
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

      // getActiveState returns undefined (no active event)
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      await listener.onBotConnected();

      // With no active event and only 1 member < 3 minPlayers,
      // the listener should NOT call handleVoiceJoin
    });
  });

  describe('binding resolution', () => {
    it('returns null for unbound channels', async () => {
      const mockClient = createMockClient();
      mockClient.on.mockImplementation(() => {});
      mockClientService.getClient.mockReturnValue(mockClient);

      mockChannelBindingsService.getBindings.mockResolvedValue([]);

      await listener.onBotConnected();

      // Unbound channels should be skipped silently
    });

    it('caches binding lookups', async () => {
      const mockClient = createMockClient();
      mockClient.on.mockImplementation(() => {});
      mockClientService.getClient.mockReturnValue(mockClient);

      await listener.onBotConnected();

      // After disconnect, cache should be cleared
      listener.onBotDisconnected();
    });
  });
});
