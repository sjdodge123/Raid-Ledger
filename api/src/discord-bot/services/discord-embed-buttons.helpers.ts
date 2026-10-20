import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import { hubLinkButton, type HubLink } from '../embeds/hub-link-button.helpers';

/**
 * Build the standard signup action row (Sign Up, Tentative, Decline, View
 * Event), plus a trailing `Hub` link button when a hub link resolved (D16).
 */
export function buildSignupButtons(
  eventId: number,
  clientUrl?: string | null,
  hubLink?: HubLink | null,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`)
      .setLabel('Sign Up')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.TENTATIVE}:${eventId}`)
      .setLabel('Tentative')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.DECLINE}:${eventId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );
  const baseUrl = clientUrl || process.env.CLIENT_URL;
  if (baseUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('View Event')
        .setStyle(ButtonStyle.Link)
        .setURL(`${baseUrl}/events/${eventId}`),
    );
  }
  const hub = hubLinkButton(hubLink);
  if (hub) row.addComponents(hub);
  return row;
}
