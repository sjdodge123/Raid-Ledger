/**
 * VersionController e2e/unit tests (ROK-1242).
 *
 * Asserts the GET /admin/update-status DTO shape and the '' → null mapping
 * for latestReleaseUrl. The controller's auth + admin guards are exercised
 * by the existing integration suite + the AdminGuard tests; this spec
 * mocks SettingsService to keep the unit fast and deterministic.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { VersionController } from './version.controller';
import { VersionCheckService } from './version-check.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

describe('VersionController — GET /admin/update-status (ROK-1242)', () => {
  let controller: VersionController;
  const settingsStore = new Map<string, string | null>();

  const mockSettingsService = {
    get: jest.fn((key: string) =>
      Promise.resolve(settingsStore.get(key) ?? null),
    ),
  };

  const mockVersionCheck = {
    getVersion: jest.fn().mockReturnValue('1.0.0'),
  };

  beforeEach(async () => {
    settingsStore.clear();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VersionController],
      providers: [
        { provide: VersionCheckService, useValue: mockVersionCheck },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    controller = module.get<VersionController>(VersionController);
  });

  it('returns latestReleaseUrl when stored value is a non-empty URL', async () => {
    settingsStore.set(SETTING_KEYS.LATEST_VERSION, '1.2.0');
    settingsStore.set(
      SETTING_KEYS.VERSION_CHECK_LAST_RUN,
      '2026-05-14T00:00:00Z',
    );
    settingsStore.set(SETTING_KEYS.UPDATE_AVAILABLE, 'true');
    settingsStore.set(
      SETTING_KEYS.LATEST_RELEASE_URL,
      'https://github.com/sjdodge123/Raid-Ledger/releases/tag/v1.2.0',
    );

    const result = await controller.getUpdateStatus();

    expect(result).toEqual({
      currentVersion: '1.0.0',
      latestVersion: '1.2.0',
      updateAvailable: true,
      lastChecked: '2026-05-14T00:00:00Z',
      latestReleaseUrl:
        'https://github.com/sjdodge123/Raid-Ledger/releases/tag/v1.2.0',
    });
  });

  it('maps stored empty-string release URL to null in the DTO', async () => {
    settingsStore.set(SETTING_KEYS.LATEST_VERSION, '1.2.0');
    settingsStore.set(
      SETTING_KEYS.VERSION_CHECK_LAST_RUN,
      '2026-05-14T00:00:00Z',
    );
    settingsStore.set(SETTING_KEYS.UPDATE_AVAILABLE, 'true');
    settingsStore.set(SETTING_KEYS.LATEST_RELEASE_URL, '');

    const result = await controller.getUpdateStatus();

    expect(result.latestReleaseUrl).toBeNull();
  });

  it('maps missing release URL key to null', async () => {
    settingsStore.set(SETTING_KEYS.LATEST_VERSION, '1.2.0');
    settingsStore.set(SETTING_KEYS.UPDATE_AVAILABLE, 'true');
    // LATEST_RELEASE_URL not set

    const result = await controller.getUpdateStatus();

    expect(result.latestReleaseUrl).toBeNull();
  });

  it('returns the four-field DTO with nulls + false when settings are empty', async () => {
    const result = await controller.getUpdateStatus();

    expect(result).toEqual({
      currentVersion: '1.0.0',
      latestVersion: null,
      updateAvailable: false,
      lastChecked: null,
      latestReleaseUrl: null,
    });
  });

  it('reads all four settings keys in parallel (single Promise.all)', async () => {
    await controller.getUpdateStatus();

    const calls = mockSettingsService.get.mock.calls.map(([k]: [string]) => k);
    expect(calls).toEqual(
      expect.arrayContaining([
        SETTING_KEYS.LATEST_VERSION,
        SETTING_KEYS.VERSION_CHECK_LAST_RUN,
        SETTING_KEYS.UPDATE_AVAILABLE,
        SETTING_KEYS.LATEST_RELEASE_URL,
      ]),
    );
    expect(mockSettingsService.get).toHaveBeenCalledTimes(4);
  });

  it('treats UPDATE_AVAILABLE values other than "true" as false', async () => {
    settingsStore.set(SETTING_KEYS.UPDATE_AVAILABLE, 'false');
    let result = await controller.getUpdateStatus();
    expect(result.updateAvailable).toBe(false);

    settingsStore.set(SETTING_KEYS.UPDATE_AVAILABLE, 'TRUE');
    result = await controller.getUpdateStatus();
    expect(result.updateAvailable).toBe(false);

    settingsStore.set(SETTING_KEYS.UPDATE_AVAILABLE, 'true');
    result = await controller.getUpdateStatus();
    expect(result.updateAvailable).toBe(true);
  });
});
