/**
 * ROK-2371 §5: "Allow sign-in with Google" (default OFF). It reuses the
 * calendar's Google OAuth client, so it can only be turned on once that
 * client's id AND secret are stored.
 */
import { SETTING_KEYS } from '../drizzle/schema';
import {
  getClientUrl,
  resolveDiscordCallbackUrl,
  type SettingsCore,
} from './settings-bot.helpers';

/** Nest route paths of the sign-in + Profile-link callbacks (API-relative). */
export const GOOGLE_SIGNIN_CALLBACK_PATHS = [
  '/auth/google/callback',
  '/auth/google/link/callback',
] as const;

const DISCORD_CALLBACK_ROUTE = '/auth/discord/callback';

/**
 * The API base the browser reaches Nest on, read off the Discord callback
 * URL (`https://host/api` behind nginx, `http://localhost:3000` in dev).
 * A custom Discord callback that does not end in its Nest route falls back
 * to `<CLIENT_URL>/api`.
 */
export function apiBaseFromDiscordCallback(
  discordCallbackUrl: string,
  clientUrl: string,
): string {
  const url = discordCallbackUrl.trim().replace(/\/+$/, '');
  if (url.endsWith(DISCORD_CALLBACK_ROUTE)) {
    return url.slice(0, -DISCORD_CALLBACK_ROUTE.length);
  }
  return `${clientUrl.replace(/\/+$/, '')}/api`;
}

export interface GoogleSigninRedirectUris {
  signin: string;
  link: string;
}

/** Exact Google redirect URIs, built the way Discord's callback is. */
export async function googleSigninRedirectUris(
  svc: SettingsCore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GoogleSigninRedirectUris> {
  const [discordCallback, clientUrl] = await Promise.all([
    resolveDiscordCallbackUrl(svc, env),
    getClientUrl(svc),
  ]);
  const base = apiBaseFromDiscordCallback(discordCallback, clientUrl);
  const [signin, link] = GOOGLE_SIGNIN_CALLBACK_PATHS;
  return { signin: `${base}${signin}`, link: `${base}${link}` };
}

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
