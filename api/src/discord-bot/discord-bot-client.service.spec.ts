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

/**
 * Creates a fresh MockDiscordClient instance using the mocked Client constructor.
 */
function createMockClient(): MockDiscordClient {
  const { Client } = jest.requireMock<{
    Client: new (opts: unknown) => MockDiscordClient;
  }>('discord.js');
  return new Client({});
}

/** Connect and wait for ready event to fire. */
async function connectAndReady(
  service: DiscordBotClientService,
  token: string,
): Promise<MockDiscordClient> {
  const connectPromise = service.connect(token);
  const client = getClient(service)!;
  client.user = { tag: 'Bot#1234' };
  client.isReady.mockReturnValue(true);
  client.emit(Events.ClientReady);
  await connectPromise;
  return client;
}

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
  jest.clearAllMocks();
});

afterEach(async () => {
  await service.disconnect();
});

describe('DiscordBotClientService — connect: success', () => {
  it('should connect successfully with valid token', async () => {
    mockClient = await connectAndReady(service, 'valid-bot-token');

    expect(mockClient.login).toHaveBeenCalledWith('valid-bot-token');
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      DISCORD_BOT_EVENTS.CONNECTED,
    );
  });

  it('should disconnect existing client before connecting new one', async () => {
    const firstClient = await connectAndReady(service, 'first-token');
    const destroySpy = jest
      .spyOn(firstClient, 'destroy')
      .mockResolvedValue(undefined);

    const secondConnect = service.connect('second-token');
    await new Promise((resolve) => setImmediate(resolve));
    expect(destroySpy).toHaveBeenCalled();

    const secondClient = getClient(service)!;
    secondClient.user = { tag: 'Bot2#5678' };
    secondClient.emit(Events.ClientReady);
    await secondConnect;
  });
});

describe('DiscordBotClientService — connect: failures', () => {
  it('should handle connection errors', async () => {
    const error = new Error('Invalid token');
    const connectPromise = service.connect('invalid-token');

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

    const connectPromise = service.connect('slow-token');
    jest.advanceTimersByTime(15_000);

    await expect(connectPromise).rejects.toThrow(
      'Discord bot connection timed out after 15s',
    );

    jest.useRealTimers();
  });

  it('should handle login rejection', async () => {
    const error = new Error('Login failed');
    const connectPromise = service.connect('bad-token');
    mockClient = getClient(service)!;

    setImmediate(() => {
      const loginPromise = mockClient.login.mock.results[0]
        .value as Promise<void>;
      loginPromise.catch(() => {});
      setClient(service, null);
      mockClient.emit(Events.Error, error);
    });

    await expect(connectPromise).rejects.toThrow(
      'Failed to connect with provided token',
    );
  });

  it('should handle non-Error login rejection', async () => {
    const connectPromise = service.connect('bad-token');
    mockClient = getClient(service)!;

    setImmediate(() => {
      setClient(service, null);
      mockClient.emit(Events.Error, new Error('String error message'));
    });

    await expect(connectPromise).rejects.toThrow(
      'Failed to connect with provided token',
    );
  });
});

describe('DiscordBotClientService — disconnect', () => {
  it('should disconnect active client', async () => {
    mockClient = await connectAndReady(service, 'valid-token');
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
    mockClient = await connectAndReady(service, 'valid-token');
    jest.spyOn(mockClient, 'destroy').mockRejectedValue(new Error('fail'));

    await expect(service.disconnect()).resolves.not.toThrow();
    expect(getClient(service)).toBeNull();
  });
});

describe('DiscordBotClientService — isConnected', () => {
  it('should return false when no client exists', () => {
    expect(service.isConnected()).toBe(false);
  });

  it('should return false when client is not ready', () => {
    void service.connect('valid-token');
    expect(service.isConnected()).toBe(false);
  });

  it('should return true when client is ready', async () => {
    await connectAndReady(service, 'valid-token');
    expect(service.isConnected()).toBe(true);
  });
});

