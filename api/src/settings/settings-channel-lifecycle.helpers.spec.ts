/**
 * Unit tests for settings-channel-lifecycle.helpers.ts — ROK-1429 (ROK-1428 L2):
 * the channel lifecycle settings group read/written through SettingsCore.
 */
import { BadRequestException } from '@nestjs/common';
import { LIFECYCLE_DEFAULTS } from '@raid-ledger/contract';
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';
import {
  getChannelLifecycleSettings,
  setChannelLifecycleSettings,
  recordChannelLifecycleRun,
} from './settings-channel-lifecycle.helpers';

function createMockSettingsCore(): SettingsCore & {
  _store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: jest.fn((key) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key, value) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    exists: jest.fn((key) => Promise.resolve(store.has(key))),
    delete: jest.fn((key) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
}

describe('settings-channel-lifecycle.helpers — read', () => {
  let svc: ReturnType<typeof createMockSettingsCore>;

  beforeEach(() => {
    svc = createMockSettingsCore();
  });

  it('returns the defaults with the automation OFF when nothing is stored', async () => {
    await expect(getChannelLifecycleSettings(svc)).resolves.toEqual({
      enabled: false,
      recentActivityDays: LIFECYCLE_DEFAULTS.recentActivityDays,
      createThreshold: LIFECYCLE_DEFAULTS.createThreshold,
      gamesCategoryId: null,
      archiveCategoryId: null,
      hideOnArchive: false,
      maxChangesPerTick: LIFECYCLE_DEFAULTS.maxChangesPerTick,
      lastRunAt: null,
      lastRunError: null,
    });
  });

  it('falls back to the default when a stored number is out of range', async () => {
    svc._store.set(SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_RECENT_DAYS, '3');
    svc._store.set(
      SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_CREATE_THRESHOLD,
      'x',
    );
    const settings = await getChannelLifecycleSettings(svc);
    expect(settings.recentActivityDays).toBe(30);
    expect(settings.createThreshold).toBe(2);
  });
});

describe('settings-channel-lifecycle.helpers — write', () => {
  let svc: ReturnType<typeof createMockSettingsCore>;

  beforeEach(() => {
    svc = createMockSettingsCore();
  });

  it('round-trips a patch and returns the merged settings', async () => {
    const result = await setChannelLifecycleSettings(svc, {
      enabled: true,
      recentActivityDays: 45,
      createThreshold: 3,
      gamesCategoryId: '111',
      archiveCategoryId: '222',
      hideOnArchive: true,
      maxChangesPerTick: 5,
    });
    const expected = {
      enabled: true,
      recentActivityDays: 45,
      createThreshold: 3,
      gamesCategoryId: '111',
      archiveCategoryId: '222',
      hideOnArchive: true,
      maxChangesPerTick: 5,
      lastRunAt: null,
      lastRunError: null,
    };
    expect(result).toEqual(expected);
    await expect(getChannelLifecycleSettings(svc)).resolves.toEqual(expected);
  });

  it('clears a category id when the patch sets it to null', async () => {
    await setChannelLifecycleSettings(svc, { archiveCategoryId: '222' });
    await setChannelLifecycleSettings(svc, { archiveCategoryId: null });
    const settings = await getChannelLifecycleSettings(svc);
    expect(settings.archiveCategoryId).toBeNull();
  });

  it('leaves keys absent from the patch untouched', async () => {
    await setChannelLifecycleSettings(svc, { createThreshold: 4 });
    await setChannelLifecycleSettings(svc, { hideOnArchive: true });
    const settings = await getChannelLifecycleSettings(svc);
    expect(settings.createThreshold).toBe(4);
    expect(settings.hideOnArchive).toBe(true);
  });

  it('rejects an out-of-range value without writing anything', async () => {
    await expect(
      setChannelLifecycleSettings(svc, { recentActivityDays: 365 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setChannelLifecycleSettings(svc, { createThreshold: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.set).not.toHaveBeenCalled();
  });

  it('rejects unknown keys, including the read-only run status', async () => {
    await expect(
      setChannelLifecycleSettings(svc, { lastRunError: 'nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.set).not.toHaveBeenCalled();
  });
});

describe('settings-channel-lifecycle.helpers — run status', () => {
  let svc: ReturnType<typeof createMockSettingsCore>;

  beforeEach(() => {
    svc = createMockSettingsCore();
  });

  it('records the last run time and error, and clears the error on success', async () => {
    const at = new Date('2026-10-20T04:15:00.000Z');
    await recordChannelLifecycleRun(svc, { at, error: 'Missing Permissions' });
    let settings = await getChannelLifecycleSettings(svc);
    expect(settings.lastRunAt).toBe('2026-10-20T04:15:00.000Z');
    expect(settings.lastRunError).toBe('Missing Permissions');

    await recordChannelLifecycleRun(svc, { at, error: null });
    settings = await getChannelLifecycleSettings(svc);
    expect(settings.lastRunError).toBeNull();
  });
});
