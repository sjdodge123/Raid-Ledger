/**
 * WoW: Forever classic quest import kill switch (ROK-2143).
 *
 * The admin setting `wow_forever_quest_import` is `'false'` when off; absent
 * means on. The import job checks it at run start and before each request,
 * and the quest read path ignores the Blizzard overlay while it is off, so
 * turning it off is a full rollback without a deploy.
 */
import type { SettingsService } from '../../../settings/settings.service';
import { WOW_FOREVER_QUEST_IMPORT_KEY } from '../forever.settings';

/** 403 copy when an admin has turned the Forever quest import off. */
export const FOREVER_QUEST_IMPORT_OFF_MESSAGE =
  'Quest import for WoW: Forever is turned off';

/** True unless an admin stored exactly `'false'`. */
export async function isForeverQuestImportEnabled(
  settings: Pick<SettingsService, 'get'>,
): Promise<boolean> {
  return (await settings.get(WOW_FOREVER_QUEST_IMPORT_KEY)) !== 'false';
}