describe('DiscordBotClientService — getGuildInfo: edge cases', () => {
  it('should return null when client is not connected', () => {
    expect(service.getGuildInfo()).toBeNull();
  });

  it('should return null when client is not ready', () => {
    void service.connect('valid-token');
    expect(service.getGuildInfo()).toBeNull();
  });

  it('should return null when no guilds are cached', async () => {
    mockClient = await connectAndReady(service, 'valid-token');
    mockClient.guilds.cache.first = jest.fn().mockReturnValue(null);

    expect(service.getGuildInfo()).toBeNull();
  });

  it('should handle errors gracefully', () => {
    const client = createMockClient();
    client.user = { tag: 'Bot#1234' };
    client.isReady.mockReturnValue(true);
    client.guilds.cache.first = jest.fn().mockImplementation(() => {
      throw new Error('Cache error');
    });
    setClient(service, client);

    expect(service.getGuildInfo()).toBeNull();
  });
});

describe('DiscordBotClientService — getGuildInfo: success', () => {
  it('should return guild info when connected', () => {
    const client = createMockClient();
    client.user = { tag: 'Bot#1234' };
    client.isReady.mockReturnValue(true);
    client.guilds.cache.first = jest.fn().mockReturnValue({
      name: 'Test Guild',
      memberCount: 42,
    });
    setClient(service, client);

    expect(service.getGuildInfo()).toEqual({
      name: 'Test Guild',
      memberCount: 42,
    });
  });
});

describe('DiscordBotClientService — sendDirectMessage', () => {
  it('should send DM when connected', async () => {
    mockClient = await connectAndReady(service, 'valid-token');
    const mockUser = { send: jest.fn().mockResolvedValue(undefined) };
    mockClient.users.fetch.mockResolvedValue(mockUser);

    await service.sendDirectMessage('123456789', 'Hello, user!');

    expect(mockClient.users.fetch).toHaveBeenCalledWith('123456789');
    expect(mockUser.send).toHaveBeenCalledWith('Hello, user!');
  });

  it('should throw when not connected', async () => {
    await expect(service.sendDirectMessage('123456', 'Hello')).rejects.toThrow(
      'Discord bot is not connected',
    );
  });

  it('should throw when user fetch fails', async () => {
    mockClient = await connectAndReady(service, 'valid-token');
    mockClient.users.fetch.mockRejectedValue(new Error('User not found'));

    await expect(
      service.sendDirectMessage('999999999', 'Hello'),
    ).rejects.toThrow('User not found');
  });

  it('should throw when DM send fails', async () => {
    mockClient = await connectAndReady(service, 'valid-token');
    const mockUser = {
      send: jest
        .fn()
        .mockRejectedValue(new Error('Cannot send messages to this user')),
    };
    mockClient.users.fetch.mockResolvedValue(mockUser);

    await expect(
      service.sendDirectMessage('123456789', 'Hello'),
    ).rejects.toThrow('Cannot send messages to this user');
  });
});

describe('DiscordBotClientService — sendEmbedDM: success', () => {
  it('should send embed DM when connected', async () => {
    mockClient = await connectAndReady(service, 'valid-token');
    const mockUser = { send: jest.fn().mockResolvedValue(undefined) };
    mockClient.users.fetch.mockResolvedValue(mockUser);

    const mockEmbed = { toJSON: () => ({}) };
    const mockRow = { toJSON: () => ({ components: [] }) };

    await service.sendEmbedDM(
      '123456789',
      mockEmbed as unknown as Parameters<typeof service.sendEmbedDM>[1],
      mockRow as unknown as Parameters<typeof service.sendEmbedDM>[2],
    );

    expect(mockClient.users.fetch).toHaveBeenCalledWith('123456789');
    expect(mockUser.send).toHaveBeenCalledWith({
      embeds: [mockEmbed],
      components: [mockRow],
    });
  });

  it('should send embed without row when row is not provided', async () => {
    mockClient = await connectAndReady(service, 'valid-token');
    const mockUser = { send: jest.fn().mockResolvedValue(undefined) };
    mockClient.users.fetch.mockResolvedValue(mockUser);

    const mockEmbed = { toJSON: () => ({}) };

    await service.sendEmbedDM(
      '123456789',
      mockEmbed as Parameters<typeof service.sendEmbedDM>[1],
    );

    expect(mockUser.send).toHaveBeenCalledWith({
      embeds: [mockEmbed],
    });
    const sendCalls = mockUser.send.mock.calls as Array<
      [{ embeds: unknown[]; components?: unknown[] }]
    >;
    expect(sendCalls[0][0].components).toBeUndefined();
  });
});

