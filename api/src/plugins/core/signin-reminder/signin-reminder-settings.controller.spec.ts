import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from '../../../auth/admin.guard';
import { SETTING_KEYS, type SettingKey } from '../../../drizzle/schema';
import type { SettingsService } from '../../../settings/settings.service';
import {
  SigninReminderSettingsController,
  writeSigninReminderSettings,
} from './signin-reminder-settings.controller';

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

describe('writeSigninReminderSettings', () => {
  it('stores all three settings and returns what the cron will read', async () => {
    const s = store();
    const saved = await writeSigninReminderSettings(s, {
      enabled: false,
      weeks: 12,
      max: 1,
    });
    expect(saved).toEqual({ enabled: false, weeks: 12, max: 1 });
    expect(s.map.get(SETTING_KEYS.SIGNIN_REMINDER_ENABLED)).toBe('false');
    expect(s.map.get(SETTING_KEYS.SIGNIN_REMINDER_WEEKS)).toBe('12');
    expect(s.map.get(SETTING_KEYS.SIGNIN_REMINDER_MAX)).toBe('1');
  });

  it('turning it back on stores the literal "true"', async () => {
    const s = store([[SETTING_KEYS.SIGNIN_REMINDER_ENABLED, 'false']]);
    const saved = await writeSigninReminderSettings(s, {
      enabled: true,
      weeks: 3,
      max: 3,
    });
    expect(saved.enabled).toBe(true);
    expect(s.map.get(SETTING_KEYS.SIGNIN_REMINDER_ENABLED)).toBe('true');
  });

  it.each([
    ['weeks below 1', { enabled: true, weeks: 0, max: 3 }],
    ['weeks above 12', { enabled: true, weeks: 13, max: 3 }],
    ['max below 1', { enabled: true, weeks: 3, max: 0 }],
    ['max above 10', { enabled: true, weeks: 3, max: 11 }],
    ['fractional weeks', { enabled: true, weeks: 2.5, max: 3 }],
    ['string enabled', { enabled: 'false', weeks: 3, max: 3 }],
    ['missing max', { enabled: true, weeks: 3 }],
  ])('rejects %s with a 400 and stores nothing', async (_label, body) => {
    const s = store();
    await expect(writeSigninReminderSettings(s, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(s.map.size).toBe(0);
  });
});

describe('SigninReminderSettingsController', () => {
  it('is admin-guarded', () => {
    const guards: unknown[] =
      Reflect.getMetadata(GUARDS_METADATA, SigninReminderSettingsController) ??
      [];
    expect(guards).toContain(AdminGuard);
  });

  it('GET reads OFF + the defaults when nothing is stored; PUT round-trips', async () => {
    const s = store();
    const ctrl = new SigninReminderSettingsController(
      s as unknown as SettingsService,
    );
    expect(await ctrl.getSettings()).toEqual({
      enabled: false,
      weeks: 3,
      max: 3,
    });
    await ctrl.updateSettings({ enabled: true, weeks: 6, max: 4 });
    expect(await ctrl.getSettings()).toEqual({
      enabled: true,
      weeks: 6,
      max: 4,
    });
  });
});
