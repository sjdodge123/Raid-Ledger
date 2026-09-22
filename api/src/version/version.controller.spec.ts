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
import { UpdateStatusSchema } from '@raid-ledger/contract';

/** ROK-1475: build-level fields are null until a build check has succeeded. */
const NO_BUILD_SIGNAL = {
  fixesAvailable: null,
  runningCommitSha: null,
  latestCommitSha: null,
  fixesCompareUrl: null,
};

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
    getRunningBuildLabel: jest.fn().mockReturnValue('1.0.0'),
    getRunningCommitSha: jest.fn().mockReturnValue(null),
  };

  beforeEach(async () => {
    settingsStore.clear();
    jest.clearAllMocks();
    mockVersionCheck.getRunningBuildLabel.mockReturnValue('1.0.0');
    mockVersionCheck.getRunningCommitSha.mockReturnValue(null);

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
      ...NO_BUILD_SIGNAL,
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
      ...NO_BUILD_SIGNAL,
    });
  });

  // ROK-1475: four build-level keys joined the original four.
  it('reads all eight settings keys in parallel (single Promise.all)', async () => {
    await controller.getUpdateStatus();

    const calls = mockSettingsService.get.mock.calls.map(([k]: [string]) => k);
    expect(calls).toEqual(
      expect.arrayContaining([
        SETTING_KEYS.LATEST_VERSION,
        SETTING_KEYS.VERSION_CHECK_LAST_RUN,
        SETTING_KEYS.UPDATE_AVAILABLE,
        SETTING_KEYS.LATEST_RELEASE_URL,
        SETTING_KEYS.FIXES_AVAILABLE,
        SETTING_KEYS.LATEST_COMMIT_SHA,
        SETTING_KEYS.FIXES_COMPARE_URL,
        SETTING_KEYS.FIXES_COMPUTED_FOR_SHA,
      ]),
    );
    expect(mockSettingsService.get).toHaveBeenCalledTimes(8);
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

  // ROK-1475 supersedes ROK-1393 here: updateAvailable is now the
  // feature-level (release) signal, so currentVersion must be the semver it
  // is compared against; the sha moved to runningCommitSha.
  it('currentVersion is the semver and runningCommitSha the short sha (ROK-1475)', async () => {
    mockVersionCheck.getVersion.mockReturnValue('1.1.0');
    mockVersionCheck.getRunningCommitSha.mockReturnValue('3ab490a');

    const result = await controller.getUpdateStatus();

    expect(result.currentVersion).toBe('1.1.0');
    expect(result.runningCommitSha).toBe('3ab490a');
  });

  /** A build check that ran against the build that is running now. */
  function seedCurrentBuildCheck(runningSha = '74b92a0'): void {
    mockVersionCheck.getRunningCommitSha.mockReturnValue(runningSha);
    settingsStore.set(SETTING_KEYS.FIXES_COMPUTED_FOR_SHA, runningSha);
  }

  it('returns the build-level fixes signal when a build check has run (ROK-1475)', async () => {
    const url =
      'https://github.com/sjdodge123/Raid-Ledger/compare/74b92a0...3ab490a';
    seedCurrentBuildCheck();
    settingsStore.set(SETTING_KEYS.FIXES_AVAILABLE, '3');
    settingsStore.set(SETTING_KEYS.LATEST_COMMIT_SHA, '3ab490a');
    settingsStore.set(SETTING_KEYS.FIXES_COMPARE_URL, url);

    const result = await controller.getUpdateStatus();

    expect(result.fixesAvailable).toBe(3);
    expect(result.latestCommitSha).toBe('3ab490a');
    expect(result.fixesCompareUrl).toBe(url);
    expect(UpdateStatusSchema.safeParse(result).success).toBe(true);
  });

  it('keeps a stored 0 as 0 ("checked, up to date") and maps "" to null', async () => {
    seedCurrentBuildCheck();
    settingsStore.set(SETTING_KEYS.FIXES_AVAILABLE, '0');
    settingsStore.set(SETTING_KEYS.FIXES_COMPARE_URL, '');
    const zero = await controller.getUpdateStatus();
    expect(zero.fixesAvailable).toBe(0);
    expect(zero.fixesCompareUrl).toBeNull();

    settingsStore.set(SETTING_KEYS.FIXES_AVAILABLE, '');
    expect((await controller.getUpdateStatus()).fixesAvailable).toBeNull();
  });

  // Review finding: after a Watchtower upgrade (or a failed build check on the
  // new build) the stored count describes the OLD build — never show it.
  it('nulls fixesAvailable + fixesCompareUrl when the count was computed for another build', async () => {
    mockVersionCheck.getRunningCommitSha.mockReturnValue('9f00d1e');
    settingsStore.set(SETTING_KEYS.FIXES_COMPUTED_FOR_SHA, '74b92a0');
    settingsStore.set(SETTING_KEYS.FIXES_AVAILABLE, '3');
    settingsStore.set(
      SETTING_KEYS.FIXES_COMPARE_URL,
      'https://github.com/sjdodge123/Raid-Ledger/compare/74b92a0...3ab490a',
    );

    const result = await controller.getUpdateStatus();

    expect({
      fixesAvailable: result.fixesAvailable,
      fixesCompareUrl: result.fixesCompareUrl,
    }).toEqual({ fixesAvailable: null, fixesCompareUrl: null });
  });

  it('nulls the fixes signal when no build sha was recorded with the count', async () => {
    mockVersionCheck.getRunningCommitSha.mockReturnValue('74b92a0');
    settingsStore.set(SETTING_KEYS.FIXES_AVAILABLE, '3');

    expect((await controller.getUpdateStatus()).fixesAvailable).toBeNull();
  });

  it('maps an unparseable FIXES_AVAILABLE to null, never 0 or NaN', async () => {
    for (const raw of ['abc', '-2', '1.5', ' 3']) {
      settingsStore.set(SETTING_KEYS.FIXES_AVAILABLE, raw);
      const result = await controller.getUpdateStatus();
      expect({ raw, fixes: result.fixesAvailable }).toEqual({
        raw,
        fixes: null,
      });
    }
  });

  it('every DTO the controller returns satisfies the contract schema', async () => {
    const result = await controller.getUpdateStatus();
    expect(UpdateStatusSchema.safeParse(result).success).toBe(true);
  });
});
