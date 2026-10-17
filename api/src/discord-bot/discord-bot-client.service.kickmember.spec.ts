import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventEmitter } from 'events';
import { Client } from 'discord.js';
import { DiscordBotClientService } from './discord-bot-client.service';

/** Typed interface for the mock Discord.js Client used in these tests. */
interface MockDiscordClient extends EventEmitter {
  user: { tag: string } | null;
  guilds: { cache: Map<string, unknown> & { first: jest.Mock } };
  users: { fetch: jest.Mock };
  login: jest.Mock;
  destroy: jest.Mock;
  isReady: jest.Mock;
}

// Access the private `client` field without `as any`.
function setClient(
  service: DiscordBotClientService,
  client: MockDiscordClient | null,
): void {
  (service as unknown as { client: MockDiscordClient | null }).client = client;
}

jest.mock('discord.js', () => {
  class MockClient extends EventEmitter {
    user: { tag: string } | null = null;
    guilds = { cache: new Map() };
    users = { fetch: jest.fn() };
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
      GuildScheduledEvents: 256,
    },
    Partials: { Channel: 0 },
    Events: { ClientReady: 'clientReady', Error: 'error' },
    PermissionsBitField: {
      Flags: { ManageRoles: BigInt(1), KickMembers: BigInt(2) },
    },
    ChannelType: { GuildCategory: 4 },
  };
});

function createMockClient(): MockDiscordClient {
  return new (Client as unknown as new (opts: unknown) => MockDiscordClient)(
    {},
  );
}

function createMockGuild(fetchBehavior: jest.Mock) {
  return { members: { fetch: fetchBehavior } };
}

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

describe('kickMember — bot not ready / no guild (ROK-313)', () => {
  it('returns false when there is no client', async () => {
    expect(await service.kickMember('123')).toBe(false);
  });

  it('returns false when the client is not ready', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(false);
    setClient(service, client);

    expect(await service.kickMember('123')).toBe(false);
  });

  it('returns false when no guild is cached', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);
    client.guilds.cache.first = jest.fn().mockReturnValue(null);
    setClient(service, client);

    expect(await service.kickMember('123')).toBe(false);
  });
});

describe('kickMember — member kicked (ROK-313)', () => {
  it('kicks the member and returns true, forwarding the reason', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);
    const kick = jest.fn().mockResolvedValue(undefined);
    const mockGuild = createMockGuild(jest.fn().mockResolvedValue({ kick }));
    client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
    setClient(service, client);

    const result = await service.kickMember('123456789', 'ban cleanup');

    expect(result).toBe(true);
    expect(mockGuild.members.fetch).toHaveBeenCalledWith('123456789');
    expect(kick).toHaveBeenCalledWith('ban cleanup');
  });

  it('defaults the audit reason when none is supplied', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);
    const kick = jest.fn().mockResolvedValue(undefined);
    const mockGuild = createMockGuild(jest.fn().mockResolvedValue({ kick }));
    client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
    setClient(service, client);

    await service.kickMember('123456789');

    expect(kick).toHaveBeenCalledWith('Removed by admin via Raid Ledger');
  });
});

describe('kickMember — failure paths (ROK-313)', () => {
  it('returns false when members.fetch throws (not a member / bad id)', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);
    const mockGuild = createMockGuild(
      jest.fn().mockRejectedValue(new Error('Unknown Member')),
    );
    client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
    setClient(service, client);

    expect(await service.kickMember('999999999')).toBe(false);
  });

  it('returns false when member.kick throws (missing permission)', async () => {
    const client = createMockClient();
    client.isReady.mockReturnValue(true);
    const kick = jest.fn().mockRejectedValue(new Error('Missing Permissions'));
    const mockGuild = createMockGuild(jest.fn().mockResolvedValue({ kick }));
    client.guilds.cache.first = jest.fn().mockReturnValue(mockGuild);
    setClient(service, client);

    expect(await service.kickMember('123456789')).toBe(false);
  });
});
