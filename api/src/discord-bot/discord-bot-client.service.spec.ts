/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventEmitter } from 'events';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from './discord-bot.constants';
import { Events } from 'discord.js';

/**
 * Typed interface for the mock Discord.js Client used in these tests.
 * Eliminates `as any` casts by providing a contract matching the mock factory below.
 */
interface MockDiscordClient extends EventEmitter {
  user: { tag: string } | null;
  guilds: {
    cache: Map<string, unknown> & { first: jest.Mock };
  };
  users: {
    fetch: jest.Mock;
  };
  login: jest.Mock;
  destroy: jest.Mock;
  isReady: jest.Mock;
}

// Helper to access the private `client` field without `as any`
function getClient(service: DiscordBotClientService): MockDiscordClient | null {
  return (service as unknown as { client: MockDiscordClient | null }).client;
}
function setClient(
  service: DiscordBotClientService,
  client: MockDiscordClient | null,
): void {
  (service as unknown as { client: MockDiscordClient | null }).client = client;
}

// Mock discord.js Client
jest.mock('discord.js', () => {
  class MockClient extends EventEmitter {
    user: { tag: string } | null = null;
    guilds = {
      cache: new Map(),
    };
    users = {
      fetch: jest.fn(),
    };

    login = jest.fn().mockResolvedValue(undefined);
    destroy = jest.fn().mockResolvedValue(undefined);
    isReady = jest.fn().mockReturnValue(false);
  }

  return {
    Client: MockClient,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      GuildMembers: 4,
      GuildVoiceStates: 16,
      GuildPresences: 32,
      DirectMessages: 64,
      MessageContent: 128,
    },
    Events: {
      ClientReady: 'ready',
      Error: 'error',
    },
    PermissionsBitField: {
      Flags: {
        ManageRoles: BigInt(1),
        ManageChannels: BigInt(32),
        CreateInstantInvite: BigInt(64),
        ViewChannel: BigInt(16),
        SendMessages: BigInt(2),
        EmbedLinks: BigInt(4),
        ReadMessageHistory: BigInt(8),
      },
    },
  };
});

