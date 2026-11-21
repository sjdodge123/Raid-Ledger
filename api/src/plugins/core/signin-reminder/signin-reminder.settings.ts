/**
 * ROK-2284 — read the sign-in reminder settings (app_settings). The switch is
 * unset ⇒ ON (ruled Q8) EXCEPT under DEMO_MODE, where unset ⇒ OFF: fleet and
 * local dev envs share real guilds with humans who have no user row there, so
 * a fresh env must never start DM-ing them (an explicit 'true' still turns it
 * on). Weeks/max fall back to the ruled defaults when unset or malformed (GG
 * "malformed ⇒ default" pattern, `gg-delivery.settings.ts`).
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

/** True when either DEMO_MODE signal (env or the DB setting) is on. */
export async function isSigninReminderDemoMode(store: {
  getDemoMode(): Promise<boolean>;
}): Promise<boolean> {
  return process.env.DEMO_MODE === 'true' || (await store.getDemoMode());
}

/**
 * Current settings, defaults applied. A stored value: only the literal
 * 'false' turns it off. Unset: ON, or OFF when `demoMode` is true.
 */
export async function readSigninReminderSettings(
  store: Pick<SigninReminderSettingsStore, 'get'>,
  opts: { demoMode: boolean },
): Promise<SigninReminderSettings> {
  const k = SETTING_KEYS;
  const [enabled, weeks, max] = await Promise.all([
    store.get(k.SIGNIN_REMINDER_ENABLED),
    store.get(k.SIGNIN_REMINDER_WEEKS),
    store.get(k.SIGNIN_REMINDER_MAX),
  ]);
  return {
    enabled: enabled === null ? !opts.demoMode : enabled.trim() !== 'false',
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
