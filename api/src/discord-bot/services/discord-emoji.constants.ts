import { DiscordAPIError } from 'discord.js';
import { SETTING_KEYS, type SettingKey } from '../../drizzle/schema';

/** Prefix for all Raid Ledger custom emojis to avoid collisions. */
const EMOJI_PREFIX = 'rl_';

export interface EmojiDef {
  key: string;
  name: string;
  file: string;
  assetsSubdir: string;
  settingKey: SettingKey;
}

/** Role definitions with their emoji name, asset file, and setting key. */
export const ROLE_EMOJI_DEFS: EmojiDef[] = [
  {
    key: 'tank',
    name: `${EMOJI_PREFIX}tank`,
    file: 'tank.png',
    assetsSubdir: 'role-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_TANK,
  },
  {
    key: 'healer',
    name: `${EMOJI_PREFIX}healer`,
    file: 'healer.png',
    assetsSubdir: 'role-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_HEALER,
  },
  {
    key: 'dps',
    name: `${EMOJI_PREFIX}dps`,
    file: 'dps.png',
    assetsSubdir: 'role-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_DPS,
  },
];

/** Class definitions: maps WoW class name to emoji def. */
export const CLASS_EMOJI_DEFS: EmojiDef[] = [
  {
    key: 'Warrior',
    name: `${EMOJI_PREFIX}class_warrior`,
    file: 'warrior.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_WARRIOR,
  },
  {
    key: 'Paladin',
    name: `${EMOJI_PREFIX}class_paladin`,
    file: 'paladin.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_PALADIN,
  },
  {
    key: 'Hunter',
    name: `${EMOJI_PREFIX}class_hunter`,
    file: 'hunter.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_HUNTER,
  },
  {
    key: 'Rogue',
    name: `${EMOJI_PREFIX}class_rogue`,
    file: 'rogue.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_ROGUE,
  },
  {
    key: 'Priest',
    name: `${EMOJI_PREFIX}class_priest`,
    file: 'priest.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_PRIEST,
  },
  {
    key: 'Death Knight',
    name: `${EMOJI_PREFIX}class_deathknight`,
    file: 'deathknight.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_DEATHKNIGHT,
  },
  {
    key: 'Shaman',
    name: `${EMOJI_PREFIX}class_shaman`,
    file: 'shaman.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_SHAMAN,
  },
  {
    key: 'Mage',
    name: `${EMOJI_PREFIX}class_mage`,
    file: 'mage.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_MAGE,
  },
  {
    key: 'Warlock',
    name: `${EMOJI_PREFIX}class_warlock`,
    file: 'warlock.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_WARLOCK,
  },
  {
    key: 'Monk',
    name: `${EMOJI_PREFIX}class_monk`,
    file: 'monk.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_MONK,
  },
  {
    key: 'Druid',
    name: `${EMOJI_PREFIX}class_druid`,
    file: 'druid.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_DRUID,
  },
  {
    key: 'Demon Hunter',
    name: `${EMOJI_PREFIX}class_demonhunter`,
    file: 'demonhunter.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_DEMONHUNTER,
  },
  {
    key: 'Evoker',
    name: `${EMOJI_PREFIX}class_evoker`,
    file: 'evoker.png',
    assetsSubdir: 'class-icons',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_CLASS_EVOKER,
  },
];

/** Unicode fallbacks when custom emojis are unavailable. */
export const UNICODE_FALLBACK: Record<string, string> = {
  tank: '\uD83D\uDEE1\uFE0F',
  healer: '\uD83D\uDC9A',
  dps: '\u2694\uFE0F',
};

/** Extract detailed diagnostic info from a Discord API error. */
export function formatDiscordError(error: unknown): string {
  if (error instanceof DiscordAPIError) {
    return (
      `DiscordAPIError: ${error.message} ` +
      `(code=${String(error.code)}, status=${String(error.status)}, ` +
      `method=${error.method}, url=${error.url})`
    );
  }
  return error instanceof Error ? error.message : 'Unknown error';
}
