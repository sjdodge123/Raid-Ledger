/**
 * Signup-flow wrappers around the shared character/role dropdown builders.
 * Moved out of signup-signup.handlers.ts for file size (ROK-2294), where they
 * gained the "Don't see your character? Import it" link button.
 */
import type {
  ButtonInteraction,
  EmbedBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import type { CharacterDto } from '@raid-ledger/contract';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import {
  showCharacterSelect as sharedShowCharacterSelect,
  showRoleSelect as sharedShowRoleSelect,
} from '../utils/signup-dropdown-builders';
import { resolveCharacterImportUrl } from '../utils/character-import-link.helpers';
import type { SignupInteractionDeps } from './signup-interaction.types';

type WrapperDeps = Pick<SignupInteractionDeps, 'emojiService' | 'settingsService'>;

/**
 * Opt-in for the import link on a role step: pass it only on a
 * zero-character path (the member has no character to pick).
 */
export type ImportLinkFor = { gameId: number | null };

/** Wrapper for shared character select dropdown (always offers import). */
export async function showCharacterSelect(
  interaction: ButtonInteraction,
  eventId: number,
  eventTitle: string,
  characters: CharacterDto[],
  deps: WrapperDeps,
  signupStatus?: 'tentative',
  embed?: EmbedBuilder,
  gameId?: number | null,
): Promise<void> {
  await sharedShowCharacterSelect(interaction, {
    customIdPrefix: SIGNUP_BUTTON_IDS.CHARACTER_SELECT,
    eventId,
    eventTitle,
    characters,
    emojiService: deps.emojiService,
    customIdSuffix: signupStatus,
    embed,
    importUrl: await resolveCharacterImportUrl(deps.settingsService, gameId),
  });
}

/** Wrapper for shared role select dropdown. */
export async function showRoleSelect(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  eventId: number,
  deps: WrapperDeps,
  characterId?: string,
  characterInfo?: { name: string; role: string | null },
  signupStatus?: 'tentative',
  embed?: EmbedBuilder,
  importFor?: ImportLinkFor,
): Promise<void> {
  const importUrl = importFor
    ? await resolveCharacterImportUrl(deps.settingsService, importFor.gameId)
    : undefined;
  await sharedShowRoleSelect(interaction, {
    customIdPrefix: SIGNUP_BUTTON_IDS.ROLE_SELECT,
    eventId,
    emojiService: deps.emojiService,
    characterId,
    characterInfo,
    customIdSuffix: signupStatus,
    embed,
    importUrl,
  });
}
