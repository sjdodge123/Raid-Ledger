/**
 * Structured DM embed builder for subscribed_game notifications (ROK-845).
 * Mirrors the channel embed layout from discord-embed.factory.ts.
 */
import { EmbedBuilder } from 'discord.js';
import { formatDurationMs } from '../discord-bot/utils/format-duration';
import { toStr } from './notification-embed.helpers';

/** Override the embed description with structured game-affinity lines. */
export function applySubscribedGameEmbed(
  embed: EmbedBuilder,
  payload: Record<string, unknown>,
): void {
  const lines: string[] = [];
  if (payload.gameName) lines.push(`🎮 **${toStr(payload.gameName)}**`);
  if (payload.startTime) {
    const unix = Math.floor(
      new Date(toStr(payload.startTime)).getTime() / 1000,
    );
    const dur = computeDurationSuffix(payload.startTime, payload.endTime);
    lines.push(`📆 <t:${unix}:f> (<t:${unix}:R>)${dur}`);
  }
  if (payload.voiceChannelId)
    lines.push(`🔊 <#${toStr(payload.voiceChannelId)}>`);
  if (lines.length > 0) embed.setDescription(lines.join('\n'));
  if (typeof payload.gameCoverUrl === 'string' && payload.gameCoverUrl)
    embed.setThumbnail(payload.gameCoverUrl);
}

function computeDurationSuffix(start: unknown, end: unknown): string {
  if (!start || !end) return '';
  const ms = new Date(toStr(end)).getTime() - new Date(toStr(start)).getTime();
  if (ms <= 0) return '';
  return ` (${formatDurationMs(ms)})`;
}
