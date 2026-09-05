/**
 * ROK-1477 (Lane C, D7) — the departure-grace "Slot Vacated" DM card.
 *
 * Extracted from `departure-grace.helpers.ts` (293/300 counted) so the chrome
 * migration has room to land without breaching the file cap. The extraction
 * itself is behaviour-neutral; the migration onto `createDmEmbed` is the
 * commit that follows it.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DEPARTURE_PROMOTE_BUTTON_IDS } from '../discord-bot.constants';
import { createDmEmbed, type DmEmbed } from '../embeds/embed-chrome.helpers';
import { NOTIFICATION_DM_AUTHORS } from '../../notifications/notification-embed.helpers';

/**
 * Build the DM card telling an event creator that a slot opened up.
 *
 * @param departedName - Display name of the member who left.
 * @param vacatedRole - Role of the slot they vacated.
 * @param vacatedPosition - Position index of the vacated slot.
 * @param eventTitle - Title of the event the slot belongs to.
 * @param communityName - Community branding for the author + footer.
 * @returns The card, ready for `sendEmbedDM`.
 */
export function buildDepartureEmbed(
  departedName: string,
  vacatedRole: string,
  vacatedPosition: number,
  eventTitle: string,
  communityName?: string | null,
): DmEmbed {
  return createDmEmbed({
    state: 'needs_you',
    authorLine: NOTIFICATION_DM_AUTHORS.SLOT_VACATED,
    communityName,
  })
    .setTitle('Slot Vacated')
    .setDescription(
      `**${departedName}** departed from the **${vacatedRole}** slot (position ${vacatedPosition}) in **${eventTitle}**.\n\nWould you like to promote a bench player to fill it?`,
    );
}

/**
 * Build the promote / dismiss action row for the departure card.
 *
 * @param eventId - Event the vacated slot belongs to.
 * @param vacatedRole - Role of the vacated slot, encoded into the custom id.
 * @param vacatedPosition - Position of the vacated slot, encoded likewise.
 * @returns A single action row with the promote and dismiss buttons.
 */
export function buildPromoteButtons(
  eventId: number,
  vacatedRole: string,
  vacatedPosition: number,
): ActionRowBuilder<ButtonBuilder> {
  const base = `${eventId}:${vacatedRole}:${vacatedPosition}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:${base}`)
      .setLabel('Promote from Bench')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${DEPARTURE_PROMOTE_BUTTON_IDS.DISMISS}:${base}`)
      .setLabel('Leave Empty')
      .setStyle(ButtonStyle.Secondary),
  );
}
