/**
 * Back button on the series role step (ROK-2228): re-renders the series
 * character list in place. The role step is the same ephemeral the Join
 * Series button opened, so Back acknowledges with `deferUpdate` and reuses
 * the series flow's own first step (`showNextStep` with no picks).
 */
import type { ButtonInteraction } from 'discord.js';
import { errorMessage } from '../../common/error-format.helpers';
import { SERIES_BUTTON_IDS } from '../series-signup/series-signup.constants';
import {
  parseCharacterBackId,
  type CharacterBackTarget,
} from '../utils/character-back-id';
import {
  fetchEvent,
  findLinkedUser,
  isDiscordInteractionError,
  safeEditReply,
} from './signup-interaction.helpers';
import {
  replyLinkAccount,
  type SeriesInteraction,
  type SeriesInteractionDeps,
} from './series-signup-interaction.handlers';
import { NO_PICKS, showNextStep } from './series-signup-interaction.steps';

/**
 * Claim a series-flow Back click. Returns false when the interaction is not
 * a Back button to the `series_char` list (the caller routes it instead).
 */
export function routeSeriesBack(
  interaction: SeriesInteraction,
  deps: SeriesInteractionDeps,
): boolean {
  if (!interaction.isButton()) return false;
  const target = parseCharacterBackId(interaction.customId);
  if (target?.charSelectPrefix !== SERIES_BUTTON_IDS.CHARACTER) return false;
  void handleSeriesCharacterBack(interaction, target, deps);
  return true;
}

/** Acknowledge the Back click and re-render the series character list. */
export async function handleSeriesCharacterBack(
  interaction: ButtonInteraction,
  target: CharacterBackTarget,
  deps: SeriesInteractionDeps,
): Promise<void> {
  try {
    await interaction.deferUpdate();
  } catch (error: unknown) {
    if (!isDiscordInteractionError(error))
      deps.logger.warn(`Failed to defer series Back: ${errorMessage(error)}`);
    return;
  }
  try {
    await rerenderCharacterList(interaction, target.eventId, deps);
  } catch (error: unknown) {
    deps.logger.error(
      `Series character Back failed for event ${target.eventId}`,
      error,
    );
    await safeEditReply(
      interaction,
      { content: 'Something went wrong. Please try again.', components: [] },
      deps.logger,
    );
  }
}

/** Same first step the Join Series button showed, with no picks carried. */
async function rerenderCharacterList(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SeriesInteractionDeps,
): Promise<void> {
  const user = await findLinkedUser(interaction.user.id, deps);
  if (!user) return replyLinkAccount(interaction, eventId);
  const event = await fetchEvent(eventId, deps);
  if (!event) {
    await interaction.editReply({
      content: 'Event not found.',
      components: [],
    });
    return;
  }
  await showNextStep(interaction, event, user.id, NO_PICKS, deps);
}
