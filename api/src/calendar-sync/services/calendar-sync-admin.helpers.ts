/**
 * ROK-1591: `GET/PUT /admin/settings/calendar-sync` shapes.
 *
 * The read shape carries `hasSecret`, never a secret: it is built from
 * `getCalendarProviderConfig` without `includeSecret`, field by field, so the
 * contract's `.strict()` schema matches exactly.
 */
import type {
  AdminCalendarSyncSettings,
  UpdateAdminCalendarSyncSettings,
} from '@raid-ledger/contract';
import {
  getClientUrl,
  type SettingsCore,
} from '../../settings/settings-bot.helpers';
import {
  getCalendarProviderConfig,
  getCalendarSyncEnabled,
  setCalendarProviderConfig,
  setCalendarSyncEnabled,
  type CalendarOAuthProvider,
} from '../../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_OAUTH_PROVIDERS,
  oauthCallbackPath,
} from '../calendar-sync.constants';

type AdminProviderSettings = AdminCalendarSyncSettings['google'];

async function readProvider(
  svc: SettingsCore,
  provider: CalendarOAuthProvider,
): Promise<AdminProviderSettings> {
  const config = await getCalendarProviderConfig(svc, provider);
  return { clientId: config.clientId, hasSecret: config.hasSecret };
}

/** Exact redirect URIs for the provider consoles, from `CLIENT_URL` (D6). */
export async function buildRedirectUris(
  svc: SettingsCore,
): Promise<AdminCalendarSyncSettings['redirectUris']> {
  const base = (await getClientUrl(svc)).replace(/\/+$/, '');
  return {
    google: `${base}${oauthCallbackPath('google')}`,
    microsoft: `${base}${oauthCallbackPath('microsoft')}`,
  };
}

/** The admin read shape. */
export async function buildAdminCalendarSyncSettings(
  svc: SettingsCore,
): Promise<AdminCalendarSyncSettings> {
  const [enabled, google, microsoft, redirectUris] = await Promise.all([
    getCalendarSyncEnabled(svc),
    readProvider(svc, 'google'),
    readProvider(svc, 'microsoft'),
    buildRedirectUris(svc),
  ]);
  return { enabled, google, microsoft, redirectUris };
}

/**
 * Apply a validated PUT body. Omitted fields are left alone; an empty string
 * clears a client id or secret.
 */
export async function applyAdminCalendarSyncUpdate(
  svc: SettingsCore,
  update: UpdateAdminCalendarSyncSettings,
): Promise<void> {
  for (const provider of CALENDAR_OAUTH_PROVIDERS) {
    const providerUpdate = update[provider];
    if (providerUpdate) {
      await setCalendarProviderConfig(svc, provider, providerUpdate);
    }
  }
  if (update.enabled !== undefined) {
    await setCalendarSyncEnabled(svc, update.enabled);
  }
}
