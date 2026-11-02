import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import { hubLinkButton, type HubLink } from '../embeds/hub-link-button.helpers';
import { SERIES_BUTTON_IDS } from '../series-signup/series-signup.constants';

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
  appendLinkButtons(row, eventId, clientUrl || process.env.CLIENT_URL, hubLink);
  return row;
}

/** `View Event` (when a base URL is known), then `Hub` (when one resolved). */
function appendLinkButtons(
  row: ActionRowBuilder<ButtonBuilder>,
  eventId: number,
  baseUrl: string | undefined,
  hubLink: HubLink | null | undefined,
): void {
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
}

/**
 * ROK-1728 (D8, §8 Q2 option a): the SECOND action row on a series embed,
 * holding only a blurple `Join Series` button (`series_join:<eventId>`).
 * Row 1 is already full (5) on hub-linked events, so it cannot go there.
 */
export function buildSeriesJoinRow(
  eventId: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SERIES_BUTTON_IDS.JOIN}:${eventId}`)
      .setLabel('Join Series')
      .setStyle(ButtonStyle.Primary),
  );
}
