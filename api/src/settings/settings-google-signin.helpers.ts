/**
 * ROK-2371 §5: "Allow sign-in with Google" (default OFF). It reuses the
 * calendar's Google OAuth client, so it can only be turned on once that
 * client's id AND secret are stored.
 */
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';

/** Sign-in redirect URIs (relative to `CLIENT_URL`) for the Google console. */
export const GOOGLE_SIGNIN_CALLBACK_PATHS = [
  '/api/auth/google/callback',
  '/api/auth/google/link/callback',
] as const;

/** The toggle; an absent row reads as off. */
export async function getGoogleSigninEnabled(
  svc: Pick<SettingsCore, 'get'>,
): Promise<boolean> {
  return (await svc.get(SETTING_KEYS.AUTH_GOOGLE_SIGNIN_ENABLED)) === 'true';
}

/** Store the toggle. Callers check the client is configured first. */
export async function setGoogleSigninEnabled(
  svc: SettingsCore,
  enabled: boolean,
): Promise<void> {
  await svc.set(
    SETTING_KEYS.AUTH_GOOGLE_SIGNIN_ENABLED,
    enabled ? 'true' : 'false',
  );
}
