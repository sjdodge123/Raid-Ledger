import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RelayService } from './relay.service';
import { RelayBootstrapService } from './relay-bootstrap.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { CronJobService } from '../cron-jobs/cron-job.service';

// Mock global fetch
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

function describeRelayService() {
  let service: RelayService;
  let mockSettingsService: Partial<SettingsService>;
  /** In-memory app_settings: get/set/delete read and write it. */
  let store: Map<string, string>;

  beforeEach(async () => {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelayService,
        { provide: SettingsService, useValue: mockSettingsService },
        {
          provide: CronJobService,
          useValue: {
            executeWithTracking: jest.fn(
              (_name: string, fn: () => Promise<void>) => fn(),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<RelayService>(RelayService);
    mockFetch.mockReset();
  });

  function describeIsConnected() {
    it('should return false when relay is disabled', async () => {
      (mockSettingsService.get as jest.Mock).mockResolvedValue(null);

      const result = await service.isConnected();

      expect(result).toBe(false);
    });

    it('should return false when enabled but no token', async () => {
      (mockSettingsService.get as jest.Mock).mockImplementation(
        (key: string) => {
          if (key === SETTING_KEYS.RELAY_ENABLED)
            return Promise.resolve('true');
          return Promise.resolve(null);
        },
      );

      const result = await service.isConnected();

      expect(result).toBe(false);
    });

    it('should return true when enabled and has token', async () => {
      (mockSettingsService.get as jest.Mock).mockImplementation(
        (key: string) => {
          if (key === SETTING_KEYS.RELAY_ENABLED)
            return Promise.resolve('true');
          if (key === SETTING_KEYS.RELAY_TOKEN)
            return Promise.resolve('some-token');
          return Promise.resolve(null);
        },
      );

      const result = await service.isConnected();

      expect(result).toBe(true);
    });
  }
  describe('isConnected', () => describeIsConnected());

  describe('getStatus', () => {
    it('should return disabled status by default', async () => {
      const status = await service.getStatus();

      expect(status.enabled).toBe(false);
      expect(status.connected).toBe(false);
      expect(status.relayUrl).toBe('https://hub.raid-ledger.com');
    });
  });

  describe('disconnect', () => {
    it('should clear token and disable relay', async () => {
      await service.disconnect();

      expect(mockSettingsService.set).toHaveBeenCalledWith(
        SETTING_KEYS.RELAY_ENABLED,
        'false',
      );
      expect(mockSettingsService.delete).toHaveBeenCalledWith(
        SETTING_KEYS.RELAY_TOKEN,
      );
    });
  });

  describe('register', () => {
    it('should handle relay unreachable gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('fetch failed'));

      const result = await service.register();

      // ROK-1676 AC 4: a failed register no longer flips relay_enabled, so
      // the status reports the real (unset) flag instead of `true`.
      expect(result.enabled).toBe(false);
      expect(result.connected).toBe(false);
      expect(result.error).toContain('Could not reach relay');
    });

    it('should store token on successful registration', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ ...REGISTERED, token: 'rlh_token-123' }),
      });

      const result = await service.register();

      expect(result.connected).toBe(true);
      expect(mockSettingsService.set).toHaveBeenCalledWith(
        SETTING_KEYS.RELAY_TOKEN,
        'rlh_token-123',
      );
    });
  });

  describe('handleHeartbeat', () => {
    it('should no-op when not connected', async () => {
      (mockSettingsService.get as jest.Mock).mockResolvedValue(null);

      await service.handleHeartbeat();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describeRelayHubUrl();
  describeRegisterRh6();
  describeHeartbeatRh6();

  // ─── ROK-1676 (RH-6) ──────────────────────────────────────────

  function enabledFlagWrites(): unknown[][] {
    return (mockSettingsService.set as jest.Mock).mock.calls.filter(
      ([key]) => key === SETTING_KEYS.RELAY_ENABLED,
    );
  }

  function describeRelayHubUrl() {
    describe('hub URL (AC 1)', () => {
      const saved = process.env.RELAY_HUB_URL;
      afterEach(() => {
        if (saved === undefined) delete process.env.RELAY_HUB_URL;
        else process.env.RELAY_HUB_URL = saved;
      });

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
        warn.mockRestore();
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

      it('sends APP_VERSION as the version (AC 7)', async () => {
        const saved = process.env.APP_VERSION;
        process.env.APP_VERSION = 'v3.1.4';
        mockFetch.mockResolvedValue(reply(201, REGISTERED));
        await service.register();
        expect(sentBody().version).toBe('3.1.4');
        if (saved === undefined) delete process.env.APP_VERSION;
        else process.env.APP_VERSION = saved;
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
        const saved = process.env.RELAY_HUB_URL;
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
        if (saved === undefined) delete process.env.RELAY_HUB_URL;
        else process.env.RELAY_HUB_URL = saved;
      });

      it('warns once at the third consecutive failure; 1-2 stay debug (AC 11)', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        const debug = jest
          .spyOn(Logger.prototype, 'debug')
          .mockImplementation();
        mockFetch.mockResolvedValue(reply(503));
        await service.handleHeartbeat();
        await service.handleHeartbeat();
        expect(warn).not.toHaveBeenCalled();
        expect(debug).toHaveBeenCalledTimes(2);
        await service.handleHeartbeat();
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
        debug.mockRestore();
      });

      it('a success resets the failure counter (AC 11)', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        mockFetch.mockResolvedValueOnce(reply(503));
        mockFetch.mockResolvedValueOnce(reply(503));
        mockFetch.mockResolvedValueOnce(reply(200, HEARTBEAT_OK));
        mockFetch.mockResolvedValue(reply(503));
        for (let i = 0; i < 5; i++) await service.handleHeartbeat();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
      });
    });
  }
}
describe('RelayService', () => describeRelayService());
