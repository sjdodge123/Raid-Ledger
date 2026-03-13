import type { ButtonInteraction, EmbedBuilder } from 'discord.js';
import * as schema from '../../drizzle/schema';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import {
  showCharacterSelect as sharedShowCharacterSelect,
  showRoleSelect as sharedShowRoleSelect,
} from '../utils/signup-dropdown-builders';
import { findLinkedUser, fetchEvent } from './signup-interaction.helpers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import { tryGameSignupFlow } from './signup-signup-game.handlers';
import { benchSuffix } from './signup-bench-feedback.helpers';
import { loadGameContext } from './signup-signup-context.helpers';
import type { GameContext } from './signup-signup-context.helpers';
import { buildReplyEmbed } from './signup-reply-embed.helpers';

type ExistingSignup = NonNullable<
  Awaited<
    ReturnType<SignupInteractionDeps['signupsService']['findByDiscordUser']>
  >
>;

/**
 * Handle the Sign Up button click for an existing signup (re-activation or character change).
 */
export async function handleExistingSignup(
  interaction: ButtonInteraction,
  eventId: number,
  existingSignup: ExistingSignup,
  deps: SignupInteractionDeps,
): Promise<void> {
  const wasReactivated = await reactivateIfNeeded(
    eventId,
    existingSignup,
    deps,
  );

  const linkedUser = await findLinkedUser(interaction.user.id, deps);
  if (!linkedUser) {
    await interaction.editReply({ content: alreadySignedUpMessage() });
    return;
  }

  const handled = await offerCharacterRoleChange(
    interaction,
    eventId,
    linkedUser,
    existingSignup,
    deps,
  );
  if (!handled) await replyReactivationResult(interaction, wasReactivated);
}

async function replyReactivationResult(
  interaction: ButtonInteraction,
  wasReactivated: boolean,
): Promise<void> {
  await interaction.editReply({
    content: wasReactivated
      ? 'Your status has been changed to **signed up**!'
      : alreadySignedUpMessage(),
    embeds: [],
  });
}

function alreadySignedUpMessage(): string {
  return "You're already signed up! Use the Tentative or Decline buttons to change your status.";
}

async function reactivateIfNeeded(
  eventId: number,
  existingSignup: ExistingSignup,
  deps: SignupInteractionDeps,
): Promise<boolean> {
  if (existingSignup.status === 'signed_up') return false;
  await deps.signupsService.updateStatus(
    eventId,
    existingSignup.discordUserId
      ? { discordUserId: existingSignup.discordUserId }
      : { userId: existingSignup.user.id },
    { status: 'signed_up' },
  );
  await deps.updateEmbedSignupCount(eventId);
  return true;
}

/**
 * Offer character/role selection for a linked user's existing signup.
 * Returns true if a selection UI was shown.
 */
async function offerCharacterRoleChange(
  interaction: ButtonInteraction,
  eventId: number,
  linkedUser: typeof schema.users.$inferSelect,
  existingSignup: ExistingSignup,
  deps: SignupInteractionDeps,
): Promise<boolean> {
  const ctx = await loadGameContext(eventId, linkedUser.id, deps);
  if (ctx === 'not_found') {
    await interaction.editReply({ content: 'Event not found.' });
    return true;
  }
  if (!ctx) return false;

  return offerSelectionUI(interaction, eventId, ctx, existingSignup, deps);
}

function needsCharacterOrRole(
  existingSignup: ExistingSignup,
  isMMO: boolean,
): boolean {
  return (
    !existingSignup.characterId || (isMMO && !existingSignup.character?.role)
  );
}

async function offerSelectionUI(
  interaction: ButtonInteraction,
  eventId: number,
  ctx: GameContext,
  existingSignup: ExistingSignup,
  deps: SignupInteractionDeps,
): Promise<boolean> {
  const embed = await buildReplyEmbed(eventId, deps);
  if (ctx.characters.length >= 1)
    return offerCharacterSelection(
      interaction,
      eventId,
      ctx,
      existingSignup,
      deps,
      embed,
    );
  if (!ctx.isMMO) return false;
  await showRoleSelect(
    interaction,
    eventId,
    deps,
    undefined,
    undefined,
    undefined,
    embed,
  );
  return true;
}

