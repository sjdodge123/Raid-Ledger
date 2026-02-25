import { Test, TestingModule } from '@nestjs/testing';
import { RelayService } from './relay.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { CronJobService } from '../cron-jobs/cron-job.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('RelayService', () => {
  let service: RelayService;
  let mockSettingsService: Partial<SettingsService>;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockSettingsService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockResolvedValue([{ count: 0 }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelayService,
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: DrizzleAsyncProvider, useValue: mockDb },
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

  describe('isConnected', () => {
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
  });

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

      expect(result.enabled).toBe(true);
      expect(result.connected).toBe(false);
      expect(result.error).toContain('Could not reach relay');
    });

    it('should store token on successful registration', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ token: 'relay-token-123', instanceId: 'test-id' }),
      });

      const result = await service.register();

      expect(result.connected).toBe(true);
      expect(mockSettingsService.set).toHaveBeenCalledWith(
        SETTING_KEYS.RELAY_TOKEN,
        'relay-token-123',
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
});
