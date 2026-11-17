/**
 * Back button on the reschedule role step (ROK-2228): re-renders the
 * reschedule character list in place, with the same prefix and suffix.
 */
import type { ButtonInteraction } from 'discord.js';
import { RESCHEDULE_BUTTON_IDS } from '../discord-bot.constants';
import { showCharacterSelect } from '../utils/signup-dropdown-builders';
import {
  parseCharacterBackId,
  type CharacterBackTarget,
} from '../utils/character-back-id';
import {
  findLinkedUserByDiscordId,
  isDiscordInteractionError,
  lookupRescheduleEvent,
  safeEditReply,
  type RescheduleDeps,
} from './reschedule-response.helpers';
import { resolveCharacters } from './reschedule-confirm.handlers';

/**
 * Claim a reschedule-flow Back click. Returns false when the button is not
 * a Back to the `reschedule_char_select` list.
 */
export function routeRescheduleBack(
  interaction: ButtonInteraction,
  deps: RescheduleDeps,
): boolean {
  const target = parseCharacterBackId(interaction.customId);
  if (target?.charSelectPrefix !== RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT)
    return false;
  // ROK-2228: the route runs detached, so any rejection (a non-expiry
  // deferUpdate failure, a failed error reply) is logged here instead of
  // escaping as an unhandled rejection.
  void handleRescheduleCharacterBack(interaction, target, deps).catch(
    (error: unknown) =>
      deps.logger.error(
        `Reschedule character Back failed for event ${target.eventId}`,
        error,
      ),
  );
  return true;
}

/** Acknowledge the Back click and re-render the character list in place. */
export async function handleRescheduleCharacterBack(
  interaction: ButtonInteraction,
  target: CharacterBackTarget,
  deps: RescheduleDeps,
): Promise<void> {
  try {
    await interaction.deferUpdate();
  } catch (error: unknown) {
    if (isDiscordInteractionError(error)) return;
    throw error;
  }
  try {
    await rerenderCharacterList(interaction, target, deps);
  } catch (error) {
    deps.logger.error(
      `Reschedule character Back error event ${target.eventId}`,
      error,
    );
    await safeEditReply(interaction, {
      content: 'Something went wrong. Please try again.',
      components: [],
    });
  }
}

/** Rebuild the reschedule character list (same query as the first show). */
async function rerenderCharacterList(
  interaction: ButtonInteraction,
  target: CharacterBackTarget,
  deps: RescheduleDeps,
): Promise<void> {
  const user = await findLinkedUserByDiscordId(deps.db, interaction.user.id);
  const event = await lookupRescheduleEvent(deps.db, target.eventId);
  if (!event || event.cancelledAt) {
    const content = event
      ? 'This event has been cancelled.'
      : 'Event not found.';
    await interaction.editReply({ content, components: [] });
    return;
  }
  const chars = user ? await resolveCharacters(deps, event, user) : null;
  if (!chars || chars.characters.length === 0) {
    const content = 'No characters to pick from. Please try again.';
    await interaction.editReply({ content, components: [] });
    return;
  }
  await showCharacterSelect(interaction, {
    customIdPrefix: RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT,
    eventId: event.id,
    eventTitle: event.title,
    characters: chars.characters,
    emojiService: deps.emojiService,
    customIdSuffix: target.suffix,
  });
}
