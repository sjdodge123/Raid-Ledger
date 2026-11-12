import { Injectable } from '@nestjs/common';
import type { Guild } from 'discord.js';
import type { GgMascotOptionsDto } from '@raid-ledger/contract';
import { DiscordBotClientService } from '../../../../discord-bot/discord-bot-client.service';
import { GgMascotExpressionSource } from './gg-mascot-options.service';

/**
 * ROK-2187 — reads the bot's guild custom emojis and soundboard sounds via
 * the existing bot client (no new intent: both need guild membership only).
 * Isolated so specs stub one method instead of a discord.js `Guild`.
 */

/** Discord CDN origin for the emoji / soundboard copies and previews. */
export const DISCORD_CDN = 'https://cdn.discordapp.com';

/** Emoji CDN URL — static WebP, animated GIF. */
export function emojiCdnUrl(id: string, animated: boolean): string {
  return `${DISCORD_CDN}/emojis/${id}.${animated ? 'gif' : 'webp'}`;
}

/** Soundboard sound CDN URL (MP3 or Ogg; Discord picks). */
export function soundCdnUrl(id: string): string {
  return `${DISCORD_CDN}/soundboard-sounds/${id}`;
}

const clip = (s: string): string => s.slice(0, 64);

async function fetchEmojis(guild: Guild): Promise<GgMascotOptionsDto['emojis']> {
  const emojis = await guild.emojis.fetch();
  return [...emojis.values()].flatMap((e) => {
    if (!e.name || e.available === false) return [];
    const animated = e.animated === true;
    return [{ id: e.id, name: clip(e.name), animated, previewUrl: emojiCdnUrl(e.id, animated) }];
  });
}

async function fetchSounds(guild: Guild): Promise<GgMascotOptionsDto['sounds']> {
  const sounds = await guild.soundboardSounds.fetch();
  return [...sounds.values()].map((s) => ({
    id: String(s.soundId),
    name: clip(s.name),
    volume: Math.min(1, Math.max(0, s.volume)),
    available: s.available,
    emojiName: s.emoji?.name ? clip(s.emoji.name) : null,
  }));
}

@Injectable()
export class GgMascotDiscordSource extends GgMascotExpressionSource {
  constructor(private readonly bot: DiscordBotClientService) {
    super();
  }

  /** The guild's selectable emojis + sounds; `null` while the bot is offline. */
  async fetchExpressions(): Promise<GgMascotOptionsDto | null> {
    const guild = this.bot.getGuild();
    if (!guild) return null;
    const [emojis, sounds] = await Promise.all([fetchEmojis(guild), fetchSounds(guild)]);
    return { emojis, sounds };
  }
}