describe('DiscordBotClientService — sendEmbedDM: failures', () => {
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
    mockClient = await connectAndReady(service, 'valid-token');
    mockClient.users.fetch.mockRejectedValue(new Error('Unknown User'));

    const mockEmbed = { toJSON: () => ({}) };

    await expect(
      service.sendEmbedDM(
        '999999999',
        mockEmbed as Parameters<typeof service.sendEmbedDM>[1],
      ),
    ).rejects.toThrow('Unknown User');
  });

  it('should throw when send fails (e.g. DMs disabled)', async () => {
    mockClient = await connectAndReady(service, 'valid-token');
    const mockUser = {
      send: jest
        .fn()
        .mockRejectedValue(new Error('Cannot send messages to this user')),
    };
    mockClient.users.fetch.mockResolvedValue(mockUser);

    const mockEmbed = { toJSON: () => ({}) };

    await expect(
      service.sendEmbedDM(
        '123456789',
        mockEmbed as Parameters<typeof service.sendEmbedDM>[1],
      ),
    ).rejects.toThrow('Cannot send messages to this user');
  });
});

describe('DiscordBotClientService — checkPermissions', () => {
  it('should return all false when no client exists', () => {
    const results = service.checkPermissions();
    expect(results).toHaveLength(13);
    results.forEach((r) => expect(r.granted).toBe(false));
  });

  it('should return all false when client is not ready', () => {
    void service.connect('valid-token');
    const results = service.checkPermissions();
    expect(results).toHaveLength(13);
    results.forEach((r) => expect(r.granted).toBe(false));
  });

  it('should return all false when no guild is cached', () => {
    const client = createMockClient();
    client.user = { tag: 'Bot#1234' };
    client.isReady.mockReturnValue(true);
    client.guilds.cache.first = jest.fn().mockReturnValue(null);
    setClient(service, client);

    const results = service.checkPermissions();
    expect(results).toHaveLength(13);
    results.forEach((r) => expect(r.granted).toBe(false));
  });

  it('should return all false when guild.members.me is null', () => {
    const client = createMockClient();
    client.user = { tag: 'Bot#1234' };
    client.isReady.mockReturnValue(true);
    client.guilds.cache.first = jest
      .fn()
      .mockReturnValue({ members: { me: null } });
    setClient(service, client);

    const results = service.checkPermissions();
    expect(results).toHaveLength(13);
    results.forEach((r) => expect(r.granted).toBe(false));
  });

  it('should return correct permission check results', () => {
    const client = createMockClient();
    client.user = { tag: 'Bot#1234' };
    client.isReady.mockReturnValue(true);
    const mockMe = {
      permissions: {
        has: jest.fn().mockImplementation((flag: bigint) => {
          return flag !== BigInt(1);
        }),
      },
    };
    client.guilds.cache.first = jest
      .fn()
      .mockReturnValue({ members: { me: mockMe } });
    setClient(service, client);

    const results = service.checkPermissions();

    expect(results).toHaveLength(13);
    const manageRoles = results.find((r) => r.name === 'Manage Roles');
    expect(manageRoles?.granted).toBe(false);
    const sendMessages = results.find((r) => r.name === 'Send Messages');
    expect(sendMessages?.granted).toBe(true);
  });
});
