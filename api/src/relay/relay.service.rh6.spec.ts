/**
 * ROK-1676 (RH-6) — RelayService as an M1 hub client: hub URL precedence,
 * register ordering and parsing, trust tier, heartbeat 401 and failures.
 */
import { Logger } from '@nestjs/common';
import { RelayService } from './relay.service';
import { RelayBootstrapService } from './relay-bootstrap.service';
import type { SettingsService } from '../settings/settings.service';
import type { CronJobService } from '../cron-jobs/cron-job.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const INSTANCE_ID = '7f8c2d1e-4b5a-4c3d-9e8f-1a2b3c4d5e6f';
const REGISTERED = {
  token: 'rlh_abc',
  instanceId: INSTANCE_ID,
  trustTier: 'contributor',
  schemaVersion: 1,
  epoch: 'e1',
};
const HEARTBEAT_OK = {
  schemaVersion: 1,
  epoch: 'e1',
  serverTime: '2026-11-25T00:00:00.000Z',
};

/** A fetch Response stand-in with a JSON body. */
function reply(status: number, body: unknown = {}): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

/** The JSON body of the n-th fetch call. */
function sentBody(n = 0): Record<string, unknown> {
  const init = mockFetch.mock.calls[n]?.[1] as RequestInit | undefined;
  if (typeof init?.body !== 'string') throw new Error('no string body sent');
  return JSON.parse(init.body) as Record<string, unknown>;
}

let service: RelayService;
let mockSettingsService: Partial<SettingsService>;
/** In-memory app_settings: get/set/delete read and write it. */
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  mockSettingsService = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
  const cron = {
    executeWithTracking: (_n: string, fn: () => Promise<unknown>) => fn(),
  } as unknown as CronJobService;
  service = new RelayService(mockSettingsService as SettingsService, cron);
  mockFetch.mockReset();
});

const savedEnv = {
  APP_VERSION: process.env.APP_VERSION,
  RELAY_HUB_URL: process.env.RELAY_HUB_URL,
};

/** Restore env vars and Logger spies even when an assertion failed. */
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.restoreAllMocks();
});

function enabledFlagWrites(): unknown[][] {
  return (mockSettingsService.set as jest.Mock).mock.calls.filter(
    ([key]) => key === SETTING_KEYS.RELAY_ENABLED,
  );
}

function describeRelayHubUrl() {
  describe('hub URL (AC 1)', () => {
    it('RELAY_HUB_URL wins over the relay_url setting for status and calls', async () => {
      process.env.RELAY_HUB_URL = 'http://192.168.0.10:3600/';
      store.set(SETTING_KEYS.RELAY_URL, 'https://other.example.com');
      mockFetch.mockResolvedValue(reply(201, REGISTERED));

      expect((await service.getStatus()).relayUrl).toBe(
        'http://192.168.0.10:3600',
      );
      await service.register();
      expect(mockFetch.mock.calls[0]?.[0]).toBe(
        'http://192.168.0.10:3600/api/v1/instances/register',
      );
    });

    it('uses the setting when the env is unset', async () => {
      delete process.env.RELAY_HUB_URL;
      store.set(SETTING_KEYS.RELAY_URL, 'https://other.example.com');
      expect((await service.getStatus()).relayUrl).toBe(
        'https://other.example.com',
      );
    });

    it('ignores an invalid env value with exactly one warn', async () => {
      process.env.RELAY_HUB_URL = 'ftp://nope';
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await service.getStatus();
      const status = await service.getStatus();
      expect(status.relayUrl).toBe('https://hub.raid-ledger.com');
      const envWarns = warn.mock.calls.filter(([m]) =>
        String(m).includes('RELAY_HUB_URL'),
      );
      expect(envWarns).toHaveLength(1);
    });
  });
}

