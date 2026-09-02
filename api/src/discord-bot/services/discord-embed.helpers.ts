import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  formatRoster,
  ROSTER_NAME_CAP,
  type RosterEntry,
} from '../embeds/embed-roster.helpers';
import type { EmbedEventData } from './discord-embed.factory';
import type { DiscordEmojiService } from './discord-emoji.service';

/** One signup as the roster renderer sees it. */
type SignupMention = NonNullable<EmbedEventData['signupMentions']>[number];

/**
 * Build the roster breakdown line for the embed.
 *
 * ROK-1460: renders bold display NAMES, never `<@id>` mentions — a channel
 * embed re-syncs on every signup and must not ping the roster each time. The
 * `ROSTER: n/max` header is gone; the chrome author line carries the count.
 *
 * @param event - The event whose signups are being rendered.
 * @param emojiService - Source of the class / role emoji decorations.
 * @returns The roster block, or null when there is nothing to show.
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

  return getMentionsForRole(mentions, null, emojiService) || null;
}

/** Build the MMO role-based roster: one line per configured role section. */
function buildMmoRoster(
  event: EmbedEventData,
  mentions: NonNullable<EmbedEventData['signupMentions']>,
  emojiService: DiscordEmojiService,
): string {
  const sections = buildRoleSections(
    event.slotConfig!,
    event.roleCounts ?? {},
    emojiService,
  );
  return sections
    .map((section) => {
      const names =
        getMentionsForRole(mentions, section.role, emojiService) || '—';
      const header = `**${section.label}** (${section.count}/${section.max})`;
      return `${section.emoji} ${header}: ${names}`;
    })
    .join('\n');
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
 * Render the signups for a specific role (or all of them) as bold names.
 *
 * @param mentions - The signups to render.
 * @param role - Role to filter on, or null for every signup.
 * @param emojiService - Source of the class / role emoji decorations.
 * @returns e.g. `⏳ **Ana** 🛡️ · ~~**Bo**~~ +1 more`; `''` when empty.
 */
export function getMentionsForRole(
  mentions: SignupMention[],
  role: string | null,
  emojiService: DiscordEmojiService,
): string {
  const filtered =
    role !== null ? mentions.filter((m) => m.role === role) : mentions;
  return formatRoster(
    filtered.map((m) => toRosterEntry(m, emojiService)),
    ROSTER_NAME_CAP,
  );
}

/** Identity for the roster: display name, then username, never the id. */
function rosterName(m: SignupMention): string {
  return m.displayName || m.username || '???';
}

/** The role emoji run that trails a name, e.g. `🛡️⚔️`. */
function roleEmojisFor(
  m: SignupMention,
  emojiService: DiscordEmojiService,
): string {
  const prefs =
    m.preferredRoles && m.preferredRoles.length > 0
      ? m.preferredRoles
      : m.role
        ? [m.role]
        : [];
  return prefs
    .map((r) => emojiService.getRoleEmoji(r))
    .filter(Boolean)
    .join('');
}

/** Turn a signup into the decorated roster entry the formatter renders. */
function toRosterEntry(
  m: SignupMention,
  emojiService: DiscordEmojiService,
): RosterEntry {
  const tentative = m.status === 'tentative' ? '⏳' : '';
  // Running late is additive — composes with ⏳ and never strikes through.
  const late = m.runningLate ? '⏰' : '';
  const classEmoji = m.className ? emojiService.getClassEmoji(m.className) : '';
  const marks = [tentative, late, classEmoji].filter(Boolean).join(' ');
  const roleEmojis = roleEmojisFor(m, emojiService);
  return {
    name: rosterName(m),
    ...(marks ? { prefix: `${marks} ` } : {}),
    ...(roleEmojis ? { suffix: ` ${roleEmojis}` } : {}),
    ...(m.status === 'left' ? { struck: true } : {}),
  };
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
