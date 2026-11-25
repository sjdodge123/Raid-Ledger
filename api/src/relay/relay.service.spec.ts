import { Test, TestingModule } from '@nestjs/testing';
import { RelayService } from './relay.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { CronJobService } from '../cron-jobs/cron-job.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

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
        json: () =>
          Promise.resolve({
            token: 'rlh_token-123',
            instanceId: '7f8c2d1e-4b5a-4c3d-9e8f-1a2b3c4d5e6f',
            trustTier: 'contributor',
            schemaVersion: 1,
            epoch: 'e1',
          }),
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
}
describe('RelayService', () => describeRelayService());
