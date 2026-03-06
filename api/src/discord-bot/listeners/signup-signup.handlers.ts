import type { ButtonInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import {
  showCharacterSelect as sharedShowCharacterSelect,
  showRoleSelect as sharedShowRoleSelect,
} from '../utils/signup-dropdown-builders';
import type { SignupInteractionDeps } from './signup-interaction.types';

/**
 * Handle the Sign Up button click for an existing signup (re-activation or character change).
 */
export async function handleExistingSignup(
  interaction: ButtonInteraction,
  eventId: number,
  existingSignup: NonNullable<
    Awaited<ReturnType<SignupInteractionDeps['signupsService']['findByDiscordUser']>>
  >,
  deps: SignupInteractionDeps,
): Promise<void> {
  const wasReactivated = existingSignup.status !== 'signed_up';
  if (wasReactivated) {
    await deps.signupsService.updateStatus(
      eventId,
      existingSignup.discordUserId
        ? { discordUserId: existingSignup.discordUserId }
        : { userId: existingSignup.user.id },
      { status: 'signed_up' },
    );
    await deps.updateEmbedSignupCount(eventId);
  }

  const [linkedUser] = await deps.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, interaction.user.id))
    .limit(1);

  if (!linkedUser) {
    await interaction.editReply({
      content:
        "You're already signed up! Use the Tentative or Decline buttons to change your status.",
    });
    return;
  }

  const handled = await offerCharacterRoleChange(
    interaction,
    eventId,
    linkedUser,
    existingSignup,
    deps,
  );

  if (!handled) {
    await interaction.editReply({
      content: wasReactivated
        ? 'Your status has been changed to **signed up**!'
        : "You're already signed up! Use the Tentative or Decline buttons to change your status.",
    });
  }
}

/**
 * Offer character/role selection for a linked user's existing signup.
 * Returns true if a selection UI was shown.
 */
async function offerCharacterRoleChange(
  interaction: ButtonInteraction,
  eventId: number,
  linkedUser: typeof schema.users.$inferSelect,
  existingSignup: NonNullable<
    Awaited<ReturnType<SignupInteractionDeps['signupsService']['findByDiscordUser']>>
  >,
  deps: SignupInteractionDeps,
): Promise<boolean> {
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);

  if (!event) {
    await interaction.editReply({ content: 'Event not found.' });
    return true;
  }

  if (!event.gameId) return false;

  const [game] = await deps.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, event.gameId))
    .limit(1);

  if (!game) return false;

  const characterList = await deps.charactersService.findAllForUser(
    linkedUser.id,
    event.gameId,
  );
  const characters = characterList.data;
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  const isMMO = slotConfig?.type === 'mmo';

  if (characters.length >= 1) {
    if (!existingSignup.characterId) {
      await showCharacterSelect(interaction, eventId, event.title, characters, deps);
      return true;
    }
    if (isMMO && !existingSignup.character?.role) {
      const currentChar = characters.find((c) => c.id === existingSignup.characterId);
      await showRoleSelect(interaction, eventId, deps, existingSignup.characterId, currentChar
        ? { name: currentChar.name, role: currentChar.roleOverride ?? currentChar.role ?? null }
        : undefined);
      return true;
    }
    await showCharacterSelect(interaction, eventId, event.title, characters, deps);
    return true;
  }

  if (isMMO) {
    await showRoleSelect(interaction, eventId, deps);
    return true;
  }

  return false;
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
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);

  if (!event) {
    await interaction.editReply({ content: 'Event not found.' });
    return;
  }

  if (event.gameId) {
    const handled = await tryGameSignupFlow(
      interaction, eventId, linkedUser, event, deps,
    );
    if (handled) return;
  }

  await deps.signupsService.signup(eventId, linkedUser.id);
  await interaction.editReply({
    content: `You're signed up for **${event.title}**!`,
  });
  await deps.updateEmbedSignupCount(eventId);
}

/**
 * Try game-specific signup flow (character/role). Returns true if handled.
 */
async function tryGameSignupFlow(
  interaction: ButtonInteraction,
  eventId: number,
  linkedUser: typeof schema.users.$inferSelect,
  event: typeof schema.events.$inferSelect,
  deps: SignupInteractionDeps,
): Promise<boolean> {
  const [game] = await deps.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, event.gameId!))
    .limit(1);

  if (!game) return false;

  const characterList = await deps.charactersService.findAllForUser(
    linkedUser.id, event.gameId!,
  );
  const characters = characterList.data;
  const slotConfig = event.slotConfig as Record<string, unknown> | null;

  if (slotConfig?.type === 'mmo' && characters.length >= 1) {
    await showCharacterSelect(interaction, eventId, event.title, characters, deps);
    return true;
  }

  if (characters.length > 1) {
    await showCharacterSelect(interaction, eventId, event.title, characters, deps);
    return true;
  }

  if (characters.length === 1) {
    const char = characters[0];
    const signupResult = await deps.signupsService.signup(eventId, linkedUser.id);
    await deps.signupsService.confirmSignup(eventId, signupResult.id, linkedUser.id, { characterId: char.id });
    await interaction.editReply({ content: `Signed up as **${char.name}**!` });
    await deps.updateEmbedSignupCount(eventId);
    return true;
  }

  if (slotConfig?.type === 'mmo') {
    await showRoleSelect(interaction, eventId, deps);
    return true;
  }

  await deps.signupsService.signup(eventId, linkedUser.id);
  const clientUrl = process.env.CLIENT_URL ?? '';
  let nudge = '';
  if (game.hasRoles && clientUrl) {
    nudge = `\nTip: Create a character at ${clientUrl}/profile to get assigned to a role next time.`;
  }
  await interaction.editReply({
    content: `You're signed up for **${event.title}**!${nudge}`,
  });
  await deps.updateEmbedSignupCount(eventId);
  return true;
}

/** Wrapper for shared character select dropdown. */
async function showCharacterSelect(
  interaction: ButtonInteraction,
  eventId: number,
  eventTitle: string,
  characters: import('@raid-ledger/contract').CharacterDto[],
  deps: Pick<SignupInteractionDeps, 'emojiService'>,
  signupStatus?: 'tentative',
): Promise<void> {
  await sharedShowCharacterSelect(interaction, {
    customIdPrefix: SIGNUP_BUTTON_IDS.CHARACTER_SELECT,
    eventId,
    eventTitle,
    characters,
    emojiService: deps.emojiService,
    customIdSuffix: signupStatus,
  });
}

/** Wrapper for shared role select dropdown. */
export async function showRoleSelect(
  interaction: ButtonInteraction | import('discord.js').StringSelectMenuInteraction,
  eventId: number,
  deps: Pick<SignupInteractionDeps, 'emojiService'>,
  characterId?: string,
  characterInfo?: { name: string; role: string | null },
  signupStatus?: 'tentative',
): Promise<void> {
  await sharedShowRoleSelect(interaction, {
    customIdPrefix: SIGNUP_BUTTON_IDS.ROLE_SELECT,
    eventId,
    emojiService: deps.emojiService,
    characterId,
    characterInfo,
    customIdSuffix: signupStatus,
  });
}
