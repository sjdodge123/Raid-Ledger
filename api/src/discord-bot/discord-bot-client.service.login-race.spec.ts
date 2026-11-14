import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventEmitter } from 'events';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from './discord-bot.constants';
import {
  ABANDONED_SESSION_MESSAGE,
  DiscordConnectError,
} from './discord-bot-client.login.helpers';
import { Events } from 'discord.js';

/**
 * ROK-2198: the prod zombie — a failed first login left discord.js retrying
 * on a client the service had forgotten; it turned ready 2 s later, logged
 * "connected", emitted CONNECTED, yet getClient() was null for 6 h.
 */

interface MockDiscordClient extends EventEmitter {
  user: { tag: string } | null;
  guilds: { cache: Map<string, unknown> };
  login: jest.Mock;
  destroy: jest.Mock;
  isReady: jest.Mock;
}

let mockLoginImpl: () => Promise<void> = () => Promise.resolve();

function getClient(service: DiscordBotClientService): MockDiscordClient | null {
  return (service as unknown as { client: MockDiscordClient | null }).client;
}

function mustClient(service: DiscordBotClientService): MockDiscordClient {
  const client = getClient(service);
  if (!client) throw new Error('expected a live client');
  return client;
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

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

    login = jest.fn(() => mockLoginImpl());
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
    Events: {
      ClientReady: 'clientReady',
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

const TOKEN = 'secret-bot-token.abc.def';

let service: DiscordBotClientService;
let eventEmitter: EventEmitter2;
let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let debugSpy: jest.SpyInstance;

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
  service = module.get(DiscordBotClientService);
  eventEmitter = module.get(EventEmitter2);
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  mockLoginImpl = () => Promise.resolve();
});

afterEach(async () => {
  await service.disconnect();
  jest.restoreAllMocks();
});

function transientError(): Error {
  return Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
}

function abandonedErrors(): number {
  return errorSpy.mock.calls.filter(
    (args: unknown[]) => args[0] === ABANDONED_SESSION_MESSAGE,
  ).length;
}

function connectedLogged(): boolean {
  return logSpy.mock.calls.some((args: unknown[]) =>
    String(args[0]).includes('connected as'),
  );
}

describe('ROK-2198 — a failed login destroys its client (AC1)', () => {
  it('destroys the client and clears the live state', async () => {
    mockLoginImpl = () => Promise.reject(transientError());
    const connecting = service.connect(TOKEN);
    const client = mustClient(service);

    await expect(connecting).rejects.toThrow(DiscordConnectError);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(getClient(service)).toBeNull();
    expect(service.isConnecting()).toBe(false);
  });

  it('still rejects with the login failure when destroy throws', async () => {
    mockLoginImpl = () => Promise.reject(transientError());
    const connecting = service.connect(TOKEN);
    mustClient(service).destroy.mockImplementation(() => {
      throw new Error('destroy blew up');
    });

    await expect(connecting).rejects.toThrow(
      'Failed to connect with provided token',
    );
  });

  it('leaves a newer live client alone when an old login fails late', async () => {
    let failOld: (err: Error) => void = () => {};
    mockLoginImpl = () =>
      new Promise<void>((_resolve, reject) => {
        failOld = reject;
      });
    const first = service.connect(TOKEN);
    first.catch(() => {});
    const oldClient = mustClient(service);
    mockLoginImpl = () => new Promise<void>(() => {});
    void service.connect(TOKEN).catch(() => {});
    await flush();
    const newClient = mustClient(service);
    expect(newClient).not.toBe(oldClient);

    failOld(transientError());
    await expect(first).rejects.toThrow(DiscordConnectError);
    expect(getClient(service)).toBe(newClient);
    expect(service.isConnecting()).toBe(true);
  });
});

describe('ROK-2198 — stale-client events are discarded (AC2)', () => {
  it('replays the prod incident: ready after a failed login is not adopted', async () => {
    mockLoginImpl = () => Promise.reject(transientError());
    const connecting = service.connect(TOKEN);
    const zombie = mustClient(service);
    await expect(connecting).rejects.toThrow(DiscordConnectError);
    zombie.destroy.mockClear();

    zombie.user = { tag: 'Zombie#0001' };
    zombie.emit(Events.ClientReady);
    await flush();

    expect(connectedLogged()).toBe(false);
    expect(eventEmitter.emitAsync).not.toHaveBeenCalledWith(
      DISCORD_BOT_EVENTS.CONNECTED,
    );
    expect(zombie.destroy).toHaveBeenCalledTimes(1);
    expect(getClient(service)).toBeNull();
    expect(abandonedErrors()).toBe(1);
  });

  it('logs an error trailing our own failed login at debug, not warn', async () => {
    mockLoginImpl = () => Promise.reject(transientError());
    const connecting = service.connect(TOKEN);
    const client = mustClient(service);
    await expect(connecting).rejects.toThrow(DiscordConnectError);
    warnSpy.mockClear();

    client.emit(Events.Error, new Error('trailing'));
    await flush();

    const stale = (spy: jest.SpyInstance): boolean =>
      spy.mock.calls.some((args: unknown[]) =>
        String(args[0]).includes('Discarded stale Discord client'),
      );
    expect(stale(debugSpy)).toBe(true);
    expect(stale(warnSpy)).toBe(false);
    expect(abandonedErrors()).toBe(0);
  });

  it('ignores ready and error from a client a newer connect replaced', async () => {
    mockLoginImpl = () => new Promise<void>(() => {});
    const first = service.connect(TOKEN);
    first.catch(() => {});
    const oldClient = mustClient(service);
    void service.connect(TOKEN).catch(() => {});
    await flush();
    const newClient = mustClient(service);
    oldClient.destroy.mockClear();

    oldClient.emit(Events.Error, new Error('boom'));
    oldClient.emit(Events.ClientReady);
    await flush();

    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      DISCORD_BOT_EVENTS.ERROR,
      expect.anything(),
    );
    expect(connectedLogged()).toBe(false);
    expect(oldClient.destroy).toHaveBeenCalled();
    expect(abandonedErrors()).toBe(1);
    expect(getClient(service)).toBe(newClient);
    expect(service.isConnecting()).toBe(true);
  });
});

describe('ROK-2198 — the raw login error is logged (AC3)', () => {
  it('logs name, code and message beside the friendly text, never the token', async () => {
    mockLoginImpl = () =>
      Promise.reject(
        Object.assign(new Error(`handshake failed for ${TOKEN}`), {
          code: 'ECONNRESET',
        }),
      );
    await expect(service.connect(TOKEN)).rejects.toThrow(DiscordConnectError);

    const logged = errorSpy.mock.calls.map((args: unknown[]) =>
      args.map(String).join(' '),
    );
    const raw = logged.find((line) => line.includes('login error (raw)'));
    expect(raw).toContain('name=Error');
    expect(raw).toContain('code=ECONNRESET');
    expect(raw).toContain('handshake failed for [redacted]');
    expect(logged.join('\n')).not.toContain(TOKEN);
    expect(logged.some((l) => l.includes('Failed to connect'))).toBe(true);
  });

  it('marks an invalid-token login failure as definitive', async () => {
    mockLoginImpl = () =>
      Promise.reject(
        Object.assign(new Error('An invalid token was provided.'), {
          code: 'TokenInvalid',
        }),
      );
    await expect(service.connect(TOKEN)).rejects.toMatchObject({
      definitive: true,
    });
  });
});
