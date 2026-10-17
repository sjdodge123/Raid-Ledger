/**
 * ROK-1727: the Wowhead resolver kill switch. Unset ⇒ ON (D2); off is stored
 * as `'false'`, and turning it back on deletes the key.
 */
import { SETTING_KEYS } from '../../../drizzle/schema/app-settings';
import type { SettingsService } from '../../../settings/settings.service';

type SettingsCore = Pick<SettingsService, 'get' | 'set' | 'delete'>;

/** True unless an admin switched the resolver off. */
export async function isWowheadResolverEnabled(
  svc: Pick<SettingsCore, 'get'>,
): Promise<boolean> {
  return (await svc.get(SETTING_KEYS.WOWHEAD_RESOLVER_ENABLED)) !== 'false';
}

/** Persist the switch: on = absent key (the default), off = `'false'`. */
export async function setWowheadResolverEnabled(
  svc: SettingsCore,
  enabled: boolean,
): Promise<void> {
  if (enabled) await svc.delete(SETTING_KEYS.WOWHEAD_RESOLVER_ENABLED);
  else await svc.set(SETTING_KEYS.WOWHEAD_RESOLVER_ENABLED, 'false');
}
