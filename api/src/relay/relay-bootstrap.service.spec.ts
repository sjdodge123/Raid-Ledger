import { Logger } from '@nestjs/common';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import type { SettingsService } from '../settings/settings.service';
import type { CronJobService } from '../cron-jobs/cron-job.service';
import { RelayService } from './relay.service';
import {
  MAX_BOOTSTRAP_ATTEMPTS,
  RelayBootstrapService,
} from './relay-bootstrap.service';

const HUB = 'http://192.168.0.10:3600';
const REGISTER_URL = `${HUB}/api/v1/instances/register`;
const REGISTERED = {
  token: 'rlh_abc',
  instanceId: '7f8c2d1e-4b5a-4c3d-9e8f-1a2b3c4d5e6f',
  trustTier: 'reader',
  schemaVersion: 1,
  epoch: 'e1',
};

let store: Map<string, string>;
let settings: SettingsService;
let relay: RelayService;
let bootstrap: RelayBootstrapService;
let fetchSpy: jest.SpyInstance;
const savedEnv = process.env.RELAY_HUB_URL;

function makeSettings(): SettingsService {
  const fake = {
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    delete: jest.fn((k: string) => Promise.resolve(void store.delete(k))),
  };
  return fake as unknown as SettingsService;
}

/** Let every pending promise chain (settings reads, fetch, writes) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

function registerCalls(): unknown[][] {
  return fetchSpy.mock.calls.filter(([url]) => url === REGISTER_URL);
}

beforeEach(() => {
  process.env.RELAY_HUB_URL = HUB;
  store = new Map();
  settings = makeSettings();
  const cron = {
    executeWithTracking: (_n: string, fn: () => Promise<unknown>) => fn(),
  } as unknown as CronJobService;
  relay = new RelayService(settings, cron);
  bootstrap = new RelayBootstrapService(relay, settings);
  fetchSpy = jest.spyOn(global, 'fetch');
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  jest.spyOn(Logger.prototype, 'log').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
  if (savedEnv === undefined) delete process.env.RELAY_HUB_URL;
  else process.env.RELAY_HUB_URL = savedEnv;
});

describe('RelayBootstrapService — boot registration (AC 2)', () => {
  it('registers exactly once with the contract body when RELAY_HUB_URL is set and no token', async () => {
    fetchSpy.mockResolvedValue(Response.json(REGISTERED, { status: 201 }));
    bootstrap.onApplicationBootstrap();
    await settle();
    expect(registerCalls()).toHaveLength(1);
    const init = registerCalls()[0]?.[1] as RequestInit | undefined;
    if (typeof init?.body !== 'string') throw new Error('no body');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'instanceId',
      'schemaVersion',
      'version',
    ]);
    expect(body.schemaVersion).toBe(1);
    expect(store.get(SETTING_KEYS.RELAY_ENABLED)).toBe('true');
  });

  it.each([
    ['RELAY_HUB_URL is unset', () => delete process.env.RELAY_HUB_URL],
    ['RELAY_HUB_URL is invalid', () => (process.env.RELAY_HUB_URL = 'ftp://x')],
    [
      "relay_enabled is 'false'",
      () => store.set(SETTING_KEYS.RELAY_ENABLED, 'false'),
    ],
    ['a token exists', () => store.set(SETTING_KEYS.RELAY_TOKEN, 'rlh_x')],
  ])('makes no call when %s', async (_l, arrange) => {
    arrange();
    fetchSpy.mockResolvedValue(Response.json(REGISTERED, { status: 201 }));
    bootstrap.onApplicationBootstrap();
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('RelayBootstrapService — retry on the hourly tick (AC 4)', () => {
  it('retries a failed boot registration on the next heartbeat tick', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('down', { status: 503 }));
    bootstrap.onApplicationBootstrap();
    await settle();
    expect(store.has(SETTING_KEYS.RELAY_ENABLED)).toBe(false);
    fetchSpy.mockResolvedValueOnce(Response.json(REGISTERED, { status: 201 }));
    await relay.handleHeartbeat();
    expect(registerCalls()).toHaveLength(2);
    expect(store.get(SETTING_KEYS.RELAY_ENABLED)).toBe('true');
  });

  it(`stops after ${MAX_BOOTSTRAP_ATTEMPTS} attempts per process`, async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response('down', { status: 503 })),
    );
    bootstrap.onApplicationBootstrap();
    await settle();
    for (let i = 0; i < MAX_BOOTSTRAP_ATTEMPTS + 5; i++) {
      await relay.handleHeartbeat();
    }
    expect(MAX_BOOTSTRAP_ATTEMPTS).toBe(24);
    expect(registerCalls()).toHaveLength(24);
  });
});

describe('RelayBootstrapService — boot never waits (AC 5)', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => void rejections.push(reason);
  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => process.off('unhandledRejection', onRejection));

  it('returns at once while the hub never answers', async () => {
    fetchSpy.mockReturnValue(new Promise<Response>(() => undefined));
    const outcome = await Promise.race([
      Promise.resolve(bootstrap.onApplicationBootstrap()).then(() => 'done'),
      new Promise((r) => setImmediate(() => r('blocked'))),
    ]);
    expect(outcome).toBe('done');
  });

  it.each([
    ['fetch rejects', () => fetchSpy.mockRejectedValue(new Error('down'))],
    [
      'the settings read rejects',
      () => (settings.get as jest.Mock).mockRejectedValue(new Error('db')),
    ],
  ])('nothing escapes when %s', async (_l, arrange) => {
    arrange();
    expect(() => bootstrap.onApplicationBootstrap()).not.toThrow();
    await settle();
    expect(rejections).toEqual([]);
  });
});
