/**
 * ROK-1591: Calendar Sync kill switch + OAuth provider config, delegated
 * from SettingsService (D5 — settings.service.ts sits at the 300-line cap).
 *
 * Same shape as settings-lfg-board.helpers.ts: consumers pass the
 * SettingsService instance. Every app_settings value is encrypted at rest by
 * `SettingsService.set`, so the client secrets need no extra handling here;
 * what this file guarantees is that a secret only leaves it when an internal
 * caller asks for it with `includeSecret`.
 */
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingKey } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';

/** Providers whose OAuth client is admin-configured (Apple needs none). */
export type CalendarOAuthProvider = 'google' | 'microsoft';

/** Provider config as admin surfaces and availability checks see it. */
export interface CalendarProviderConfig {
  clientId: string | null;
  hasSecret: boolean;
  /** Present only when the caller passed `includeSecret: true`. */
  clientSecret?: string;
}

/** An omitted field leaves the stored value alone; '' clears it. */
export interface CalendarProviderConfigUpdate {
  clientId?: string;
  clientSecret?: string;
}

const PROVIDER_KEYS: Record<
  CalendarOAuthProvider,
  { clientId: SettingKey; clientSecret: SettingKey }
> = {
  google: {
    clientId: SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_ID,
    clientSecret: SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_SECRET,
  },
  microsoft: {
    clientId: SETTING_KEYS.CALENDAR_MICROSOFT_CLIENT_ID,
    clientSecret: SETTING_KEYS.CALENDAR_MICROSOFT_CLIENT_SECRET,
  },
};

/** Calendar Sync master kill switch (default off). */
export async function getCalendarSyncEnabled(
  svc: SettingsCore,
): Promise<boolean> {
  return (await svc.get(SETTING_KEYS.CALENDAR_SYNC_ENABLED)) === 'true';
}

/** Set the Calendar Sync master kill switch. */
export async function setCalendarSyncEnabled(
  svc: SettingsCore,
  enabled: boolean,
): Promise<void> {
  await svc.set(SETTING_KEYS.CALENDAR_SYNC_ENABLED, enabled ? 'true' : 'false');
}

/**
 * Read one provider's OAuth client config.
 *
 * @param svc - Settings accessor.
 * @param provider - 'google' or 'microsoft'.
 * @param opts.includeSecret - Internal callers only (the OAuth exchange).
 * @returns `clientId` (null when unset) and `hasSecret`; the secret itself
 *   only when `includeSecret` is true and one is stored.
 */
export async function getCalendarProviderConfig(
  svc: SettingsCore,
  provider: CalendarOAuthProvider,
  opts: { includeSecret?: boolean } = {},
): Promise<CalendarProviderConfig> {
  const keys = PROVIDER_KEYS[provider];
  const [clientId, clientSecret] = await Promise.all([
    svc.get(keys.clientId),
    svc.get(keys.clientSecret),
  ]);
  const config: CalendarProviderConfig = {
    clientId: clientId ? clientId : null,
    hasSecret: Boolean(clientSecret),
  };
  if (opts.includeSecret && clientSecret) config.clientSecret = clientSecret;
  return config;
}

/** Store, clear ('' or whitespace) or skip (undefined) one setting. */
async function applyField(
  svc: SettingsCore,
  key: SettingKey,
  value: string | undefined,
): Promise<void> {
  if (value === undefined) return;
  const trimmed = value.trim();
  if (trimmed) await svc.set(key, trimmed);
  else await svc.delete(key);
}

/**
 * Update one provider's OAuth client config.
 *
 * @param svc - Settings accessor.
 * @param provider - 'google' or 'microsoft'.
 * @param update - Omitted field = unchanged; '' clears it.
 */
export async function setCalendarProviderConfig(
  svc: SettingsCore,
  provider: CalendarOAuthProvider,
  update: CalendarProviderConfigUpdate,
): Promise<void> {
  const keys = PROVIDER_KEYS[provider];
  await applyField(svc, keys.clientId, update.clientId);
  await applyField(svc, keys.clientSecret, update.clientSecret);
}
