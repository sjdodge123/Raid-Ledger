/**
 * DemoTestVersionController (ROK-1475, OQ-6) — seeds update-status settings.
 */
import { ForbiddenException } from '@nestjs/common';
import { DemoTestVersionController } from './demo-test-version.controller';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

function makeSettings(demoMode = true) {
  return {
    getDemoMode: jest.fn().mockResolvedValue(demoMode),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

function makeController(settings: ReturnType<typeof makeSettings>) {
  return new DemoTestVersionController(
    settings as unknown as ConstructorParameters<
      typeof DemoTestVersionController
    >[0],
  );
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
