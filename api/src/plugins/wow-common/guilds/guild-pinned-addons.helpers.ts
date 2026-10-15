import { Logger } from '@nestjs/common';
import { PinnedAddonListSchema, type PinnedAddon } from '@raid-ledger/contract';
import {
  SETTING_KEYS,
  type SettingKey,
} from '../../../drizzle/schema/app-settings';

type SettingGetter = (key: SettingKey) => Promise<string | null>;

const logger = new Logger('GuildPinnedAddons');

/** Seeded default: the LedgerLink addon, pinned on every guild page. */
export const DEFAULT_PINNED_ADDONS: readonly PinnedAddon[] = [
  {
    name: 'LedgerLink',
    url: 'https://github.com/sjdodge123/ledger-link',
    note: 'Exports your roster, characters and raid pulls to Raid Ledger.',
    requirement: 'required',
    flavors: [],
  },
];

function fallback(): PinnedAddon[] {
  return DEFAULT_PINNED_ADDONS.map((a) => ({ ...a, flavors: [...a.flavors] }));
}

/**
 * Parse the stored `guild_pinned_addons` value. Unset ⇒ the LedgerLink
 * default; `[]` ⇒ no pinned addons (an admin removed them on purpose);
 * malformed JSON or a schema miss ⇒ the default, with a warning.
 */
export function parsePinnedAddons(raw: string | null): PinnedAddon[] {
  if (raw === null || raw.trim() === '') return fallback();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    logger.warn('guild_pinned_addons is not valid JSON; using the default');
    return fallback();
  }
  const parsed = PinnedAddonListSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('guild_pinned_addons failed validation; using the default');
    return fallback();
  }
  return parsed.data;
}

/** Typed reader: pass `settingsService.get.bind(settingsService)`. */
export async function readPinnedAddons(
  get: SettingGetter,
): Promise<PinnedAddon[]> {
  return parsePinnedAddons(await get(SETTING_KEYS.GUILD_PINNED_ADDONS));
}
