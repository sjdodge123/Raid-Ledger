import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from './discord-bot.constants';
import { Client, Events } from 'discord.js';

// Mock discord.js Client
jest.mock('discord.js', () => {
  const EventEmitter = require('events');

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
      DirectMessages: 8,
    },
    Events: {
      ClientReady: 'ready',
      Error: 'error',
    },
  };
});

describe('DiscordBotClientService', () => {
  let service: DiscordBotClientService;
  let eventEmitter: EventEmitter2;
  let mockClient: Client;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordBotClientService,
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
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
      mockClient = (service as any).client;

      // Simulate successful connection
      mockClient.user = { tag: 'TestBot#1234' };
      mockClient.emit(Events.ClientReady);

      await connectPromise;

      expect(mockClient.login).toHaveBeenCalledWith(token);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        DISCORD_BOT_EVENTS.CONNECTED,
      );
    });

    it('should handle connection errors', async () => {
      const token = 'invalid-token';
      const error = new Error('Invalid token');

      const connectPromise = service.connect(token);

      mockClient = (service as any).client;
      mockClient.emit(Events.Error, error);

      await expect(connectPromise).rejects.toThrow('Invalid token');
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
      const firstClient = (service as any).client;
      firstClient.user = { tag: 'Bot1#1234' };
      (firstClient.isReady as jest.Mock).mockReturnValue(true);
      firstClient.emit(Events.ClientReady);
      await firstConnect;

      const destroySpy = jest.spyOn(firstClient, 'destroy').mockResolvedValue(undefined);

      // Second connection should disconnect the first
      const secondConnect = service.connect(secondToken);

      // Wait a tick for disconnect to be called
      await new Promise(resolve => setImmediate(resolve));

      expect(destroySpy).toHaveBeenCalled();

      // Complete the second connection
      const secondClient = (service as any).client;
      secondClient.user = { tag: 'Bot2#5678' };
      secondClient.emit(Events.ClientReady);
      await secondConnect;
    });

    it('should handle login rejection', async () => {
      const token = 'bad-token';
      const error = new Error('Login failed');

      const connectPromise = service.connect(token);
      mockClient = (service as any).client;

      // Trigger login failure immediately
      setImmediate(() => {
        const loginSpy = mockClient.login as jest.Mock;
        const loginPromise = loginSpy.mock.results[0].value;
        loginPromise.catch(() => {}); // Prevent unhandled rejection

        // Simulate login failure by rejecting and clearing the client
        (service as any).client = null;
        mockClient.emit(Events.Error, error);
      });

      await expect(connectPromise).rejects.toThrow('Login failed');
    });

    it('should handle non-Error login rejection', async () => {
      const token = 'bad-token';

      const connectPromise = service.connect(token);
      mockClient = (service as any).client;

      // Trigger login failure with non-Error value
      setImmediate(() => {
        (service as any).client = null;
        mockClient.emit(Events.Error, new Error('String error message'));
      });

      await expect(connectPromise).rejects.toThrow('String error message');
    });
  });

  describe('disconnect', () => {
    it('should disconnect active client', async () => {
      const token = 'valid-token';

      const connectPromise = service.connect(token);
      mockClient = (service as any).client;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const destroySpy = jest.spyOn(mockClient, 'destroy').mockResolvedValue();

      await service.disconnect();

      expect(destroySpy).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        DISCORD_BOT_EVENTS.DISCONNECTED,
      );
      expect((service as any).client).toBeNull();
    });

    it('should do nothing if no client is connected', async () => {
      await service.disconnect();

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should handle disconnect errors gracefully', async () => {
      const token = 'valid-token';

      const connectPromise = service.connect(token);
      mockClient = (service as any).client;
      mockClient.user = { tag: 'Bot#1234' };
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const error = new Error('Disconnect failed');
      jest.spyOn(mockClient, 'destroy').mockRejectedValue(error);

      // Should not throw, but log error
      await expect(service.disconnect()).resolves.not.toThrow();

      // Client should still be nulled out
      expect((service as any).client).toBeNull();
    });
  });

  describe('isConnected', () => {
    it('should return false when no client exists', () => {
      expect(service.isConnected()).toBe(false);
    });

    it('should return false when client is not ready', async () => {
      const token = 'valid-token';

      // Start connection but don't complete it
      service.connect(token);
      mockClient = (service as any).client;

      expect(service.isConnected()).toBe(false);
    });

    it('should return true when client is ready', async () => {
      const token = 'valid-token';

      const connectPromise = service.connect(token);
      mockClient = (service as any).client;
      mockClient.user = { tag: 'Bot#1234' };
      (mockClient.isReady as jest.Mock).mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      expect(service.isConnected()).toBe(true);
    });
  });

  describe('getGuildInfo', () => {
    it('should return null when client is not connected', () => {
      expect(service.getGuildInfo()).toBeNull();
    });

    it('should return null when client is not ready', async () => {
      const token = 'valid-token';

      service.connect(token);
      mockClient = (service as any).client;

      expect(service.getGuildInfo()).toBeNull();
    });

    it('should return guild info when connected', async () => {
      // Manually create a connected state
      const client = new Client({} as any);
      client.user = { tag: 'Bot#1234' } as any;
      (client.isReady as jest.Mock).mockReturnValue(true);

      // Mock guild data
      const mockGuild = {
        name: 'Test Guild',
        memberCount: 42,
      };
      client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);

      // Inject the client
      (service as any).client = client;

      const info = service.getGuildInfo();

      expect(info).toEqual({
        name: 'Test Guild',
        memberCount: 42,
      });
    });

    it('should return null when no guilds are cached', async () => {
      const token = 'valid-token';

      const connectPromise = service.connect(token);
      mockClient = (service as any).client;
      mockClient.user = { tag: 'Bot#1234' };
      (mockClient.isReady as jest.Mock).mockReturnValue(true);
      mockClient.guilds.cache.first = jest.fn().mockReturnValue(null);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      expect(service.getGuildInfo()).toBeNull();
    });

    it('should handle errors gracefully', () => {
      // Manually create a connected state
      const client = new Client({} as any);
      client.user = { tag: 'Bot#1234' } as any;
      (client.isReady as jest.Mock).mockReturnValue(true);

      // Mock guilds.cache.first() to throw
      client.guilds.cache.first = jest.fn().mockImplementation(() => {
        throw new Error('Cache error');
      });

      // Inject the client
      (service as any).client = client;

      expect(service.getGuildInfo()).toBeNull();
    });
  });

  describe('sendDirectMessage', () => {
    it('should send DM when connected', async () => {
      const token = 'valid-token';
      const discordId = '123456789';
      const message = 'Hello, user!';

      const connectPromise = service.connect(token);
      mockClient = (service as any).client;
      mockClient.user = { tag: 'Bot#1234' };
      (mockClient.isReady as jest.Mock).mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const mockUser = {
        send: jest.fn().mockResolvedValue(undefined),
      };
      (mockClient.users.fetch as jest.Mock).mockResolvedValue(mockUser);

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
      mockClient = (service as any).client;
      mockClient.user = { tag: 'Bot#1234' };
      (mockClient.isReady as jest.Mock).mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const error = new Error('User not found');
      (mockClient.users.fetch as jest.Mock).mockRejectedValue(error);

      await expect(service.sendDirectMessage(discordId, message)).rejects.toThrow(
        'User not found',
      );
    });

    it('should throw when DM send fails', async () => {
      const token = 'valid-token';
      const discordId = '123456789';
      const message = 'Hello';

      const connectPromise = service.connect(token);
      mockClient = (service as any).client;
      mockClient.user = { tag: 'Bot#1234' };
      (mockClient.isReady as jest.Mock).mockReturnValue(true);
      mockClient.emit(Events.ClientReady);
      await connectPromise;

      const error = new Error('Cannot send messages to this user');
      const mockUser = {
        send: jest.fn().mockRejectedValue(error),
      };
      (mockClient.users.fetch as jest.Mock).mockResolvedValue(mockUser);

      await expect(service.sendDirectMessage(discordId, message)).rejects.toThrow(
        'Cannot send messages to this user',
      );
    });
  });
});
