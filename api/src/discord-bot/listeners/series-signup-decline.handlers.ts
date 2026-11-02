import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from 'discord.js';
import { findActiveMembership } from '../../events/series-signups.queries';
import { SERIES_BUTTON_IDS } from '../series-signup/series-signup.constants';
import { findLinkedUser, fetchEvent } from './signup-interaction.helpers';
import { formatLeftReply } from './series-signup-interaction.helpers';
import {
  buildLeaveButton,
  replyLinkAccount,
  replyServiceError,
  type SeriesInteractionDeps,
} from './series-signup-interaction.handlers';

/**
 * AC8 — Decline from a series member: offer "Skip this night" or
 * "Leave series" instead of declining. Returns true when it replied, so
 * `handleDecline` stops; false (no reply) for a non-member.
 */
export async function offerSeriesDeclineChoice(
  interaction: ButtonInteraction,
  eventId: number,
  deps: Pick<SeriesInteractionDeps, 'db'>,
): Promise<boolean> {
  const user = await findLinkedUser(interaction.user.id, deps);
  if (!user) return false;
  const event = await fetchEvent(eventId, deps);
  if (!event?.recurrenceGroupId) return false;
  const member = await findActiveMembership(
    deps.db,
    event.recurrenceGroupId,
    user.id,
  );
  if (!member) return false;
  const skip = new ButtonBuilder()
    .setCustomId(`${SERIES_BUTTON_IDS.SKIP}:${eventId}`)
    .setLabel('Skip this night')
    .setStyle(ButtonStyle.Secondary);
  await interaction.editReply({
    content:
      "You're in for the series. Skip just this night, or leave the series?",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        skip,
        buildLeaveButton(eventId),
      ),
    ],
  });
  return true;
}

/** Skip one night: cancel this event's signup; the membership stays. */
export async function handleSeriesSkip(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SeriesInteractionDeps,
): Promise<void> {
  try {
    await deps.signupsService.cancelByDiscordUser(eventId, interaction.user.id);
    await interaction.editReply({
      content: "Skipped this night. You're still in for the series.",
      components: [],
    });
  } catch (error) {
    await replyServiceError(interaction, error);
  }
}

/** Leave the series: `SeriesSignupsService.leave` + the <23h warning. */
export async function handleSeriesLeave(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SeriesInteractionDeps,
): Promise<void> {
  const user = await findLinkedUser(interaction.user.id, deps);
  if (!user) return replyLinkAccount(interaction, eventId);
  try {
    const res = await deps.seriesSignupsService.leave(eventId, user.id);
    await interaction.editReply({
      content: formatLeftReply(res),
      components: [],
    });
  } catch (error) {
    await replyServiceError(interaction, error);
  }
}
