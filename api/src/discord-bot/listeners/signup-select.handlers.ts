import type { StringSelectMenuInteraction } from 'discord.js';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import { safeEditReply } from './signup-interaction.helpers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import {
  parseRoleValues,
  handleLinkedRoleSelect,
  handleUnlinkedRoleSelect,
} from './signup-select-role.handlers';
import { handleCharacterSelectMenu } from './signup-select-character.handlers';

/**
 * Route select menu interactions to the correct handler.
 */
export async function handleSelectMenuInteraction(
  interaction: StringSelectMenuInteraction,
  deps: SignupInteractionDeps,
): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts.length < 2 || parts.length > 4) return;

  const [action, eventIdStr] = parts;
  const eventId = parseInt(eventIdStr, 10);
  if (isNaN(eventId)) return;

  if (action === SIGNUP_BUTTON_IDS.ROLE_SELECT) {
    const { characterId, signupStatus } = parseRoleSelectParts(parts);
    await handleRoleSelectMenu(
      interaction,
      eventId,
      deps,
      characterId,
      signupStatus,
    );
  } else if (action === SIGNUP_BUTTON_IDS.CHARACTER_SELECT) {
    const signupStatus =
      parts.length === 3 && parts[2] === 'tentative' ? 'tentative' : undefined;
    await handleCharacterSelectMenu(interaction, eventId, deps, signupStatus);
  }
}

/**
 * Parse optional characterId and signupStatus from role_select customId parts.
 */
function parseRoleSelectParts(parts: string[]): {
  characterId?: string;
  signupStatus?: 'tentative';
} {
  let characterId: string | undefined;
  let signupStatus: 'tentative' | undefined;

  if (parts.length === 3) {
    if (parts[2] === 'tentative') {
      signupStatus = 'tentative';
    } else {
      characterId = parts[2];
    }
  } else if (parts.length === 4) {
    characterId = parts[2];
    signupStatus = parts[3] === 'tentative' ? 'tentative' : undefined;
  }

  return { characterId, signupStatus };
}

/**
 * Handle role selection for signup flows.
 */
async function handleRoleSelectMenu(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  characterId?: string,
  signupStatus?: 'tentative',
): Promise<void> {
  await interaction.deferUpdate();
  const roleCtx = parseRoleValues(interaction);

  try {
    if (characterId) {
      await handleLinkedRoleSelect({
        interaction,
        eventId,
        deps,
        characterId,
        roleCtx,
        signupStatus,
      });
    } else {
      await handleUnlinkedRoleSelect(
        interaction,
        eventId,
        deps,
        roleCtx,
        signupStatus,
      );
    }
  } catch (error) {
    deps.logger.error(
      `Error handling role select for event ${eventId}:`,
      error,
    );
    await safeEditReply(
      interaction,
      { content: 'Something went wrong. Please try again.', components: [] },
      deps.logger,
    );
  }
}
