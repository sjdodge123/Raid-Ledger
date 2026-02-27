import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DiscordAPIError, GuildPremiumTier, PermissionsBitField } from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { SETTING_KEYS, type SettingKey } from '../../drizzle/schema';

/** Prefix for all Raid Ledger custom emojis to avoid collisions. */
const EMOJI_PREFIX = 'rl_';

interface EmojiDef {
  key: string;
  name: string;
  file: string;
  assetsSubdir: string;
  settingKey: SettingKey;
}

/** Role definitions with their emoji name, asset file, and setting key. */
const ROLE_EMOJI_DEFS: EmojiDef[] = [
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

/** Class definitions: maps WoW class name → emoji def */
const CLASS_EMOJI_DEFS: EmojiDef[] = [
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
const UNICODE_FALLBACK: Record<string, string> = {
  tank: '\uD83D\uDEE1\uFE0F',
  healer: '\uD83D\uDC9A',
  dps: '\u2694\uFE0F',
};

/** Extract detailed diagnostic info from a Discord API error. */
function formatDiscordError(error: unknown): string {
  if (error instanceof DiscordAPIError) {
    return (
      `DiscordAPIError: ${error.message} ` +
      `(code=${String(error.code)}, status=${String(error.status)}, ` +
      `method=${error.method}, url=${error.url})`
    );
  }
  return error instanceof Error ? error.message : 'Unknown error';
}

@Injectable()
export class DiscordEmojiService {
  private readonly logger = new Logger(DiscordEmojiService.name);

  /** In-memory cache: key -> formatted emoji string (e.g. <:rl_tank:123456>) */
  private emojiCache = new Map<string, string>();

  /** Whether role custom emojis are available (false = fallback to Unicode). */
  private roleEmojisAvailable = false;

  /** Whether class custom emojis are available. */
  private classEmojisAvailable = false;

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * On bot connect, ensure role and class emojis are uploaded and cached.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async onBotConnected(): Promise<void> {
    try {
      await this.syncAllEmojis();
    } catch (error) {
      this.logger.warn(
        'Failed to sync emojis, falling back to Unicode: %s',
        error instanceof Error ? error.message : 'Unknown error',
      );
      this.roleEmojisAvailable = false;
      this.classEmojisAvailable = false;
    }
  }

  /**
   * Clear cache on disconnect.
   */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.emojiCache.clear();
    this.roleEmojisAvailable = false;
    this.classEmojisAvailable = false;
  }

  /**
   * Get the emoji string for a role. Returns custom Discord emoji format
   * if available, otherwise falls back to Unicode.
   */
  getRoleEmoji(role: string): string {
    if (this.roleEmojisAvailable) {
      const cached = this.emojiCache.get(role);
      if (cached) return cached;
    }
    return UNICODE_FALLBACK[role] ?? '';
  }

  /**
   * Get the emoji string for a WoW class name (e.g. "Warrior", "Death Knight").
   * Returns custom Discord emoji format if available, otherwise empty string.
   */
  getClassEmoji(className: string): string {
    if (this.classEmojisAvailable) {
      const cached = this.emojiCache.get(className);
      if (cached) return cached;
    }
    return '';
  }

  /**
   * Get emoji component data for a role, suitable for select menu options.
   * Returns `{ id, name }` for custom emojis or `{ name }` for Unicode fallback.
   */
  getRoleEmojiComponent(
    role: string,
  ): { id?: string; name: string } | undefined {
    if (this.roleEmojisAvailable) {
      const parsed = this.parseEmojiString(this.emojiCache.get(role));
      if (parsed) return parsed;
    }
    const fallback = UNICODE_FALLBACK[role];
    return fallback ? { name: fallback } : undefined;
  }

  /**
   * Get emoji component data for a WoW class, suitable for select menu options.
   * Returns `{ id, name }` for custom emojis, or undefined if unavailable.
   */
  getClassEmojiComponent(
    className: string,
  ): { id?: string; name: string } | undefined {
    if (this.classEmojisAvailable) {
      return this.parseEmojiString(this.emojiCache.get(className));
    }
    return undefined;
  }

  /**
   * Check if custom role emojis are being used (vs Unicode fallback).
   */
  isUsingCustomEmojis(): boolean {
    return this.roleEmojisAvailable;
  }

  /** Parse a `<:name:id>` formatted emoji string into component data. */
  private parseEmojiString(
    str: string | undefined,
  ): { id: string; name: string } | undefined {
    if (!str) return undefined;
    const match = str.match(/^<:(\w+):(\d+)>$/);
    return match ? { name: match[1], id: match[2] } : undefined;
  }

  /**
   * Sync all emojis: role icons + class icons.
   * Checks guild capacity before uploading. Role icons are prioritized;
   * class icons are best-effort (won't prevent role emojis on failure).
   * Public so it can be triggered from admin API for diagnostics.
   */
  async syncAllEmojis(): Promise<void> {
    const client = this.clientService.getClient();
    if (!client?.isReady()) return;

    const guild = client.guilds.cache.first();
    if (!guild) {
      this.logger.warn('No guild available for emoji sync');
      return;
    }

    // Force-refresh the bot's guild member to pick up permission changes
    // made after the bot connected (guild.members.me is cached from login).
    try {
      await guild.members.fetchMe({ force: true });
    } catch {
      this.logger.warn('Could not refresh bot member data, using cached permissions');
    }

    // Diagnostic: log guild info and bot permissions at sync time (DEBUG only)
    const me = guild.members.me;
    const hasManageExpressions = me?.permissions.has(
      PermissionsBitField.Flags.ManageGuildExpressions,
    );
    const hasCreateExpressions = me?.permissions.has(
      PermissionsBitField.Flags.CreateGuildExpressions,
    );
    const permBits = me?.permissions.bitfield.toString();
    this.logger.debug(
      `Emoji sync starting — guild=${guild.name} (${guild.id}), ` +
        `me=${me?.user.tag ?? 'null'}, ` +
        `ManageGuildExpressions=${String(hasManageExpressions)}, ` +
        `CreateGuildExpressions=${String(hasCreateExpressions)}, ` +
        `permBits=${permBits ?? 'null'}`,
    );

    // Check guild emoji capacity
    const emojiLimit =
      guild.premiumTier === GuildPremiumTier.None
        ? 50
        : guild.premiumTier === GuildPremiumTier.Tier1
          ? 100
          : guild.premiumTier === GuildPremiumTier.Tier2
            ? 150
            : 250;
    const currentCount = guild.emojis.cache.filter((e) => !e.animated).size;
    const roleNeeded = ROLE_EMOJI_DEFS.length;

    if (currentCount + roleNeeded > emojiLimit) {
      this.logger.warn(
        `Guild has ${currentCount}/${emojiLimit} emoji slots. ` +
          `Need ${roleNeeded} for role icons. Falling back to Unicode.`,
      );
      return;
    }

    // Fetch fresh emoji list
    await guild.emojis.fetch();

    const assetsBase = path.resolve(__dirname, '../../../../assets');

    // Sync role emojis first
    let allRolesSynced = true;
    for (const def of ROLE_EMOJI_DEFS) {
      try {
        const emojiStr = await this.syncSingleEmoji(
          guild,
          def.name,
          path.join(assetsBase, def.assetsSubdir, def.file),
          def.settingKey,
        );

        if (emojiStr) {
          this.emojiCache.set(def.key, emojiStr);
        } else {
          allRolesSynced = false;
        }
      } catch (error) {
        this.logger.warn(
          'Failed to sync emoji %s: %s',
          def.name,
          formatDiscordError(error),
        );
        allRolesSynced = false;
      }
    }

    this.roleEmojisAvailable = allRolesSynced;

    if (allRolesSynced) {
      this.logger.log('All role emojis synced successfully');
    } else {
      this.logger.warn(
        'Some role emojis failed to sync, using Unicode fallback for missing',
      );
    }

    // Sync class emojis (best-effort, won't affect role emoji status)
    const currentCountAfterRoles = guild.emojis.cache.filter(
      (e) => !e.animated,
    ).size;
    if (currentCountAfterRoles + CLASS_EMOJI_DEFS.length > emojiLimit) {
      this.logger.warn(
        `Guild has ${currentCountAfterRoles}/${emojiLimit} emoji slots after role sync. ` +
          `Need ${CLASS_EMOJI_DEFS.length} more for class icons. Skipping class emojis.`,
      );
      return;
    }

    let allClassesSynced = true;
    for (const def of CLASS_EMOJI_DEFS) {
      try {
        const emojiStr = await this.syncSingleEmoji(
          guild,
          def.name,
          path.join(assetsBase, def.assetsSubdir, def.file),
          def.settingKey,
        );

        if (emojiStr) {
          this.emojiCache.set(def.key, emojiStr);
        } else {
          allClassesSynced = false;
        }
      } catch (error) {
        this.logger.warn(
          'Failed to sync class emoji %s: %s',
          def.name,
          formatDiscordError(error),
        );
        allClassesSynced = false;
      }
    }

    this.classEmojisAvailable = allClassesSynced;

    if (allClassesSynced) {
      this.logger.log('All class emojis synced successfully');
    } else {
      this.logger.warn('Some class emojis failed to sync');
    }
  }

  /** Compute MD5 hash of a file for change detection. */
  private fileHash(filePath: string): string {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buf).digest('hex');
  }

  /**
   * Sync a single emoji: check if it already exists in the guild,
   * otherwise upload it. Detects changed asset files and re-uploads.
   * Returns the formatted emoji string.
   */
  private async syncSingleEmoji(
    guild: import('discord.js').Guild,
    emojiName: string,
    filePath: string,
    settingKey: SettingKey,
  ): Promise<string | null> {
    if (!fs.existsSync(filePath)) {
      this.logger.error('Icon file not found: %s', filePath);
      return null;
    }

    const currentHash = this.fileHash(filePath);

    // Check if we already have a cached ID in settings
    const cachedRaw = await this.settingsService.get(settingKey);
    // Settings may store "emojiId:hash" or just "emojiId" (legacy)
    const [cachedId, cachedHash] = cachedRaw?.includes(':')
      ? cachedRaw.split(':')
      : [cachedRaw, null];

    if (cachedId) {
      const existing = guild.emojis.cache.get(cachedId);
      if (existing) {
        if (cachedHash === currentHash) {
          // Emoji exists and file hasn't changed — reuse
          return `<:${existing.name}:${existing.id}>`;
        }
        // File changed — delete old emoji and re-upload
        this.logger.log(
          'Asset changed for %s, replacing emoji (old hash: %s, new: %s)',
          emojiName,
          cachedHash ?? 'none',
          currentHash,
        );
        try {
          await existing.delete('Raid Ledger icon asset updated');
        } catch {
          this.logger.warn(
            'Could not delete stale emoji %s, continuing',
            emojiName,
          );
        }
      }
    }

    // Check if emoji already exists by name (maybe uploaded manually or from old version)
    const existingByName = guild.emojis.cache.find((e) => e.name === emojiName);
    if (existingByName) {
      // Delete old version so we can upload the current asset
      this.logger.log('Replacing existing emoji %s (no hash match)', emojiName);
      try {
        await existingByName.delete('Raid Ledger icon asset updated');
        // Refresh cache after deletion
        await guild.emojis.fetch();
      } catch {
        this.logger.warn('Could not delete existing emoji %s', emojiName);
      }
    }

    // Upload new emoji
    const attachment = fs.readFileSync(filePath);
    const emoji = await guild.emojis.create({
      attachment,
      name: emojiName,
      reason: 'Raid Ledger icon',
    });

    this.logger.log('Uploaded custom emoji: %s (ID: %s)', emoji.name, emoji.id);

    // Cache the ID + hash in settings
    await this.settingsService.set(settingKey, `${emoji.id}:${currentHash}`);

    return `<:${emoji.name}:${emoji.id}>`;
  }
}
