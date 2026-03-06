import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { EMBED_COLORS } from '../discord-bot.constants';
import type { EmbedEventData, EmbedContext } from './discord-embed.factory';
import type { DiscordEmojiService } from './discord-emoji.service';

/** Max number of individual mentions before truncating. */
const MAX_MENTIONS = 25;

/**
 * Build the roster breakdown line for the embed.
 */
export function buildRosterLine(
  event: EmbedEventData,
  emojiService: DiscordEmojiService,
): string | null {
  const slotConfig = event.slotConfig;
  const mentions = event.signupMentions ?? [];

  if (slotConfig && slotConfig.type === 'mmo') {
    return buildMmoRoster(event, mentions, emojiService);
  }

  if (event.maxAttendees) {
    const allMentions = getMentionsForRole(mentions, null, emojiService);
    const header = `── ROSTER: ${event.signupCount}/${event.maxAttendees} ──`;
    return allMentions ? `${header}\n${allMentions}` : header;
  }

  if (event.signupCount > 0) {
    const allMentions = getMentionsForRole(mentions, null, emojiService);
    const header = `── ROSTER: ${event.signupCount} signed up ──`;
    return allMentions ? `${header}\n${allMentions}` : header;
  }

  return null;
}

/** Build MMO role-based roster section. */
function buildMmoRoster(
  event: EmbedEventData,
  mentions: NonNullable<EmbedEventData['signupMentions']>,
  emojiService: DiscordEmojiService,
): string {
  const sc = event.slotConfig!;
  const tankMax = sc.tank ?? 0;
  const healerMax = sc.healer ?? 0;
  const dpsMax = sc.dps ?? 0;
  const totalMax = tankMax + healerMax + dpsMax + (sc.flex ?? 0);
  const rc = event.roleCounts ?? {};

  const lines: string[] = [];
  lines.push(`── ROSTER: ${event.signupCount}/${totalMax} ──`);

  const sections = buildRoleSections(
    tankMax, healerMax, dpsMax, rc, emojiService,
  );

  sections.forEach((section, idx) => {
    if (idx > 0) lines.push('');
    lines.push(
      `${section.emoji} **${section.label}** (${section.count}/${section.max}):`,
    );
    const playerLines = getMentionsForRole(
      mentions, section.role, emojiService,
    );
    lines.push(playerLines || '\u2003—');
  });

  return lines.join('\n');
}

interface RoleSection {
  emoji: string;
  label: string;
  count: number;
  max: number;
  role: string;
}

function buildRoleSections(
  tankMax: number,
  healerMax: number,
  dpsMax: number,
  rc: Record<string, number>,
  emojiService: DiscordEmojiService,
): RoleSection[] {
  const sections: RoleSection[] = [];
  if (tankMax > 0) {
    sections.push({
      emoji: emojiService.getRoleEmoji('tank'),
      label: 'Tanks', count: rc['tank'] ?? 0, max: tankMax, role: 'tank',
    });
  }
  if (healerMax > 0) {
    sections.push({
      emoji: emojiService.getRoleEmoji('healer'),
      label: 'Healers', count: rc['healer'] ?? 0, max: healerMax, role: 'healer',
    });
  }
  if (dpsMax > 0) {
    sections.push({
      emoji: emojiService.getRoleEmoji('dps'),
      label: 'DPS', count: rc['dps'] ?? 0, max: dpsMax, role: 'dps',
    });
  }
  return sections;
}

/**
 * Format Discord mentions for a specific role (or all).
 */
export function getMentionsForRole(
  mentions: Array<{
    discordId?: string | null;
    username?: string | null;
    role: string | null;
    preferredRoles: string[] | null;
    status?: string | null;
    className?: string | null;
  }>,
  role: string | null,
  emojiService: DiscordEmojiService,
): string {
  const filtered =
    role !== null ? mentions.filter((m) => m.role === role) : mentions;
  const overflow = filtered.length - MAX_MENTIONS;
  const displayed = filtered.slice(0, MAX_MENTIONS);

  const result = displayed
    .map((m) => formatMentionLine(m, emojiService))
    .join('\n');
  return overflow > 0 ? `${result}\n\u2003+ ${overflow} more` : result;
}

