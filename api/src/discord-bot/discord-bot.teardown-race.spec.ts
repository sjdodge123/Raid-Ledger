import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter } from 'events';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';

/**
 * ROK-2198 (Codex P2): a startup retry that already entered connect() and is
 * awaiting the timed-out client's teardown must not build a client with its
 * captured token once an admin disable, token change or shutdown took over.
 */

interface MockDiscordClient extends EventEmitter {
  login: jest.Mock;
  destroy: jest.Mock;
  isReady: jest.Mock;
}

const mockClients: MockDiscordClient[] = [];

jest.mock('discord.js', () => {
  class MockClient extends EventEmitter {
    user = null;
    guilds = { cache: new Map() };
    login = jest.fn(() => new Promise<void>(() => {}));
    destroy = jest.fn().mockResolvedValue(undefined);
    isReady = jest.fn().mockReturnValue(false);
    constructor() {
      super();
      mockClients.push(this);
    }
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
    PermissionsBitField: { Flags: {} },
  };
});

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

/** Token each created client logged in with, in creation order. */
const loginTokens = (): unknown[] =>
  mockClients.map((client) => client.login.mock.calls[0]?.[0]);

function liveClient(clients: DiscordBotClientService): unknown {
  return clients.getClient();
}

let bot: DiscordBotService;
let clients: DiscordBotClientService;
let releaseTeardown: () => void = () => {};

async function build(): Promise<void> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DiscordBotService,
      DiscordBotClientService,
      {
        provide: EventEmitter2,
        useValue: { emit: jest.fn(), emitAsync: jest.fn() },
      },
      {
        provide: SettingsService,
        useValue: {
          getDiscordBotConfig: jest
            .fn()
            .mockResolvedValue({ token: 'tok', enabled: true }),
        },
      },
    ],
  }).compile();
  bot = module.get(DiscordBotService);
  clients = module.get(DiscordBotClientService);
  bot.autoConnectDelay = () => Promise.resolve();
}

/** Boot, time out attempt 1, and park attempt 2 inside its teardown. */
async function parkRetryInTeardown(): Promise<void> {
  await bot.onApplicationBootstrap();
  await flush();
  const first = must(mockClients[0], 'first client');
  const teardown = new Promise<void>((resolve) => (releaseTeardown = resolve));
  first.destroy.mockReturnValue(teardown);
  jest.advanceTimersByTime(15_000);
  await flush();
  expect(first.destroy).toHaveBeenCalledTimes(1);
  expect(loginTokens()).toEqual(['tok']);
}

beforeEach(async () => {
  mockClients.length = 0;
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(() => {});
  }
  await build();
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  await parkRetryInTeardown();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ROK-2198 — a retry parked in teardown is cancelled', () => {
  it('an admin disable leaves no client behind', async () => {
    const disabled = bot.handleConfigUpdate({ token: 'tok', enabled: false });
    releaseTeardown();
    await disabled;
    await flush();

    expect(loginTokens()).toEqual(['tok']);
    expect(liveClient(clients)).toBeNull();
    expect(clients.isConnecting()).toBe(false);
  });

  it('a token change never builds a client with the old token', async () => {
    void bot.handleConfigUpdate({ token: 'new', enabled: true });
    releaseTeardown();
    await flush();

    expect(loginTokens()).toEqual(['tok', 'new']);
    expect(liveClient(clients)).toBe(mockClients[1]);
  });

  it('shutdown leaves no client behind', async () => {
    const shutdown = bot.onModuleDestroy();
    releaseTeardown();
    await shutdown;
    await flush();

    expect(loginTokens()).toEqual(['tok']);
    expect(liveClient(clients)).toBeNull();
  });
});
