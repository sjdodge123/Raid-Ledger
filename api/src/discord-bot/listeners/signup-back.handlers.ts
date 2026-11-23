/**
 * Back button on the signup role step (ROK-2228): re-renders the character
 * list the role step followed, in place, with the same customId prefix and
 * suffix so a new pick continues the same flow.
 */
import type { ButtonInteraction } from 'discord.js';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import {
  parseCharacterBackId,
  type CharacterBackTarget,
} from '../utils/character-back-id';
import {
  findActiveLinkedUser,
  isDiscordInteractionError,
  safeEditReply,
} from './signup-interaction.helpers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import { loadGameContext } from './signup-signup-context.helpers';
import { buildReplyEmbed } from './signup-reply-embed.helpers';
import { showCharacterSelect } from './signup-select-wrappers';

/**
 * Claim a signup-flow Back click. Returns false when the button is not a
 * Back to the `char_select` list (other flows route their own Back).
 */
export function routeSignupBack(
  interaction: ButtonInteraction,
  deps: SignupInteractionDeps,
): boolean {
  const target = parseCharacterBackId(interaction.customId);
  if (target?.charSelectPrefix !== SIGNUP_BUTTON_IDS.CHARACTER_SELECT)
    return false;
  // ROK-2228: the route runs detached, so any rejection (a non-expiry
  // deferUpdate failure, a failed error reply) is logged here instead of
  // escaping as an unhandled rejection.
  void handleSignupCharacterBack(interaction, target, deps).catch(
    (error: unknown) =>
      deps.logger.error(
        `Signup character Back failed for event ${target.eventId}:`,
        error,
      ),
  );
  return true;
}

/** Acknowledge the Back click and re-render the character list in place. */
export async function handleSignupCharacterBack(
  interaction: ButtonInteraction,
  target: CharacterBackTarget,
  deps: SignupInteractionDeps,
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
      `Error handling character Back for event ${target.eventId}:`,
      error,
    );
    await safeEditReply(
      interaction,
      { content: 'Something went wrong. Please try again.', components: [] },
      deps.logger,
    );
  }
}

/** Rebuild the same character list the signup flow first showed. */
async function rerenderCharacterList(
  interaction: ButtonInteraction,
  target: CharacterBackTarget,
  deps: SignupInteractionDeps,
): Promise<void> {
  const { eventId } = target;
  const ctx = await loadBackContext(interaction, eventId, deps);
  if (ctx === false) return;
  if (ctx === 'not_found' || !ctx || ctx.characters.length === 0) {
    await replyNoCharacterList(interaction, ctx === 'not_found');
    return;
  }
  await showCharacterSelect(
    interaction,
    eventId,
    ctx.eventTitle,
    ctx.characters,
    deps,
    target.suffix === 'tentative' ? 'tentative' : undefined,
    await buildReplyEmbed(eventId, deps),
    ctx.gameId,
  );
}

/** The Back target has no list to show: the event is gone or no characters. */
async function replyNoCharacterList(
  interaction: ButtonInteraction,
  eventMissing: boolean,
): Promise<void> {
  if (eventMissing) {
    await interaction.editReply({
      content: 'Event not found.',
      components: [],
    });
    return;
  }
  const content = 'No characters to pick from. Please sign up again.';
  await interaction.editReply({ content, components: [], embeds: [] });
}

/**
 * The linked user's game context for the Back target, null if unlinked, or
 * false when the account is blocked (ROK-2298: already replied).
 */
async function loadBackContext(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<Awaited<ReturnType<typeof loadGameContext>> | null | false> {
  const linkedUser = await findActiveLinkedUser(interaction, deps);
  if (linkedUser === false) return false;
  return linkedUser ? loadGameContext(eventId, linkedUser.id, deps) : null;
}
