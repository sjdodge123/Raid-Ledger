/**
 * DemoTestVersionController (ROK-1475, OQ-6) — seeds update-status settings.
 */
import { ForbiddenException } from '@nestjs/common';
import { DemoTestVersionController } from './demo-test-version.controller';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { VersionController } from '../version/version.controller';

function makeSettings(demoMode = true) {
  return {
    getDemoMode: jest.fn().mockResolvedValue(demoMode),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

type Ctor = ConstructorParameters<typeof DemoTestVersionController>;

const RUNNING_SHA = '74b92a0';

function makeVersionCheck(runningSha: string | null = RUNNING_SHA) {
  return {
    getVersion: jest.fn().mockReturnValue('1.0.0'),
    getRunningCommitSha: jest.fn().mockReturnValue(runningSha),
  };
}

function makeController(settings: object, versionCheck = makeVersionCheck()) {
  return new DemoTestVersionController(
    settings as unknown as Ctor[0],
    versionCheck as unknown as Ctor[1],
  );
}

/** Settings mock backed by a real map, so a seed can be read back. */
function makeStoreSettings() {
  const store = new Map<string, string>();
  return {
    store,
    getDemoMode: jest.fn().mockResolvedValue(true),
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
}

describe('DemoTestVersionController — POST /admin/test/seed-update-status', () => {
  const originalDemoMode = process.env.DEMO_MODE;

  beforeEach(() => {
    process.env.DEMO_MODE = 'true';
  });

  afterEach(() => {
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  });

  it('writes the fixes signal as the settings the controller reads', async () => {
    const settings = makeSettings();
    const url =
      'https://github.com/sjdodge123/Raid-Ledger/compare/74b92a0...3ab490a';

    const result = await makeController(settings).seedUpdateStatus({
      fixesAvailable: 3,
      latestCommitSha: '3ab490a',
      fixesCompareUrl: url,
      updateAvailable: false,
    });

    const writes = new Map(settings.set.mock.calls);
    expect(writes.get(SETTING_KEYS.FIXES_AVAILABLE)).toBe('3');
    expect(writes.get(SETTING_KEYS.LATEST_COMMIT_SHA)).toBe('3ab490a');
    expect(writes.get(SETTING_KEYS.FIXES_COMPARE_URL)).toBe(url);
    expect(writes.get(SETTING_KEYS.UPDATE_AVAILABLE)).toBe('false');
    expect(writes.has(SETTING_KEYS.VERSION_CHECK_LAST_RUN)).toBe(true);
    expect(writes.has(SETTING_KEYS.LATEST_VERSION)).toBe(false);
    expect(result.seeded).toHaveLength(4);
  });

  it('clears a setting when the field is null ("unknown")', async () => {
    const settings = makeSettings();
    await makeController(settings).seedUpdateStatus({ fixesAvailable: null });
    expect(settings.delete).toHaveBeenCalledWith(SETTING_KEYS.FIXES_AVAILABLE);
    expect(settings.set.mock.calls.map(([k]: [string]) => k)).not.toContain(
      SETTING_KEYS.FIXES_AVAILABLE,
    );
  });

  it('rejects a negative fixes count', async () => {
    const settings = makeSettings();
    await expect(
      makeController(settings).seedUpdateStatus({ fixesAvailable: -1 }),
    ).rejects.toThrow();
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('is forbidden outside DEMO_MODE (env flag off)', async () => {
    process.env.DEMO_MODE = 'false';
    const settings = makeSettings();
    await expect(
      makeController(settings).seedUpdateStatus({ fixesAvailable: 3 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('is forbidden when the DEMO_MODE setting is off', async () => {
    const settings = makeSettings(false);
    await expect(
      makeController(settings).seedUpdateStatus({ fixesAvailable: 3 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DemoTestVersionController — seeded fixes reach GET /admin/update-status', () => {
  const originalDemoMode = process.env.DEMO_MODE;

  beforeEach(() => {
    process.env.DEMO_MODE = 'true';
  });

  afterEach(() => {
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  });

  it('a seeded fixes count is visible on GET /admin/update-status', async () => {
    const settings = makeStoreSettings();
    const versionCheck = makeVersionCheck();
    await makeController(settings, versionCheck).seedUpdateStatus({
      fixesAvailable: 3,
    });

    const status = await new VersionController(
      versionCheck as unknown as ConstructorParameters<
        typeof VersionController
      >[0],
      settings as unknown as ConstructorParameters<typeof VersionController>[1],
    ).getUpdateStatus();

    expect(status.fixesAvailable).toBe(3);
    expect(settings.store.get(SETTING_KEYS.FIXES_COMPUTED_FOR_SHA)).toBe(
      RUNNING_SHA,
    );
  });

  it('does not touch the computed-for sha when fixesAvailable is omitted', async () => {
    const settings = makeStoreSettings();
    settings.store.set(SETTING_KEYS.FIXES_COMPUTED_FOR_SHA, 'old1234');
    await makeController(settings).seedUpdateStatus({ updateAvailable: true });
    expect(settings.store.get(SETTING_KEYS.FIXES_COMPUTED_FOR_SHA)).toBe(
      'old1234',
    );
  });
});
