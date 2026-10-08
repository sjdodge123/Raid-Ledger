import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';
import {
  getCalendarProviderConfig,
  getCalendarSyncEnabled,
  setCalendarProviderConfig,
  setCalendarSyncEnabled,
} from './settings-calendar-sync.helpers';

/** In-memory SettingsCore: get/set/delete/exists over a Map. */
function memoryCore(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const core = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    exists: jest.fn((key: string) => Promise.resolve(store.has(key))),
  };
  return { core: core as unknown as SettingsCore, store, mocks: core };
}

const SECRET = 'super-secret-value-123';

describe('settings-calendar-sync.helpers — kill switch (ROK-1591)', () => {
  it('defaults to OFF when the key is unset', async () => {
    await expect(getCalendarSyncEnabled(memoryCore().core)).resolves.toBe(
      false,
    );
  });

  it('reads true only for the literal "true"', async () => {
    const on = memoryCore({ [SETTING_KEYS.CALENDAR_SYNC_ENABLED]: 'true' });
    const odd = memoryCore({ [SETTING_KEYS.CALENDAR_SYNC_ENABLED]: 'TRUE' });
    await expect(getCalendarSyncEnabled(on.core)).resolves.toBe(true);
    await expect(getCalendarSyncEnabled(odd.core)).resolves.toBe(false);
  });

  it('set/get round-trips both values', async () => {
    const { core, store } = memoryCore();
    await setCalendarSyncEnabled(core, true);
    expect(store.get(SETTING_KEYS.CALENDAR_SYNC_ENABLED)).toBe('true');
    await expect(getCalendarSyncEnabled(core)).resolves.toBe(true);
    await setCalendarSyncEnabled(core, false);
    await expect(getCalendarSyncEnabled(core)).resolves.toBe(false);
  });
});

describe('settings-calendar-sync.helpers — provider config (ROK-1591)', () => {
  it('reports an unset provider as clientId null, hasSecret false', async () => {
    const config = await getCalendarProviderConfig(memoryCore().core, 'google');
    expect(config).toEqual({ clientId: null, hasSecret: false });
  });

  it('never returns the secret value unless includeSecret is passed', async () => {
    const { core } = memoryCore({
      [SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_ID]: 'gid',
      [SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_SECRET]: SECRET,
    });
    const config = await getCalendarProviderConfig(core, 'google');
    expect(config).toEqual({ clientId: 'gid', hasSecret: true });
    expect(config).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(config)).not.toContain(SECRET);
  });

  it('hands the secret to internal callers with includeSecret', async () => {
    const { core } = memoryCore({
      [SETTING_KEYS.CALENDAR_MICROSOFT_CLIENT_SECRET]: SECRET,
    });
    const config = await getCalendarProviderConfig(core, 'microsoft', {
      includeSecret: true,
    });
    expect(config).toEqual({
      clientId: null,
      hasSecret: true,
      clientSecret: SECRET,
    });
  });

  it('set/get round-trips, trimming values, per provider', async () => {
    const { core, store } = memoryCore();
    await setCalendarProviderConfig(core, 'microsoft', {
      clientId: ' mid ',
      clientSecret: SECRET,
    });
    expect(store.get(SETTING_KEYS.CALENDAR_MICROSOFT_CLIENT_ID)).toBe('mid');
    await expect(getCalendarProviderConfig(core, 'microsoft')).resolves.toEqual(
      { clientId: 'mid', hasSecret: true },
    );
    await expect(getCalendarProviderConfig(core, 'google')).resolves.toEqual({
      clientId: null,
      hasSecret: false,
    });
  });

  it('an omitted field is left unchanged; an empty string clears it', async () => {
    const { core, store, mocks } = memoryCore({
      [SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_ID]: 'gid',
      [SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_SECRET]: SECRET,
    });
    await setCalendarProviderConfig(core, 'google', { clientSecret: '' });
    expect(store.get(SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_ID)).toBe('gid');
    expect(store.has(SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_SECRET)).toBe(false);
    expect(mocks.delete).toHaveBeenCalledWith(
      SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_SECRET,
    );
    await expect(getCalendarProviderConfig(core, 'google')).resolves.toEqual({
      clientId: 'gid',
      hasSecret: false,
    });
  });
});
