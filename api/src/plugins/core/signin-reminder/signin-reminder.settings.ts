/**
 * ROK-2284 — read the sign-in reminder settings (app_settings). The switch is
 * ON only when the stored value is exactly 'true' (trimmed); unset, 'false' or
 * anything else ⇒ OFF, in EVERY environment, prod included. Operator ruling
 * 2026-11-21 (supersedes spec ruling Q8 "ships ON"): nothing may go out on
 * deploy — an admin turns it on after reviewing the message. Weeks/max fall
 * back to the ruled defaults when unset or malformed (GG "malformed ⇒
 * default" pattern, `gg-delivery.settings.ts`).
 */
import { SETTING_KEYS, type SettingKey } from '../../../drizzle/schema';
import {
  SIGNIN_REMINDER_DEFAULT_MAX,
  SIGNIN_REMINDER_DEFAULT_WEEKS,
  SIGNIN_REMINDER_MAX_RANGE,
  SIGNIN_REMINDER_WEEKS_RANGE,
} from './signin-reminder.constants';

/** The slice of `SettingsService` these helpers use. */
export interface SigninReminderSettingsStore {
  get(key: SettingKey): Promise<string | null>;
  set(key: SettingKey, value: string): Promise<void>;
}

export interface SigninReminderSettings {
  enabled: boolean;
  weeks: number;
  max: number;
}

function intIn(
  raw: string | null,
  range: { min: number; max: number },
  fallback: number,
): number {
  if (raw === null || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw);
  return n >= range.min && n <= range.max ? n : fallback;
}

/**
 * Current settings, defaults applied. Only a stored 'true' turns the switch
 * on; unset or any other value is OFF (ruling 2026-11-21).
 */
export async function readSigninReminderSettings(
  store: Pick<SigninReminderSettingsStore, 'get'>,
): Promise<SigninReminderSettings> {
  const k = SETTING_KEYS;
  const [enabled, weeks, max] = await Promise.all([
    store.get(k.SIGNIN_REMINDER_ENABLED),
    store.get(k.SIGNIN_REMINDER_WEEKS),
    store.get(k.SIGNIN_REMINDER_MAX),
  ]);
  return {
    enabled: enabled?.trim() === 'true',
    weeks: intIn(
      weeks,
      SIGNIN_REMINDER_WEEKS_RANGE,
      SIGNIN_REMINDER_DEFAULT_WEEKS,
    ),
    max: intIn(max, SIGNIN_REMINDER_MAX_RANGE, SIGNIN_REMINDER_DEFAULT_MAX),
  };
}

/**
 * The launch time: stored on the first enabled tick and never overwritten
 * (members already in the guild then skip the 3-day wait). A malformed stored
 * value is left alone and read as `now`, so it can never re-open a wave.
 */
export async function ensureSigninReminderLaunchedAt(
  store: SigninReminderSettingsStore,
  now: Date,
): Promise<Date> {
  const raw = await store.get(SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT);
  if (raw === null) {
    await store.set(
      SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT,
      now.toISOString(),
    );
    return now;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}