async function offerCharacterSelection(
  interaction: ButtonInteraction,
  eventId: number,
  ctx: GameContext,
  existingSignup: ExistingSignup,
  deps: SignupInteractionDeps,
  embed?: EmbedBuilder,
): Promise<boolean> {
  if (needsCharacterOrRole(existingSignup, ctx.isMMO))
    return offerCharacterOrRole({
      interaction,
      eventId,
      ctx,
      existingSignup,
      deps,
      embed,
    });

  await showCharacterSelect(
    interaction,
    eventId,
    ctx.eventTitle,
    ctx.characters,
    deps,
    undefined,
    embed,
  );
  return true;
}

function resolveCharacterInfo(
  characters: import('@raid-ledger/contract').CharacterDto[],
  characterId: string,
): { name: string; role: string | null } | undefined {
  const currentChar = characters.find((c) => c.id === characterId);
  if (!currentChar) return undefined;
  return {
    name: currentChar.name,
    role: currentChar.roleOverride ?? currentChar.role ?? null,
  };
}

type CharOrRoleArgs = {
  interaction: ButtonInteraction;
  eventId: number;
  ctx: GameContext;
  existingSignup: ExistingSignup;
  deps: SignupInteractionDeps;
  embed?: EmbedBuilder;
};

async function offerCharacterOrRole(a: CharOrRoleArgs): Promise<boolean> {
  const { interaction, eventId, ctx, existingSignup, deps, embed } = a;
  if (!existingSignup.characterId) {
    await showCharacterSelect(
      interaction,
      eventId,
      ctx.eventTitle,
      ctx.characters,
      deps,
      undefined,
      embed,
    );
    return true;
  }
  const charInfo = resolveCharacterInfo(
    ctx.characters,
    existingSignup.characterId,
  );
  await showRoleSelect(
    interaction,
    eventId,
    deps,
    existingSignup.characterId,
    charInfo,
    undefined,
    embed,
  );
  return true;
}

/**
 * Handle a new signup for a linked user (no prior signup exists).
 */
export async function handleNewLinkedSignup(
  interaction: ButtonInteraction,
  eventId: number,
  linkedUser: typeof schema.users.$inferSelect,
  deps: SignupInteractionDeps,
): Promise<void> {
  const event = await fetchEvent(eventId, deps);
  if (!event) {
    await interaction.editReply({ content: 'Event not found.' });
    return;
  }

  if (event.gameId) {
    const handled = await tryGameSignupFlow({
      interaction,
      eventId,
      linkedUser,
      event,
      deps,
    });
    if (handled) return;
  }

  const result = await deps.signupsService.signup(eventId, linkedUser.id);
  await interaction.editReply({
    content: `You're signed up for **${event.title}**!${benchSuffix(result.assignedSlot)}`,
    embeds: [],
  });
  await deps.updateEmbedSignupCount(eventId);
}

/** Wrapper for shared character select dropdown. */
export async function showCharacterSelect(
  interaction: ButtonInteraction,
  eventId: number,
  eventTitle: string,
  characters: import('@raid-ledger/contract').CharacterDto[],
  deps: Pick<SignupInteractionDeps, 'emojiService'>,
  signupStatus?: 'tentative',
  embed?: EmbedBuilder,
): Promise<void> {
  await sharedShowCharacterSelect(interaction, {
    customIdPrefix: SIGNUP_BUTTON_IDS.CHARACTER_SELECT,
    eventId,
    eventTitle,
    characters,
    emojiService: deps.emojiService,
    customIdSuffix: signupStatus,
    embed,
  });
}

/** Wrapper for shared role select dropdown. */
export async function showRoleSelect(
  interaction:
    | ButtonInteraction
    | import('discord.js').StringSelectMenuInteraction,
  eventId: number,
  deps: Pick<SignupInteractionDeps, 'emojiService'>,
  characterId?: string,
  characterInfo?: { name: string; role: string | null },
  signupStatus?: 'tentative',
  embed?: EmbedBuilder,
): Promise<void> {
  await sharedShowRoleSelect(interaction, {
    customIdPrefix: SIGNUP_BUTTON_IDS.ROLE_SELECT,
    eventId,
    emojiService: deps.emojiService,
    characterId,
    characterInfo,
    customIdSuffix: signupStatus,
    embed,
  });
}
