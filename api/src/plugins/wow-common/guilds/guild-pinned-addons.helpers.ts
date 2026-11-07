import { Logger } from '@nestjs/common';
import { PinnedAddonListSchema, type PinnedAddon } from '@raid-ledger/contract';
import {
  SETTING_KEYS,
  type SettingKey,
} from '../../../drizzle/schema/app-settings';

type SettingGetter = (key: SettingKey) => Promise<string | null>;

const logger = new Logger('GuildPinnedAddons');

const LEDGERLINK_CURSEFORGE_URL =
  'https://www.curseforge.com/wow/addons/ledger-link';

/** The pre-ROK-2134 LedgerLink link, any case, optional `www.` / trailing slash. */
const LEDGERLINK_GITHUB_URL =
  /^https?:\/\/(www\.)?github\.com\/sjdodge123\/ledger-link\/?$/i;

/**
 * Seeded defaults, pinned on every guild page: LedgerLink (required) and
 * Mailworthy (optional), both linked to CurseForge (ROK-2134).
 */
export const DEFAULT_PINNED_ADDONS: readonly PinnedAddon[] = [
  {
    name: 'LedgerLink',
    url: LEDGERLINK_CURSEFORGE_URL,
    note: 'Exports your roster, characters and raid pulls to Raid Ledger.',
    requirement: 'required',
    flavors: [],
    // ROK-2147 D4 — UNVERIFIED: confirm against the addon's `.toc` folder.
    folderName: 'LedgerLink',
  },
  {
    name: 'Mailworthy',
    url: 'https://www.curseforge.com/wow/addons/mailworthy',
    note: 'Mails bag items worth more at auction or disenchanted to your bank alt at the mailbox.',
    requirement: 'optional',
    flavors: ['forever'],
  },
];

/** A stored entry still pointing at LedgerLink's old GitHub link reads as CurseForge. */
function upgradeLegacyUrl(addon: PinnedAddon): PinnedAddon {
  return LEDGERLINK_GITHUB_URL.test(addon.url.trim())
    ? { ...addon, url: LEDGERLINK_CURSEFORGE_URL }
    : addon;
}

function fallback(): PinnedAddon[] {
  return DEFAULT_PINNED_ADDONS.map((a) => ({ ...a, flavors: [...a.flavors] }));
}

/**
 * Parse the stored `guild_pinned_addons` value. Unset ⇒ the defaults;
 * `[]` ⇒ no pinned addons (an admin removed them on purpose);
 * malformed JSON or a schema miss ⇒ the default, with a warning. A stored
 * old LedgerLink GitHub url is upgraded to CurseForge on read; a stored list
 * is otherwise returned as saved (no default is injected into it).
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
  return parsed.data.map(upgradeLegacyUrl);
}

/** Typed reader: pass `settingsService.get.bind(settingsService)`. */
export async function readPinnedAddons(
  get: SettingGetter,
): Promise<PinnedAddon[]> {
  return parsePinnedAddons(await get(SETTING_KEYS.GUILD_PINNED_ADDONS));
}
