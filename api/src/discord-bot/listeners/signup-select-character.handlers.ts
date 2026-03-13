import type { StringSelectMenuInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { showRoleSelect } from './signup-signup.handlers';
import { findLinkedUser, safeEditReply } from './signup-interaction.helpers';
import { replyNoLinkedAccount } from './signup-select-role.handlers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import { benchSuffix } from './signup-bench-feedback.helpers';
import { derivePreferredRoles } from './signup-role-derive.helpers';
import { buildReplyEmbed } from './signup-reply-embed.helpers';

/**
 * Handle character selection for linked users.
 */
export async function handleCharacterSelectMenu(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  signupStatus?: 'tentative',
): Promise<void> {
  await interaction.deferUpdate();

  try {
    await processCharacterSelect(interaction, eventId, deps, signupStatus);
  } catch (error) {
    deps.logger.error(
      `Error handling character select for event ${eventId}:`,
      error,
    );
    await safeEditReply(
      interaction,
      { content: 'Something went wrong. Please try again.', components: [] },
      deps.logger,
    );
  }
}

async function processCharacterSelect(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  signupStatus?: 'tentative',
): Promise<void> {
  const characterId = interaction.values[0];
  const linkedUser = await findLinkedUser(interaction.user.id, deps);

  if (!linkedUser) {
    await replyNoLinkedAccount(interaction);
    return;
  }

  const redirected = await tryMmoRoleRedirect(
    interaction,
    eventId,
    deps,
    linkedUser.id,
    characterId,
    signupStatus,
  );
  if (redirected) return;

  await signupWithCharacterDirect(
    interaction,
    eventId,
    deps,
    linkedUser.id,
    characterId,
    signupStatus,
  );
}

/** If event is MMO, redirect to role select. Returns true if handled. */
async function tryMmoRoleRedirect(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  userId: number,
  characterId: string,
  signupStatus?: 'tentative',
): Promise<boolean> {
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  const slotConfig = event?.slotConfig as Record<string, unknown> | null;
  if (!slotConfig || slotConfig.type !== 'mmo') return false;
  await showRoleSelectForCharacter(
    interaction,
    eventId,
    deps,
    userId,
    characterId,
    signupStatus,
  );
  return true;
}

/** Build character info and show role select with event embed. */
async function showRoleSelectForCharacter(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  userId: number,
  characterId: string,
  signupStatus?: 'tentative',
): Promise<void> {
  const character = await deps.charactersService.findOne(userId, characterId);
  const charInfo = {
    name: character.name,
    role: character.roleOverride ?? character.role ?? null,
  };
  const embed = await buildReplyEmbed(eventId, deps);
  await showRoleSelect(
    interaction,
    eventId,
    deps,
    characterId,
    charInfo,
    signupStatus,
    embed,
  );
}

/** Non-MMO character signup: sign up and confirm immediately. */
async function signupWithCharacterDirect(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  userId: number,
  characterId: string,
  signupStatus?: 'tentative',
): Promise<void> {
  const character = await deps.charactersService.findOne(userId, characterId);
  const preferred = derivePreferredRoles(character);
  const signupResult = await deps.signupsService.signup(
    eventId,
    userId,
    ...(preferred ? ([{ preferredRoles: preferred }] as const) : []),
  );
  await deps.signupsService.confirmSignup(eventId, signupResult.id, userId, {
    characterId,
  });
  if (signupStatus === 'tentative') {
    await deps.signupsService.updateStatus(
      eventId,
      { userId },
      { status: 'tentative' },
    );
  }
  const bench = benchSuffix(signupResult.assignedSlot);

  await interaction.editReply({
    content:
      signupStatus === 'tentative'
        ? `You're marked as **tentative** with **${character.name}**.`
        : `Signed up as **${character.name}**!${bench}`,
    components: [],
  });
  await deps.updateEmbedSignupCount(eventId);
}
