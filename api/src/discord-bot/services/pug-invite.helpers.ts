import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type * as schema from '../../drizzle/schema';
import {
  EMBED_COLORS,
  PUG_BUTTON_IDS,
  MEMBER_INVITE_BUTTON_IDS,
} from '../discord-bot.constants';

/** Format a date/time for invite embeds. */
function formatEventTime(
  startDate: Date,
  timezone: string,
): { dateStr: string; timeStr: string } {
  const dateStr = startDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  });
  const timeStr = startDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: timezone,
  });
  return { dateStr, timeStr };
}

/** Build description lines shared between invite embeds. */
function buildInviteDescLines(
  event: typeof schema.events.$inferSelect,
  eventId: number,
  timezone: string,
  clientUrl: string | null,
): string[] {
  const { dateStr, timeStr } = formatEventTime(event.duration[0], timezone);
  return [
    `**${event.title}**`,
    `\uD83D\uDCC5 ${dateStr} at ${timeStr}`,
    '',
    clientUrl
      ? `\uD83D\uDCCE [Event details](${clientUrl}/events/${eventId})`
      : '',
  ].filter(Boolean);
}

/** Add optional voice channel field to an embed. */
function addVoiceField(
  embed: EmbedBuilder,
  voiceChannelId: string | null,
): void {
  if (voiceChannelId) {
    embed.addFields({
      name: 'Voice Channel',
      value: `<#${voiceChannelId}>`,
      inline: true,
    });
  }
}

/**
 * Build the PUG invite DM embed.
 */
export function buildPugInviteEmbed(
  pugSlotId: string,
  eventId: number,
  event: typeof schema.events.$inferSelect,
  communityName: string,
  clientUrl: string | null,
  timezone: string,
  voiceChannelId: string | null,
): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const descLines = buildInviteDescLines(event, eventId, timezone, clientUrl);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.PUG_INVITE)
    .setTitle(`You've been invited to a raid!`)
    .setDescription(descLines.join('\n'))
    .setFooter({ text: communityName })
    .setTimestamp();

  addVoiceField(embed, voiceChannelId);
  if (clientUrl) {
    embed.addFields({
      name: '\u200b',
      value: `\uD83D\uDCAC Join ${communityName} on [Raid Ledger](${clientUrl})`,
    });
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PUG_BUTTON_IDS.ACCEPT}:${pugSlotId}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${PUG_BUTTON_IDS.DECLINE}:${pugSlotId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );
  return { embed, row };
}

/**
 * Build the member invite DM embed (ROK-292).
 */
export function buildMemberInviteEmbed(
  eventId: number,
  notificationId: string,
  event: typeof schema.events.$inferSelect,
  communityName: string,
  clientUrl: string | null,
  timezone: string,
  voiceChannelId: string | null,
): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const descLines = buildInviteDescLines(event, eventId, timezone, clientUrl);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.PUG_INVITE)
    .setTitle(`You've been invited to an event!`)
    .setDescription(descLines.join('\n'))
    .setFooter({ text: communityName })
    .setTimestamp();

  addVoiceField(embed, voiceChannelId);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `${MEMBER_INVITE_BUTTON_IDS.ACCEPT}:${eventId}:${notificationId}`,
      )
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(
        `${MEMBER_INVITE_BUTTON_IDS.DECLINE}:${eventId}:${notificationId}`,
      )
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );
  return { embed, row };
}

/**
 * Build the server invite relay DM embed for the PUG creator.
 */
export function buildInviteRelayEmbed(
  pugUsername: string,
  inviteUrl: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.PUG_INVITE)
    .setTitle('Server Invite Needed')
    .setDescription(
      [
        `**${pugUsername}** isn't in the server yet.`,
        `Share this invite link with them:`,
        '',
        inviteUrl,
        '',
        `Once they join, they'll automatically receive the raid invite.`,
      ].join('\n'),
    )
    .setTimestamp();
}
