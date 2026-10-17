import { SETTING_KEYS } from '../drizzle/schema';

/** Minimal surface of SettingsService needed by these helpers. */
interface SettingsLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * ROK-1353: refresh-token session length (days). Default 60, clamped to the
 * admin-configurable 1–365 range. Extracted to keep settings.service.ts under
 * the 300-line ESLint cap.
 */
export async function getSessionLengthDays(
  settings: SettingsLike,
): Promise<number> {
  const raw = await settings.get(SETTING_KEYS.SESSION_LENGTH_DAYS);
  const parsed = raw === null ? 60 : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 60;
  return Math.min(365, Math.max(1, parsed));
}

/** Persist the session length (days). Caller validates the 1–365 range. */
export async function setSessionLengthDays(
  settings: SettingsLike,
  days: number,
): Promise<void> {
  await settings.set(SETTING_KEYS.SESSION_LENGTH_DAYS, String(days));
}
