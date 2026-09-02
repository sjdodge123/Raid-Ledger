import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { EmbedEventData } from './discord-embed.factory';
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
  const totalMax =
    (sc.tank ?? 0) + (sc.healer ?? 0) + (sc.dps ?? 0) + (sc.flex ?? 0);
  const sections = buildRoleSections(sc, event.roleCounts ?? {}, emojiService);

  const lines: string[] = [`── ROSTER: ${event.signupCount}/${totalMax} ──`];
  appendSectionLines(lines, sections, mentions, emojiService);
  return lines.join('\n');
}

function appendSectionLines(
  lines: string[],
  sections: RoleSection[],
  mentions: NonNullable<EmbedEventData['signupMentions']>,
  emojiService: DiscordEmojiService,
): void {
  sections.forEach((section, idx) => {
    if (idx > 0) lines.push('');
    lines.push(
      `${section.emoji} **${section.label}** (${section.count}/${section.max}):`,
    );
    lines.push(
      getMentionsForRole(mentions, section.role, emojiService) || '\u2003—',
    );
  });
}

interface RoleSection {
  emoji: string;
  label: string;
  count: number;
  max: number;
  role: string;
}

function buildRoleSections(
  sc: NonNullable<EmbedEventData['slotConfig']>,
  rc: Record<string, number>,
  emojiService: DiscordEmojiService,
): RoleSection[] {
  const defs: Array<[string, string, number]> = [
    ['tank', 'Tanks', sc.tank ?? 0],
    ['healer', 'Healers', sc.healer ?? 0],
    ['dps', 'DPS', sc.dps ?? 0],
  ];
  return defs
    .filter(([, , max]) => max > 0)
    .map(([role, label, max]) => ({
      emoji: emojiService.getRoleEmoji(role),
      label,
      count: rc[role] ?? 0,
      max,
      role,
    }));
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
    runningLate?: boolean | null;
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
    runningLate?: boolean | null;
  },
  emojiService: DiscordEmojiService,
): string {
  const rawLabel = m.discordId ? `<@${m.discordId}>` : (m.username ?? '???');
  const label = m.status === 'left' ? `~~${rawLabel}~~` : rawLabel;
  const tentativePrefix = m.status === 'tentative' ? '\u23F3 ' : '';
  // Running late is additive \u2014 composes with \u23F3 and never strikes through.
  const latePrefix = m.runningLate ? '\u23F0 ' : '';
  const classEmoji = m.className ? emojiService.getClassEmoji(m.className) : '';
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
  const prefix = [tentativePrefix, latePrefix, classEmoji]
    .filter(Boolean)
    .join('');
  const suffix = roleEmojis ? ` ${roleEmojis}` : '';
  return `\u2003${prefix}${prefix ? ' ' : ''}${label}${suffix}`;
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
