/**
 * Reschedule role step after a character pick (ROK-2228 split from
 * reschedule-roster.handlers.ts for file size).
 */
import type { StringSelectMenuInteraction } from 'discord.js';
import { RESCHEDULE_BUTTON_IDS } from '../discord-bot.constants';
import { showRoleSelect } from '../utils/signup-dropdown-builders';
import { buildCharacterBackId } from '../utils/character-back-id';
import type { EventRow, RescheduleDeps } from './reschedule-response.helpers';

/**
 * Show the MMO role menu for the picked character, with a Back button to
 * the reschedule character list it came from.
 */
export async function showRescheduleRoleForCharacter(
  deps: RescheduleDeps,
  interaction: StringSelectMenuInteraction,
  event: EventRow,
  linkedUser: { id: number },
  characterId: string,
  signupStatus: 'tentative' | undefined,
): Promise<void> {
  const isTentative = signupStatus === 'tentative';
  const character = await deps.charactersService.findOne(
    linkedUser.id,
    characterId,
  );
  await showRoleSelect(interaction, {
    customIdPrefix: RESCHEDULE_BUTTON_IDS.ROLE_SELECT,
    eventId: event.id,
    emojiService: deps.emojiService,
    characterId,
    characterInfo: {
      name: character.name,
      role: character.roleOverride ?? character.role ?? null,
    },
    characterVerb: isTentative ? 'Tentative as' : 'Confirming as',
    customIdSuffix: isTentative ? 'tentative' : undefined,
    // ROK-2228: Back re-renders the reschedule character list.
    backCustomId: buildCharacterBackId({
      charSelectPrefix: RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT,
      eventId: event.id,
      suffix: signupStatus,
    }),
  });
}
