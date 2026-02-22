/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventEmitter } from 'events';
import { DiscordBotClientService } from './discord-bot-client.service';

/**
 * Typed interface for the mock Discord.js Client used in these tests.
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

function createMockClient(): MockDiscordClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('discord.js') as {
    Client: new (opts: unknown) => MockDiscordClient;
  };
  return new Client({});
}

describe('DiscordBotClientService.isGuildMember (ROK-403)', () => {
  let service: DiscordBotClientService;

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
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await service.disconnect();
  });

  it('should return false when client is not connected (no client)', async () => {
    const result = await service.isGuildMember('123456789');

    expect(result).toBe(false);
  });

  it('should return false when client is not ready', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(false);
    setClient(service, client);

    const result = await service.isGuildMember('123456789');

    expect(result).toBe(false);
  });

  it('should return false when no guild is cached', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);
    client.guilds.cache.first = jest.fn().mockReturnValue(null);
    setClient(service, client);

    const result = await service.isGuildMember('123456789');

    expect(result).toBe(false);
  });

  it('should return true when member is found in the guild', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);

    const mockMember = { user: { id: '123456789' } };
    const mockGuild = {
      members: {
        fetch: jest.fn().mockResolvedValue(mockMember),
      },
    };
    client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
    setClient(service, client);

    const result = await service.isGuildMember('123456789');

    expect(result).toBe(true);
    expect(mockGuild.members.fetch).toHaveBeenCalledWith('123456789');
  });

  it('should return false when member is not in the guild (fetch throws)', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);

    const mockGuild = {
      members: {
        fetch: jest.fn().mockRejectedValue(new Error('Unknown Member')),
      },
    };
    client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
    setClient(service, client);

    const result = await service.isGuildMember('999999999');

    expect(result).toBe(false);
  });

  it('should return false when members.fetch throws DiscordAPIError (not a member)', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);

    const discordApiError = Object.assign(new Error('Unknown Member'), { code: 10007 });
    const mockGuild = {
      members: {
        fetch: jest.fn().mockRejectedValue(discordApiError),
      },
    };
    client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
    setClient(service, client);

    const result = await service.isGuildMember('555555555');

    expect(result).toBe(false);
  });

  it('should pass the exact discordUserId to guild.members.fetch', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);

    const expectedId = '987654321098765432';
    const mockMember = { user: { id: expectedId } };
    const mockGuild = {
      members: {
        fetch: jest.fn().mockResolvedValue(mockMember),
      },
    };
    client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
    setClient(service, client);

    await service.isGuildMember(expectedId);

    expect(mockGuild.members.fetch).toHaveBeenCalledWith(expectedId);
  });

  it('should return true for a truthy member object (even with minimal shape)', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);

    // fetch returns some truthy object (member)
    const mockGuild = {
      members: {
        fetch: jest.fn().mockResolvedValue({ id: '111', user: { id: '111' } }),
      },
    };
    client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
    setClient(service, client);

    const result = await service.isGuildMember('111');

    expect(result).toBe(true);
  });
});