/** Format a single mention line with class emoji, name, and role emojis. */
function formatMentionLine(
  m: {
    discordId?: string | null;
    username?: string | null;
    role: string | null;
    preferredRoles: string[] | null;
    status?: string | null;
    className?: string | null;
  },
  emojiService: DiscordEmojiService,
): string {
  const label = m.discordId ? `<@${m.discordId}>` : (m.username ?? '???');
  const tentativePrefix = m.status === 'tentative' ? '\u23F3 ' : '';
  const classEmoji = m.className
    ? emojiService.getClassEmoji(m.className)
    : '';
  const prefs =
    m.preferredRoles && m.preferredRoles.length > 0
      ? m.preferredRoles
      : m.role
        ? [m.role]
        : [];
  const roleEmojis = prefs
    .map((r) => emojiService.getRoleEmoji(r))
    .filter(Boolean)
    .join('');
  const prefix = [tentativePrefix, classEmoji].filter(Boolean).join('');
  const suffix = roleEmojis ? ` ${roleEmojis}` : '';
  return `\u2003${prefix}${prefix ? ' ' : ''}${label}${suffix}`;
}

/**
 * Build an ad-hoc update embed (player join/leave batched).
 */
export function buildAdHocUpdateEmbed(
  event: { id: number; title: string; gameName?: string },
  participants: Array<{
    discordUserId: string;
    discordUsername: string;
    isActive: boolean;
  }>,
  context: EmbedContext,
): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
  const active = participants.filter((p) => p.isActive);
  const left = participants.filter((p) => !p.isActive);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.LIVE_EVENT)
    .setTitle(`\uD83C\uDFAE ${event.title}`)
    .setDescription(
      `**Status:** LIVE` +
        (event.gameName ? `\n**Game:** ${event.gameName}` : ''),
    )
    .addFields({
      name: `\uD83D\uDC65 Active (${active.length})`,
      value:
        active.map((p) => `<@${p.discordUserId}>`).join(', ') || 'None',
    });

  if (left.length > 0) {
    embed.addFields({
      name: `\uD83D\uDCE4 Left (${left.length})`,
      value: left.map((p) => `~~<@${p.discordUserId}>~~`).join(', '),
    });
  }

  embed.setTimestamp().setFooter({
    text: context.communityName ?? 'Raid Ledger',
  });

  const row = buildViewButton(event.id, context.clientUrl);
  return row ? { embed, row } : { embed };
}

/**
 * Build ad-hoc completed embed.
 */
export function buildAdHocCompletedEmbed(
  event: {
    id: number;
    title: string;
    gameName?: string;
    startTime: string;
    endTime: string;
  },
  participants: Array<{
    discordUserId: string;
    discordUsername: string;
    totalDurationSeconds: number | null;
  }>,
  context: EmbedContext,
): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
  const durationStr =
    durationMin >= 60
      ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
      : `${durationMin}m`;

  const rosterLines = participants.map((p) => {
    const dur = p.totalDurationSeconds
      ? ` (${Math.round(p.totalDurationSeconds / 60)}m)`
      : '';
    return `<@${p.discordUserId}>${dur}`;
  });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.SYSTEM)
    .setTitle(`\u2705 ${event.title} \u2014 Completed`)
    .setDescription(
      `Session ended after **${durationStr}**` +
        (event.gameName ? `\n**Game:** ${event.gameName}` : ''),
    )
    .addFields({
      name: `\uD83D\uDC65 Participants (${participants.length})`,
      value: rosterLines.join('\n') || 'None',
    })
    .setTimestamp()
    .setFooter({ text: context.communityName ?? 'Raid Ledger' });

  const row = buildViewButton(event.id, context.clientUrl);
  return row ? { embed, row } : { embed };
}

/**
 * Build a standalone "View Event" link button.
 */
export function buildViewButton(
  eventId: number,
  clientUrl?: string | null,
): ActionRowBuilder<ButtonBuilder> | undefined {
  const baseUrl = clientUrl || process.env.CLIENT_URL;
  if (!baseUrl) return undefined;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('View Event')
      .setStyle(ButtonStyle.Link)
      .setURL(`${baseUrl}/events/${eventId}`),
  );
}
