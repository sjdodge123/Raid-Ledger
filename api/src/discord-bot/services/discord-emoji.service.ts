import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as fs from 'fs';
import * as path from 'path';
import { GuildPremiumTier } from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { SETTING_KEYS, type SettingKey } from '../../drizzle/schema';

/** Prefix for all Raid Ledger custom emojis to avoid collisions. */
const EMOJI_PREFIX = 'rl_';

/** Role definitions with their emoji name, asset file, and setting key. */
const ROLE_EMOJI_DEFS = [
  {
    role: 'tank',
    name: `${EMOJI_PREFIX}tank`,
    file: 'tank.png',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_TANK,
  },
  {
    role: 'healer',
    name: `${EMOJI_PREFIX}healer`,
    file: 'healer.png',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_HEALER,
  },
  {
    role: 'dps',
    name: `${EMOJI_PREFIX}dps`,
    file: 'dps.png',
    settingKey: SETTING_KEYS.DISCORD_EMOJI_DPS,
  },
] as const;

/** Unicode fallbacks when custom emojis are unavailable. */
const UNICODE_FALLBACK: Record<string, string> = {
  tank: '\uD83D\uDEE1\uFE0F',
  healer: '\uD83D\uDC9A',
  dps: '\u2694\uFE0F',
};

@Injectable()
export class DiscordEmojiService {
  private readonly logger = new Logger(DiscordEmojiService.name);

  /** In-memory cache: role -> formatted emoji string (e.g. <:rl_tank:123456>) */
  private emojiCache = new Map<string, string>();

  /** Whether custom emojis are available (false = fallback to Unicode). */
  private customEmojisAvailable = false;

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * On bot connect, ensure role emojis are uploaded and cached.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async onBotConnected(): Promise<void> {
    try {
      await this.syncRoleEmojis();
    } catch (error) {
      this.logger.warn(
        'Failed to sync role emojis, falling back to Unicode: %s',
        error instanceof Error ? error.message : 'Unknown error',
      );
      this.customEmojisAvailable = false;
    }
  }

  /**
   * Clear cache on disconnect.
   */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.emojiCache.clear();
    this.customEmojisAvailable = false;
  }

  /**
   * Get the emoji string for a role. Returns custom Discord emoji format
   * if available, otherwise falls back to Unicode.
   */
  getRoleEmoji(role: string): string {
    if (this.customEmojisAvailable) {
      const cached = this.emojiCache.get(role);
      if (cached) return cached;
    }
    return UNICODE_FALLBACK[role] ?? '';
  }

  /**
   * Check if custom emojis are being used (vs Unicode fallback).
   */
  isUsingCustomEmojis(): boolean {
    return this.customEmojisAvailable;
  }

  /**
   * Sync role emojis: check existing guild emojis, upload missing ones,
   * cache the emoji IDs in app_settings.
   */
  private async syncRoleEmojis(): Promise<void> {
    const client = this.clientService.getClient();
    if (!client?.isReady()) return;

    const guild = client.guilds.cache.first();
    if (!guild) {
      this.logger.warn('No guild available for emoji sync');
      return;
    }

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
    const needed = ROLE_EMOJI_DEFS.length;

    if (currentCount + needed > emojiLimit) {
      this.logger.warn(
        `Guild has ${currentCount}/${emojiLimit} emoji slots. ` +
          `Need ${needed} for role icons. Falling back to Unicode.`,
      );
      return;
    }

    // Fetch fresh emoji list
    await guild.emojis.fetch();

    const assetsDir = path.resolve(__dirname, '../../../assets/role-icons');

    let allSynced = true;

    for (const def of ROLE_EMOJI_DEFS) {
      try {
        const emojiStr = await this.syncSingleEmoji(
          guild,
          def.name,
          path.join(assetsDir, def.file),
          def.settingKey,
        );

        if (emojiStr) {
          this.emojiCache.set(def.role, emojiStr);
        } else {
          allSynced = false;
        }
      } catch (error) {
        this.logger.warn(
          'Failed to sync emoji %s: %s',
          def.name,
          error instanceof Error ? error.message : 'Unknown error',
        );
        allSynced = false;
      }
    }

    this.customEmojisAvailable = allSynced;

    if (allSynced) {
      this.logger.log('All role emojis synced successfully');
    } else {
      this.logger.warn(
        'Some role emojis failed to sync, using Unicode fallback for missing',
      );
    }
  }

  /**
   * Sync a single emoji: check if it already exists in the guild,
   * otherwise upload it. Returns the formatted emoji string.
   */
  private async syncSingleEmoji(
    guild: import('discord.js').Guild,
    emojiName: string,
    filePath: string,
    settingKey: SettingKey,
  ): Promise<string | null> {
    // Check if we already have a cached ID in settings
    const cachedId = await this.settingsService.get(settingKey);

    if (cachedId) {
      // Verify the emoji still exists in the guild
      const existing = guild.emojis.cache.get(cachedId);
      if (existing) {
        return `<:${existing.name}:${existing.id}>`;
      }
      // Cached ID is stale, clear it
      this.logger.debug('Cached emoji ID %s is stale, re-uploading', cachedId);
    }

    // Check if emoji already exists by name (maybe uploaded manually)
    const existingByName = guild.emojis.cache.find((e) => e.name === emojiName);
    if (existingByName) {
      await this.settingsService.set(settingKey, existingByName.id);
      return `<:${existingByName.name}:${existingByName.id}>`;
    }

    // Upload new emoji
    if (!fs.existsSync(filePath)) {
      this.logger.error('Role icon file not found: %s', filePath);
      return null;
    }

    const attachment = fs.readFileSync(filePath);
    const emoji = await guild.emojis.create({
      attachment,
      name: emojiName,
      reason: 'Raid Ledger role icon',
    });

    this.logger.log('Uploaded custom emoji: %s (ID: %s)', emoji.name, emoji.id);

    // Cache the ID in settings
    await this.settingsService.set(settingKey, emoji.id);

    return `<:${emoji.name}:${emoji.id}>`;
  }
}