function describeRegisterRh6() {
  describe('register (RH-6)', () => {
    it('stores the token, THEN writes relay_enabled=true (AC 3)', async () => {
      mockFetch.mockResolvedValue(reply(201, REGISTERED));
      await service.register();
      const keys = (mockSettingsService.set as jest.Mock).mock.calls
        .map(([key]) => key as string)
        .filter((k) => k !== SETTING_KEYS.RELAY_INSTANCE_ID);
      expect(keys).toEqual([
        SETTING_KEYS.RELAY_TOKEN,
        SETTING_KEYS.RELAY_ENABLED,
      ]);
      expect(store.get(SETTING_KEYS.RELAY_ENABLED)).toBe('true');
    });

    it.each([
      ['a non-2xx', () => mockFetch.mockResolvedValue(reply(503))],
      [
        'a network error',
        () => mockFetch.mockRejectedValue(new Error('fetch failed')),
      ],
      [
        'a timeout',
        () =>
          mockFetch.mockRejectedValue(
            new DOMException('timed out', 'TimeoutError'),
          ),
      ],
      [
        'a malformed body',
        () => mockFetch.mockResolvedValue(reply(200, { token: 'x' })),
      ],
    ])('leaves relay_enabled untouched on %s (AC 4)', async (_l, arrange) => {
      arrange();
      const status = await service.register();
      expect(status.connected).toBe(false);
      expect(enabledFlagWrites()).toEqual([]);
    });

    it('a malformed 2xx stores no token and does not throw (AC 8)', async () => {
      mockFetch.mockResolvedValue(
        reply(200, { ...REGISTERED, token: 'no-prefix' }),
      );
      const status = await service.register();
      expect(status.error).toContain('malformed');
      expect(store.has(SETTING_KEYS.RELAY_TOKEN)).toBe(false);
      expect(enabledFlagWrites()).toEqual([]);
    });
  });
}

function describeRegisterResultRh6() {
  describe('register result (RH-6)', () => {
    it('sends APP_VERSION as the version (AC 7)', async () => {
      process.env.APP_VERSION = 'v3.1.4';
      mockFetch.mockResolvedValue(reply(201, REGISTERED));
      await service.register();
      expect(sentBody().version).toBe('3.1.4');
    });

    it.each([
      ['reader', true],
      ['contributor', false],
    ])('trustTier %s → pendingApproval %p (AC 9)', async (tier, pending) => {
      mockFetch.mockResolvedValue(
        reply(201, { ...REGISTERED, trustTier: tier }),
      );
      await service.register();
      expect(await service.getStatus()).toMatchObject({
        connected: true,
        trustTier: tier,
        pendingApproval: pending,
      });
    });
  });
}

function describeHeartbeatRh6() {
  describe('heartbeat (RH-6)', () => {
    beforeEach(() => {
      store.set(SETTING_KEYS.RELAY_ENABLED, 'true');
      store.set(SETTING_KEYS.RELAY_TOKEN, 'rlh_abc');
      store.set(SETTING_KEYS.RELAY_INSTANCE_ID, INSTANCE_ID);
    });

    it('sends exactly schemaVersion and version (AC 6)', async () => {
      mockFetch.mockResolvedValue(reply(200, HEARTBEAT_OK));
      await service.handleHeartbeat();
      expect(Object.keys(sentBody()).sort()).toEqual([
        'schemaVersion',
        'version',
      ]);
    });

    it('a 401 deletes the token, reports revoked, never re-registers (AC 10)', async () => {
      process.env.RELAY_HUB_URL = 'http://192.168.0.10:3600';
      const bootstrap = new RelayBootstrapService(
        service,
        mockSettingsService as SettingsService,
      );
      bootstrap.onApplicationBootstrap(); // token present → no call
      mockFetch.mockResolvedValue(reply(401));
      await service.handleHeartbeat();
      await service.handleHeartbeat(); // next tick: not connected
      await bootstrap.run();
      expect(store.has(SETTING_KEYS.RELAY_TOKEN)).toBe(false);
      expect((await service.getStatus()).error).toBe('revoked');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('warns once at the third consecutive failure; 1-2 stay debug (AC 11)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
      mockFetch.mockResolvedValue(reply(503));
      await service.handleHeartbeat();
      await service.handleHeartbeat();
      expect(warn).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledTimes(2);
      await service.handleHeartbeat();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('a success resets the failure counter (AC 11)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      mockFetch.mockResolvedValueOnce(reply(503));
      mockFetch.mockResolvedValueOnce(reply(503));
      mockFetch.mockResolvedValueOnce(reply(200, HEARTBEAT_OK));
      mockFetch.mockResolvedValue(reply(503));
      for (let i = 0; i < 5; i++) await service.handleHeartbeat();
      expect(warn).not.toHaveBeenCalled();
    });
  });
}

describeRelayHubUrl();
describeRegisterRh6();
describeRegisterResultRh6();
describeHeartbeatRh6();