describe('DiscordBotClientService', () => {
  let service: DiscordBotClientService;
  let eventEmitter: EventEmitter2;
  let mockClient: MockDiscordClient;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordBotClientService,
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
            emitAsync: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<DiscordBotClientService>(DiscordBotClientService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any active connections
    await service.disconnect();
  });

  describe('connect', () => {
    it('should connect successfully with valid token', async () => {
      const token = 'valid-bot-token';

      // Trigger the connection
      const connectPromise = service.connect(token);

      // Get the client that was created
      mockClient = getClient(service)!;

      // Simulate successful connection
      mockClient.user = { tag: 'TestBot#1234' };
      mockClient.emit(Events.ClientReady);

      await connectPromise;

      expect(mockClient.login).toHaveBeenCalledWith(token);
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        DISCORD_BOT_EVENTS.CONNECTED,
      );
    });

    it('should handle connection errors', async () => {
      const token = 'invalid-token';
      const error = new Error('Invalid token');

      const connectPromise = service.connect(token);

      mockClient = getClient(service)!;
      mockClient.emit(Events.Error, error);

      await expect(connectPromise).rejects.toThrow(
        'Invalid bot token. Please check the token and try again.',
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        DISCORD_BOT_EVENTS.ERROR,
        error,
      );
    });

    it('should timeout after 15 seconds', async () => {
      jest.useFakeTimers();
      const token = 'slow-token';

      const connectPromise = service.connect(token);

      // Fast-forward time by 15 seconds
      jest.advanceTimersByTime(15_000);

      await expect(connectPromise).rejects.toThrow(
        'Discord bot connection timed out after 15s',
      );

      jest.useRealTimers();
    });

    it('should disconnect existing client before connecting new one', async () => {
      const firstToken = 'first-token';
      const secondToken = 'second-token';

      // First connection
      const firstConnect = service.connect(firstToken);
      const firstClient = getClient(service)!;
      firstClient.user = { tag: 'Bot1#1234' };
      firstClient.isReady.mockReturnValue(true);
      firstClient.emit(Events.ClientReady);
      await firstConnect;

      const destroySpy = jest
        .spyOn(firstClient, 'destroy')
        .mockResolvedValue(undefined);

      // Second connection should disconnect the first
      const secondConnect = service.connect(secondToken);

      // Wait a tick for disconnect to be called
      await new Promise((resolve) => setImmediate(resolve));

      expect(destroySpy).toHaveBeenCalled();

      // Complete the second connection
      const secondClient = getClient(service)!;
      secondClient.user = { tag: 'Bot2#5678' };
      secondClient.emit(Events.ClientReady);
      await secondConnect;
    });

    it('should handle login rejection', async () => {
      const token = 'bad-token';
      const error = new Error('Login failed');

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;

      // Trigger login failure immediately
      setImmediate(() => {
        const loginPromise = mockClient.login.mock.results[0]
          .value as Promise<void>;
        loginPromise.catch(() => {}); // Prevent unhandled rejection

        // Simulate login failure by rejecting and clearing the client
        setClient(service, null);
        mockClient.emit(Events.Error, error);
      });

      await expect(connectPromise).rejects.toThrow(
        'Failed to connect with provided token',
      );
    });

    it('should handle non-Error login rejection', async () => {
      const token = 'bad-token';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;

      // Trigger login failure with non-Error value
      setImmediate(() => {
        setClient(service, null);
        mockClient.emit(Events.Error, new Error('String error message'));
      });

      await expect(connectPromise).rejects.toThrow(
        'Failed to connect with provided token',
      );
    });
  });

  describe('disconnect', () => {
    it('should disconnect active client', async () => {
      const token = 'valid-token';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const destroySpy = jest
        .spyOn(mockClient, 'destroy')
        .mockResolvedValue(undefined);

      await service.disconnect();

      expect(destroySpy).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        DISCORD_BOT_EVENTS.DISCONNECTED,
      );
      expect(getClient(service)).toBeNull();
    });

    it('should do nothing if no client is connected', async () => {
      await service.disconnect();

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should handle disconnect errors gracefully', async () => {
      const token = 'valid-token';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const error = new Error('Disconnect failed');
      jest.spyOn(mockClient, 'destroy').mockRejectedValue(error);

      // Should not throw, but log error
      await expect(service.disconnect()).resolves.not.toThrow();

      // Client should still be nulled out
      expect(getClient(service)).toBeNull();
    });
  });

  describe('isConnected', () => {
    it('should return false when no client exists', () => {
      expect(service.isConnected()).toBe(false);
    });

    it('should return false when client is not ready', () => {
      // Start connection but don't complete it
      void service.connect('valid-token');
      mockClient = getClient(service)!;

      expect(service.isConnected()).toBe(false);
    });

    it('should return true when client is ready', async () => {
      const token = 'valid-token';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.isReady.mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      expect(service.isConnected()).toBe(true);
    });
  });

  describe('getGuildInfo', () => {
    it('should return null when client is not connected', () => {
      expect(service.getGuildInfo()).toBeNull();
    });

    it('should return null when client is not ready', () => {
      void service.connect('valid-token');
      mockClient = getClient(service)!;

      expect(service.getGuildInfo()).toBeNull();
    });

    it('should return guild info when connected', () => {
      // Manually create a connected state
      const client = createMockClient();
      client.user = { tag: 'Bot#1234' };
      client.isReady.mockReturnValue(true);

      // Mock guild data
      const mockGuild = {
        name: 'Test Guild',
        memberCount: 42,
      };
      client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);

      // Inject the client
      setClient(service, client);

      const info = service.getGuildInfo();

      expect(info).toEqual({
        name: 'Test Guild',
        memberCount: 42,
      });
    });

    it('should return null when no guilds are cached', async () => {
      const token = 'valid-token';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.isReady.mockReturnValue(true);
      mockClient.guilds.cache.first = jest.fn().mockReturnValue(null);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      expect(service.getGuildInfo()).toBeNull();
    });

    it('should handle errors gracefully', () => {
      // Manually create a connected state
      const client = createMockClient();
      client.user = { tag: 'Bot#1234' };
      client.isReady.mockReturnValue(true);

      // Mock guilds.cache.first() to throw
      client.guilds.cache.first = jest.fn().mockImplementation(() => {
        throw new Error('Cache error');
      });

      // Inject the client
      setClient(service, client);

      expect(service.getGuildInfo()).toBeNull();
    });
  });

  describe('sendDirectMessage', () => {
    it('should send DM when connected', async () => {
      const token = 'valid-token';
      const discordId = '123456789';
      const message = 'Hello, user!';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.isReady.mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const mockUser = {
        send: jest.fn().mockResolvedValue(undefined),
      };
      mockClient.users.fetch.mockResolvedValue(mockUser);

      await service.sendDirectMessage(discordId, message);

      expect(mockClient.users.fetch).toHaveBeenCalledWith(discordId);
      expect(mockUser.send).toHaveBeenCalledWith(message);
    });

    it('should throw when not connected', async () => {
      await expect(
        service.sendDirectMessage('123456', 'Hello'),
      ).rejects.toThrow('Discord bot is not connected');
    });

    it('should throw when user fetch fails', async () => {
      const token = 'valid-token';
      const discordId = '999999999';
      const message = 'Hello';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.isReady.mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const error = new Error('User not found');
      mockClient.users.fetch.mockRejectedValue(error);

      await expect(
        service.sendDirectMessage(discordId, message),
      ).rejects.toThrow('User not found');
    });

    it('should throw when DM send fails', async () => {
      const token = 'valid-token';
      const discordId = '123456789';
      const message = 'Hello';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.isReady.mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const error = new Error('Cannot send messages to this user');
      const mockUser = {
        send: jest.fn().mockRejectedValue(error),
      };
      mockClient.users.fetch.mockResolvedValue(mockUser);

      await expect(
        service.sendDirectMessage(discordId, message),
      ).rejects.toThrow('Cannot send messages to this user');
    });
  });

  describe('sendEmbedDM', () => {
    it('should send embed DM when connected', async () => {
      const token = 'valid-token';
      const discordId = '123456789';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.isReady.mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const mockUser = {
        send: jest.fn().mockResolvedValue(undefined),
      };
      mockClient.users.fetch.mockResolvedValue(mockUser);

      const mockEmbed = { toJSON: () => ({}) };
      const mockRow = { toJSON: () => ({ components: [] }) };

      await service.sendEmbedDM(
        discordId,
        mockEmbed as unknown as Parameters<typeof service.sendEmbedDM>[1],
        mockRow as unknown as Parameters<typeof service.sendEmbedDM>[2],
      );

      expect(mockClient.users.fetch).toHaveBeenCalledWith(discordId);
      expect(mockUser.send).toHaveBeenCalledWith({
        embeds: [mockEmbed],
        components: [mockRow],
      });
    });

    it('should send embed without row when row is not provided', async () => {
      const token = 'valid-token';
      const discordId = '123456789';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.isReady.mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const mockUser = {
        send: jest.fn().mockResolvedValue(undefined),
      };
      mockClient.users.fetch.mockResolvedValue(mockUser);

      const mockEmbed = { toJSON: () => ({}) };

      await service.sendEmbedDM(
        discordId,
        mockEmbed as Parameters<typeof service.sendEmbedDM>[1],
      );

      expect(mockUser.send).toHaveBeenCalledWith({
        embeds: [mockEmbed],
      });
      // components key should NOT be present
      const sendCalls = mockUser.send.mock.calls as Array<
        [{ embeds: unknown[]; components?: unknown[] }]
      >;
      expect(sendCalls[0][0].components).toBeUndefined();
    });

    it('should throw when not connected', async () => {
      const mockEmbed = { toJSON: () => ({}) };

      await expect(
        service.sendEmbedDM(
          '123456',
          mockEmbed as Parameters<typeof service.sendEmbedDM>[1],
        ),
      ).rejects.toThrow('Discord bot is not connected');
    });

    it('should throw when user fetch fails', async () => {
      const token = 'valid-token';
      const discordId = '999999999';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.isReady.mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const error = new Error('Unknown User');
      mockClient.users.fetch.mockRejectedValue(error);

      const mockEmbed = { toJSON: () => ({}) };

      await expect(
        service.sendEmbedDM(
          discordId,
          mockEmbed as Parameters<typeof service.sendEmbedDM>[1],
        ),
      ).rejects.toThrow('Unknown User');
    });

    it('should throw when send fails (e.g. DMs disabled)', async () => {
      const token = 'valid-token';
      const discordId = '123456789';

      const connectPromise = service.connect(token);
      mockClient = getClient(service)!;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.isReady.mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const error = new Error('Cannot send messages to this user');
      const mockUser = {
        send: jest.fn().mockRejectedValue(error),
      };
      mockClient.users.fetch.mockResolvedValue(mockUser);

      const mockEmbed = { toJSON: () => ({}) };

      await expect(
        service.sendEmbedDM(
          discordId,
          mockEmbed as Parameters<typeof service.sendEmbedDM>[1],
        ),
      ).rejects.toThrow('Cannot send messages to this user');
    });
  });

  describe('checkPermissions', () => {
    it('should return all false when no client exists', () => {
      const results = service.checkPermissions();

      expect(results).toHaveLength(8);
      results.forEach((r) => expect(r.granted).toBe(false));
    });

    it('should return all false when client is not ready', () => {
      void service.connect('valid-token');
      // Don't fire ready event

      const results = service.checkPermissions();

      expect(results).toHaveLength(8);
      results.forEach((r) => expect(r.granted).toBe(false));
    });

    it('should return all false when no guild is cached', () => {
      const client = createMockClient();
      client.user = { tag: 'Bot#1234' };
      client.isReady.mockReturnValue(true);
      client.guilds.cache.first = jest.fn().mockReturnValue(null);
      setClient(service, client);

      const results = service.checkPermissions();

      expect(results).toHaveLength(8);
      results.forEach((r) => expect(r.granted).toBe(false));
    });

    it('should return all false when guild.members.me is null', () => {
      const client = createMockClient();
      client.user = { tag: 'Bot#1234' };
      client.isReady.mockReturnValue(true);
      const mockGuild = { members: { me: null } };
      client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
      setClient(service, client);

      const results = service.checkPermissions();

      expect(results).toHaveLength(8);
      results.forEach((r) => expect(r.granted).toBe(false));
    });

    it('should return correct permission check results', () => {
      const client = createMockClient();
      client.user = { tag: 'Bot#1234' };
      client.isReady.mockReturnValue(true);
      const mockMe = {
        permissions: {
          has: jest.fn().mockImplementation((flag: bigint) => {
            // Grant all except ManageRoles (BigInt(1))
            return flag !== BigInt(1);
          }),
        },
      };
      const mockGuild = { members: { me: mockMe } };
      client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
      setClient(service, client);

      const results = service.checkPermissions();

      expect(results).toHaveLength(8);
      const manageRoles = results.find((r) => r.name === 'Manage Roles');
      expect(manageRoles?.granted).toBe(false);
      const sendMessages = results.find((r) => r.name === 'Send Messages');
      expect(sendMessages?.granted).toBe(true);
    });
  });
});

/**
 * Creates a fresh MockDiscordClient instance using the mocked Client constructor.
 * This avoids needing to import the real Client while keeping typed access.
 */
function createMockClient(): MockDiscordClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('discord.js') as {
    Client: new (opts: unknown) => MockDiscordClient;
  };
  return new Client({});
}
