import { SETTING_KEYS, type SettingKey } from '../../../drizzle/schema';
import {
  ensureSigninReminderLaunchedAt,
  readSigninReminderSettings,
} from './signin-reminder.settings';

function store(initial: readonly (readonly [SettingKey, string])[] = []) {
  const map = new Map<SettingKey, string>(initial);
  return {
    map,
    get: (k: SettingKey) => Promise.resolve(map.get(k) ?? null),
    set: (k: SettingKey, v: string) => {
      map.set(k, v);
      return Promise.resolve();
    },
  };
}

describe('readSigninReminderSettings', () => {
  it('unset ⇒ ON, every 3 weeks, max 3 (ruled Q2/Q8)', async () => {
    expect(
      await readSigninReminderSettings(store(), { demoMode: false }),
    ).toEqual({
      enabled: true,
      weeks: 3,
      max: 3,
    });
  });
  it("only 'false' turns it off; in-range numbers are read", async () => {
    const s = store([
      [SETTING_KEYS.SIGNIN_REMINDER_ENABLED, 'false'],
      [SETTING_KEYS.SIGNIN_REMINDER_WEEKS, '5'],
      [SETTING_KEYS.SIGNIN_REMINDER_MAX, '10'],
    ]);
    expect(await readSigninReminderSettings(s, { demoMode: false })).toEqual({
      enabled: false,
      weeks: 5,
      max: 10,
    });
  });
  it('DEMO_MODE: unset ⇒ OFF, an explicit true ⇒ ON (fleet envs share real guilds)', async () => {
    const demo = { demoMode: true };
    expect((await readSigninReminderSettings(store(), demo)).enabled).toBe(
      false,
    );
    const on = store([[SETTING_KEYS.SIGNIN_REMINDER_ENABLED, 'true']]);
    expect((await readSigninReminderSettings(on, demo)).enabled).toBe(true);
  });
  it('malformed or out-of-range numbers fall back to the defaults', async () => {
    const s = store([
      [SETTING_KEYS.SIGNIN_REMINDER_ENABLED, 'true'],
      [SETTING_KEYS.SIGNIN_REMINDER_WEEKS, '0'],
      [SETTING_KEYS.SIGNIN_REMINDER_MAX, 'lots'],
    ]);
    expect(await readSigninReminderSettings(s, { demoMode: false })).toEqual({
      enabled: true,
      weeks: 3,
      max: 3,
    });
  });
});

describe('ensureSigninReminderLaunchedAt', () => {
  const NOW = new Date('2026-11-20T12:00:00Z');
  it('stores now on the first run', async () => {
    const s = store();
    expect(await ensureSigninReminderLaunchedAt(s, NOW)).toEqual(NOW);
    expect(s.map.get(SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT)).toBe(
      NOW.toISOString(),
    );
  });
  it('never overwrites a stored launch time', async () => {
    const first = '2026-11-01T00:00:00.000Z';
    const s = store([[SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT, first]]);
    expect((await ensureSigninReminderLaunchedAt(s, NOW)).toISOString()).toBe(
      first,
    );
    expect(s.map.get(SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT)).toBe(first);
  });
});
