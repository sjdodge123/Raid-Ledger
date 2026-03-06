import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { GuildPremiumTier, PermissionsBitField } from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import type { SettingKey } from '../../drizzle/schema';
import {
  ROLE_EMOJI_DEFS,
  CLASS_EMOJI_DEFS,
  UNICODE_FALLBACK,
  formatDiscordError,
  type EmojiDef,
} from './discord-emoji.constants';

/** Base path for emoji asset files. */
const ASSETS_BASE = path.resolve(__dirname, '../../../../assets');

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
    const guild = this.resolveGuild();
    if (!guild) return;

    await this.refreshBotMember(guild);
    this.logPermissionDiagnostics(guild);

    const emojiLimit = getGuildEmojiLimit(guild);
    const currentCount = guild.emojis.cache.filter((e) => !e.animated).size;

    if (currentCount + ROLE_EMOJI_DEFS.length > emojiLimit) {
      this.logger.warn(
        `Guild has ${currentCount}/${emojiLimit} emoji slots. Falling back to Unicode.`,
      );
      return;
    }

    await guild.emojis.fetch();
    this.roleEmojisAvailable = await this.syncEmojiGroup(
      guild,
      ROLE_EMOJI_DEFS,
    );
    this.logSyncResult('role', this.roleEmojisAvailable);
    await this.syncClassEmojis(guild, emojiLimit);
  }

  /** Sync class emojis if capacity allows. */
  private async syncClassEmojis(
    guild: import('discord.js').Guild,
    emojiLimit: number,
  ): Promise<void> {
    const current = guild.emojis.cache.filter((e) => !e.animated).size;
    if (current + CLASS_EMOJI_DEFS.length > emojiLimit) {
      this.logger.warn(
        `Guild has ${current}/${emojiLimit} slots after role sync. Skipping class emojis.`,
      );
      return;
    }
    this.classEmojisAvailable = await this.syncEmojiGroup(
      guild,
      CLASS_EMOJI_DEFS,
    );
    this.logSyncResult('class', this.classEmojisAvailable);
  }

  /** Sync a group of emoji defs. Returns true if all synced. */
  private async syncEmojiGroup(
    guild: import('discord.js').Guild,
    defs: EmojiDef[],
  ): Promise<boolean> {
    let allSynced = true;
    for (const def of defs) {
      const ok = await this.trySyncDef(guild, def);
      if (!ok) allSynced = false;
    }
    return allSynced;
  }

  /** Try to sync a single emoji def. Returns true on success. */
  private async trySyncDef(
    guild: import('discord.js').Guild,
    def: EmojiDef,
  ): Promise<boolean> {
    try {
      const filePath = path.join(ASSETS_BASE, def.assetsSubdir, def.file);
      const emojiStr = await this.syncSingleEmoji(
        guild,
        def.name,
        filePath,
        def.settingKey,
      );
      if (emojiStr) {
        this.emojiCache.set(def.key, emojiStr);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.warn(
        'Failed to sync emoji %s: %s',
        def.name,
        formatDiscordError(error),
      );
      return false;
    }
  }

  /** Resolve the guild from the client. */
  private resolveGuild(): import('discord.js').Guild | null {
    const client = this.clientService.getClient();
    if (!client?.isReady()) return null;
    const guild = client.guilds.cache.first();
    if (!guild) this.logger.warn('No guild available for emoji sync');
    return guild ?? null;
  }

  /** Force-refresh bot member to pick up permission changes. */
  private async refreshBotMember(
    guild: import('discord.js').Guild,
  ): Promise<void> {
    try {
      await guild.members.fetchMe({ force: true });
    } catch {
      this.logger.warn(
        'Could not refresh bot member data, using cached permissions',
      );
    }
  }

  /** Log guild info and bot permissions at sync time (DEBUG). */
  private logPermissionDiagnostics(guild: import('discord.js').Guild): void {
    const me = guild.members.me;
    const manage = me?.permissions.has(
      PermissionsBitField.Flags.ManageGuildExpressions,
    );
    const create = me?.permissions.has(
      PermissionsBitField.Flags.CreateGuildExpressions,
    );
    this.logger.debug(
      `Emoji sync — guild=${guild.name}, ManageExpr=${String(manage)}, CreateExpr=${String(create)}`,
    );
  }

  /** Log the result of a sync group. */
  private logSyncResult(group: string, allSynced: boolean): void {
    if (allSynced) {
      this.logger.log(`All ${group} emojis synced successfully`);
    } else {
      this.logger.warn(`Some ${group} emojis failed to sync`);
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
    const reused = await this.tryReuseCachedEmoji(
      guild,
      emojiName,
      settingKey,
      currentHash,
    );
    if (reused) return reused;

    await this.deleteExistingByName(guild, emojiName);
    return this.uploadEmoji(
      guild,
      emojiName,
      filePath,
      settingKey,
      currentHash,
    );
  }

  /** Check cached emoji ID; reuse if hash matches, delete if stale. */
  private async tryReuseCachedEmoji(
    guild: import('discord.js').Guild,
    emojiName: string,
    settingKey: SettingKey,
    currentHash: string,
  ): Promise<string | null> {
    const cachedRaw = await this.settingsService.get(settingKey);
    const [cachedId, cachedHash] = cachedRaw?.includes(':')
      ? cachedRaw.split(':')
      : [cachedRaw, null];
    if (!cachedId) return null;
    const existing = guild.emojis.cache.get(cachedId);
    if (!existing) return null;
    if (cachedHash === currentHash) return `<:${existing.name}:${existing.id}>`;
    this.logger.log('Asset changed for %s, replacing emoji', emojiName);
    try {
      await existing.delete('Raid Ledger icon asset updated');
    } catch {
      this.logger.warn('Could not delete stale emoji %s', emojiName);
    }
    return null;
  }

  /** Delete an emoji by name if it exists (manual upload cleanup). */
  private async deleteExistingByName(
    guild: import('discord.js').Guild,
    emojiName: string,
  ): Promise<void> {
    const existing = guild.emojis.cache.find((e) => e.name === emojiName);
    if (!existing) return;
    this.logger.log('Replacing existing emoji %s (no hash match)', emojiName);
    try {
      await existing.delete('Raid Ledger icon asset updated');
      await guild.emojis.fetch();
    } catch {
      this.logger.warn('Could not delete existing emoji %s', emojiName);
    }
  }

  /** Upload a new emoji and persist its ID + hash. */
  private async uploadEmoji(
    guild: import('discord.js').Guild,
    emojiName: string,
    filePath: string,
    settingKey: SettingKey,
    currentHash: string,
  ): Promise<string> {
    const attachment = fs.readFileSync(filePath);
    const emoji = await guild.emojis.create({
      attachment,
      name: emojiName,
      reason: 'Raid Ledger icon',
    });
    this.logger.log('Uploaded custom emoji: %s (ID: %s)', emoji.name, emoji.id);
    await this.settingsService.set(settingKey, `${emoji.id}:${currentHash}`);
    return `<:${emoji.name}:${emoji.id}>`;
  }
}

/** Get the emoji slot limit based on guild premium tier. */
function getGuildEmojiLimit(guild: import('discord.js').Guild): number {
  if (guild.premiumTier === GuildPremiumTier.None) return 50;
  if (guild.premiumTier === GuildPremiumTier.Tier1) return 100;
  if (guild.premiumTier === GuildPremiumTier.Tier2) return 150;
  return 250;
}
