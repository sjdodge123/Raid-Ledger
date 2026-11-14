import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import { DiscordConnectError } from './discord-bot-client.login.helpers';
import { connectWithRetry } from './discord-bot.autoconnect.helpers';

/** ROK-2198 AC4: startup auto-connect retries a transient failure, bounded. */

const logger = new Logger('autoconnect-spec');

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

/** Let a detached auto-connect chain (mocked delays) run to completion. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function transient(): DiscordConnectError {
  return new DiscordConnectError(
    'Failed to connect with provided token',
    false,
  );
}

describe('connectWithRetry', () => {
  it('retries a transient failure, then succeeds', async () => {
    const connect = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce(undefined);
    const delay = jest.fn<Promise<void>, [number]>().mockResolvedValue();

    await expect(
      connectWithRetry({ connect, shouldRetry: () => true, logger, delay }),
    ).resolves.toBeUndefined();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(delay.mock.calls).toEqual([[2_000]]);
  });

  it('gives up after 3 attempts with exponential backoff', async () => {
    const last = transient();
    const connect = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(last);
    const delay = jest.fn<Promise<void>, [number]>().mockResolvedValue();

    await expect(
      connectWithRetry({ connect, shouldRetry: () => true, logger, delay }),
    ).rejects.toBe(last);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls).toEqual([[2_000], [4_000]]);
  });

  it.each([
    ['a definitive DiscordConnectError', new DiscordConnectError('bad', true)],
    ['a raw 4004 close', Object.assign(new Error('x'), { code: 4004 })],
    ['a raw 4014 close', Object.assign(new Error('x'), { code: 4014 })],
    [
      'a raw TokenInvalid',
      Object.assign(new Error('x'), { code: 'TokenInvalid' }),
    ],
    [
      'a raw DisallowedIntents',
      Object.assign(new Error('x'), { code: 'DisallowedIntents' }),
    ],
  ])('does not retry %s', async (_label, error) => {
    const connect = jest.fn<Promise<void>, []>().mockRejectedValue(error);
    const delay = jest.fn<Promise<void>, [number]>().mockResolvedValue();

    await expect(
      connectWithRetry({ connect, shouldRetry: () => true, logger, delay }),
    ).rejects.toBe(error);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('stops when another connect took over during the backoff', async () => {
    const connect = jest.fn<Promise<void>, []>().mockRejectedValue(transient());
    const delay = jest.fn<Promise<void>, [number]>().mockResolvedValue();

    await expect(
      connectWithRetry({ connect, shouldRetry: () => false, logger, delay }),
    ).resolves.toBeUndefined();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledTimes(1);
  });
});

const connect = jest.fn<Promise<void>, [string]>();

async function buildService(): Promise<DiscordBotService> {
  connect.mockReset();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DiscordBotService,
      {
        provide: DiscordBotClientService,
        useValue: {
          connect,
          isConnected: jest.fn().mockReturnValue(false),
          isConnecting: jest.fn().mockReturnValue(false),
          disconnect: jest.fn().mockResolvedValue(undefined),
        },
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
  const service = module.get(DiscordBotService);
  service.autoConnectDelay = () => Promise.resolve();
  return service;
}

describe('DiscordBotService.onApplicationBootstrap — auto-connect retry', () => {
  let service: DiscordBotService;

  beforeEach(async () => {
    service = await buildService();
  });

  it('reconnects after a transient first-login failure', async () => {
    connect.mockRejectedValueOnce(transient()).mockResolvedValueOnce();

    await service.onApplicationBootstrap();
    await flush();

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('does not retry an invalid token', async () => {
    connect.mockRejectedValue(
      new DiscordConnectError('Invalid bot token', true),
    );

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    await flush();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('does not wait for the retry chain before returning', async () => {
    connect.mockReturnValue(new Promise<void>(() => {}));

    const outcome = await Promise.race([
      service.onApplicationBootstrap().then(() => 'returned'),
      flush().then(() => 'blocked on the retry chain'),
    ]);

    expect(outcome).toBe('returned');
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('DiscordBotService auto-connect — cancelled during the backoff', () => {
  let service: DiscordBotService;
  let release: () => void = () => {};

  beforeEach(async () => {
    service = await buildService();
    const backoff = new Promise<void>((resolve) => (release = resolve));
    service.autoConnectDelay = () => backoff;
    connect.mockRejectedValueOnce(transient()).mockResolvedValue();
    await service.onApplicationBootstrap();
    await flush();
    expect(connect.mock.calls).toEqual([['tok']]);
  });

  it('an admin disable stops further connects', async () => {
    await service.handleConfigUpdate({ token: 'tok', enabled: false });
    release();
    await flush();

    expect(connect.mock.calls).toEqual([['tok']]);
  });

  it('a token change never reconnects with the old token', async () => {
    await service.handleConfigUpdate({ token: 'new', enabled: true });
    release();
    await flush();

    expect(connect.mock.calls).toEqual([['tok'], ['new']]);
  });

  it('an admin reconnect (ensureConnected) takes over', async () => {
    await service.ensureConnected({ token: 'admin', enabled: true });
    release();
    await flush();

    expect(connect.mock.calls).toEqual([['tok'], ['admin']]);
  });

  it('shutdown stops further connects', async () => {
    await service.onModuleDestroy();
    release();
    await flush();

    expect(connect.mock.calls).toEqual([['tok']]);
  });
});
