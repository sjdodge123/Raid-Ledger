import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { EnvironmentSnapshotService } from './environment-snapshot.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SETTING_KEYS } from '../drizzle/schema';

jest.mock('@sentry/nestjs', () => ({
  addEventProcessor: jest.fn(),
}));

const mockDb = {
  execute: jest.fn(),
};

const mockSettingsService = {
  isDiscordConfigured: jest.fn().mockResolvedValue(true),
  isDiscordBotConfigured: jest.fn().mockResolvedValue(false),
  isIgdbConfigured: jest.fn().mockResolvedValue(true),
  isBlizzardConfigured: jest.fn().mockResolvedValue(false),
  isGitHubConfigured: jest.fn().mockResolvedValue(false),
  exists: jest.fn().mockResolvedValue(false),
  get: jest.fn().mockResolvedValue(null),
};

describe('EnvironmentSnapshotService', () => {
  let service: EnvironmentSnapshotService;
  let addEventProcessorMock: jest.MockedFunction<
    typeof Sentry.addEventProcessor
  >;

  beforeEach(async () => {
    jest.clearAllMocks();
    addEventProcessorMock = Sentry.addEventProcessor as jest.MockedFunction<
      typeof Sentry.addEventProcessor
    >;

    mockDb.execute.mockResolvedValue([
      { tag: '0063_migration_name', created_at: '2026-02-20T00:00:00Z' },
      { tag: '0062_another_migration', created_at: '2026-02-19T00:00:00Z' },
    ]);

    const module = await Test.createTestingModule({
      providers: [
        EnvironmentSnapshotService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    service = module.get(EnvironmentSnapshotService);
  });

  it('registers a Sentry event processor on module init', () => {
    service.onModuleInit();
    expect(addEventProcessorMock).toHaveBeenCalledTimes(1);
    expect(typeof addEventProcessorMock.mock.calls[0][0]).toBe('function');
  });

  it('returns null snapshot before first collection', () => {
    expect(service.getCachedSnapshot()).toBeNull();
  });

  describe('collectSnapshot', () => {
    it('collects integration status from SettingsService', async () => {
      const snapshot = await service.collectSnapshot();

      expect(snapshot.integrations).toEqual({
        discordOAuth: true,
        discordBot: false,
        igdb: true,
        blizzard: false,
        github: false,
        relay: false,
      });
    });

    it('collects migration history from DB', async () => {
      const snapshot = await service.collectSnapshot();

      expect(snapshot.migrations).toHaveLength(2);
      expect(snapshot.migrations[0]).toEqual({
        tag: '0063_migration_name',
        appliedAt: '2026-02-20T00:00:00Z',
      });
    });

    it('returns empty migrations array on DB error', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('connection refused'));

      const snapshot = await service.collectSnapshot();
      expect(snapshot.migrations).toEqual([]);
    });

    it('collects app settings (non-secret only)', async () => {
      mockSettingsService.get.mockImplementation((key: string) => {
        const map: Record<string, string | null> = {
          [SETTING_KEYS.DEMO_MODE]: 'true',
          [SETTING_KEYS.ONBOARDING_COMPLETED]: 'true',
          [SETTING_KEYS.DEFAULT_TIMEZONE]: 'America/New_York',
          [SETTING_KEYS.COMMUNITY_NAME]: 'Test Guild',
          [SETTING_KEYS.RELAY_ENABLED]: 'false',
          [SETTING_KEYS.IGDB_FILTER_ADULT]: 'true',
          [SETTING_KEYS.DISCORD_BOT_ENABLED]: 'false',
          [SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED]: 'true',
        };
        return map[key] ?? null;
      });

      const snapshot = await service.collectSnapshot();

      expect(snapshot.settings).toEqual({
        demoMode: true,
        onboardingCompleted: true,
        defaultTimezone: 'America/New_York',
        communityName: 'Test Guild',
        relayEnabled: false,
        igdbFilterAdult: true,
        discordBotEnabled: false,
        discordBotSetupCompleted: true,
      });
    });

    it('never includes secret keys in settings snapshot', async () => {
      const snapshot = await service.collectSnapshot();

      // Verify none of the secret keys are queried
      const calledKeys = mockSettingsService.get.mock.calls.map(
        (call: string[]) => call[0],
      );

      const secretKeys = [
        SETTING_KEYS.DISCORD_CLIENT_ID,
        SETTING_KEYS.DISCORD_CLIENT_SECRET,
        SETTING_KEYS.DISCORD_CALLBACK_URL,
        SETTING_KEYS.IGDB_CLIENT_ID,
        SETTING_KEYS.IGDB_CLIENT_SECRET,
        SETTING_KEYS.BLIZZARD_CLIENT_ID,
        SETTING_KEYS.BLIZZARD_CLIENT_SECRET,
        SETTING_KEYS.DISCORD_BOT_TOKEN,
        SETTING_KEYS.GITHUB_PAT,
        SETTING_KEYS.RELAY_TOKEN,
      ];

      for (const secretKey of secretKeys) {
        expect(calledKeys).not.toContain(secretKey);
      }

      // Also verify no secret-looking values appear in the snapshot output
      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain('client_id');
      expect(serialized).not.toContain('client_secret');
      expect(serialized).not.toContain('bot_token');
      expect(serialized).not.toContain('github_pat');
      expect(serialized).not.toContain('relay_token');
    });

    it('collects runtime info', async () => {
      const snapshot = await service.collectSnapshot();

      expect(snapshot.runtime.nodeVersion).toBe(process.version);
      expect(snapshot.runtime.platform).toBe(process.platform);
      expect(snapshot.runtime.arch).toBe(process.arch);
      expect(typeof snapshot.runtime.uptimeSeconds).toBe('number');
      expect(typeof snapshot.runtime.memoryUsageMB.rss).toBe('number');
      expect(typeof snapshot.runtime.memoryUsageMB.heapUsed).toBe('number');
      expect(typeof snapshot.runtime.memoryUsageMB.heapTotal).toBe('number');
      expect(typeof snapshot.runtime.isContainer).toBe('boolean');
    });

    it('caches the snapshot after collection', async () => {
      expect(service.getCachedSnapshot()).toBeNull();

      await service.collectSnapshot();

      expect(service.getCachedSnapshot()).not.toBeNull();
      expect(service.getCachedSnapshot()?.integrations.discordOAuth).toBe(true);
    });

    it('coalesces concurrent collections', async () => {
      const [snapshot1, snapshot2] = await Promise.all([
        service.collectSnapshot(),
        service.collectSnapshot(),
      ]);

      // Both should return the same snapshot object
      expect(snapshot1).toBe(snapshot2);

      // DB should only have been called once
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('Sentry event processor', () => {
    it('attaches snapshot contexts to Sentry events', async () => {
      service.onModuleInit();

      // Wait for the eager collection triggered by onModuleInit
      await service.collectSnapshot();

      const processor = addEventProcessorMock.mock.calls[0][0] as (
        event: Record<string, unknown>,
      ) => Record<string, unknown>;

      const event: Record<string, unknown> = {
        contexts: { existing: { key: 'value' } },
      };

      const result = processor(event);

      expect(result).toBeDefined();
      const contexts = result.contexts as Record<string, unknown>;
      expect(contexts).toHaveProperty('integrations');
      expect(contexts).toHaveProperty('migrations');
      expect(contexts).toHaveProperty('appSettings');
      expect(contexts).toHaveProperty('runtime');
      // Preserves existing contexts
      expect(contexts).toHaveProperty('existing');
    });

    it('returns event unchanged when no snapshot is cached', () => {
      service.onModuleInit();

      const processor = addEventProcessorMock.mock.calls[0][0] as (
        event: Record<string, unknown>,
      ) => Record<string, unknown>;

      const event: Record<string, unknown> = { contexts: {} };
      const result = processor(event);

      // Event returned as-is since no snapshot exists yet
      expect(result).toBe(event);
    });
  });

  describe('migration history edge cases', () => {
    it('handles empty migration result', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      const snapshot = await service.collectSnapshot();
      expect(snapshot.migrations).toHaveLength(0);
    });
  });
});
