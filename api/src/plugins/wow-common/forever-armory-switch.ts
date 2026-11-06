/**
 * WoW: Forever Armory import kill switch, enforced server-side (ROK-1722).
 *
 * The admin setting `wow_forever_armory_import` is `'false'` when the switch is
 * off; absent (or a legacy `'true'`) means on. The capabilities payload, the
 * character-preview route, import, refresh and the nightly sync all read it.
 */
import { ForbiddenException } from '@nestjs/common';
import type { SettingsService } from '../../settings/settings.service';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from './forever.settings';

/** 403 copy when an admin has turned Forever Armory import off. */
export const FOREVER_ARMORY_OFF_MESSAGE =
  'Armory import for WoW: Forever is turned off';

/** True unless an admin stored exactly `'false'`. */
export async function isForeverArmoryImportEnabled(
  settings: Pick<SettingsService, 'get'>,
): Promise<boolean> {
  return (await settings.get(WOW_FOREVER_ARMORY_IMPORT_KEY)) !== 'false';
}

/**
 * Variant-aware guard: reads the switch only for WoW: Forever.
 * @throws ForbiddenException {@link FOREVER_ARMORY_OFF_MESSAGE}
 */
export async function assertForeverVariantAllowed(
  settings: Pick<SettingsService, 'get'>,
  variant: string,
): Promise<void> {
  if (variant !== 'wow_forever') return;
  assertForeverArmoryImport(
    variant,
    await isForeverArmoryImportEnabled(settings),
  );
}

/**
 * Refuse a Battle.net call for WoW: Forever while the switch is off.
 * Other variants always pass.
 * @throws ForbiddenException {@link FOREVER_ARMORY_OFF_MESSAGE}
 */
export function assertForeverArmoryImport(
  variant: string | null | undefined,
  enabled: boolean,
): void {
  if (variant === 'wow_forever' && !enabled)
    throw new ForbiddenException(FOREVER_ARMORY_OFF_MESSAGE);
}
