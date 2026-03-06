import type { StringSelectMenuInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import { showRoleSelect } from './signup-signup.handlers';
import { safeEditReply } from './signup-interaction.helpers';
import type { SignupInteractionDeps } from './signup-interaction.types';

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

  const selectedRoles = interaction.values as ('tank' | 'healer' | 'dps')[];
  const primaryRole = selectedRoles[0];
  const rolesLabel = selectedRoles
    .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
    .join(', ');

  try {
    if (characterId) {
      await handleLinkedRoleSelect(
        interaction,
        eventId,
        deps,
        characterId,
        selectedRoles,
        primaryRole,
        rolesLabel,
        signupStatus,
      );
      return;
    }

    await handleUnlinkedRoleSelect(
      interaction,
      eventId,
      deps,
      selectedRoles,
      primaryRole,
      rolesLabel,
      signupStatus,
    );
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

/**
 * Role select for a linked user with a character.
 */
async function handleLinkedRoleSelect(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  characterId: string,
  selectedRoles: ('tank' | 'healer' | 'dps')[],
  primaryRole: string,
  rolesLabel: string,
  signupStatus?: 'tentative',
): Promise<void> {
  const discordUserId = interaction.user.id;
  const [linkedUser] = await deps.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUserId))
    .limit(1);

  if (!linkedUser) {
    await interaction.editReply({
      content: 'Could not find your linked account. Please try again.',
      components: [],
    });
    return;
  }

  const signupResult = await deps.signupsService.signup(
    eventId,
    linkedUser.id,
    selectedRoles.length === 1
      ? {
          slotRole: primaryRole as
            | 'tank'
            | 'healer'
            | 'dps'
            | 'flex'
            | 'player'
            | 'bench',
          preferredRoles: selectedRoles,
        }
      : { preferredRoles: selectedRoles },
  );
  await deps.signupsService.confirmSignup(
    eventId,
    signupResult.id,
    linkedUser.id,
    { characterId },
  );

  if (signupStatus === 'tentative') {
    await deps.signupsService.updateStatus(
      eventId,
      { userId: linkedUser.id },
      { status: 'tentative' },
    );
  }

  const character = await deps.charactersService.findOne(
    linkedUser.id,
    characterId,
  );

  await interaction.editReply({
    content:
      signupStatus === 'tentative'
        ? `You're marked as **tentative** with **${character.name}** (${rolesLabel}).`
        : `Signed up as **${character.name}** (${rolesLabel})!`,
    components: [],
  });
  await deps.updateEmbedSignupCount(eventId);
}

/**
 * Role select for an unlinked user or linked user without character.
 */
async function handleUnlinkedRoleSelect(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  selectedRoles: ('tank' | 'healer' | 'dps')[],
  primaryRole: string,
  rolesLabel: string,
  signupStatus?: 'tentative',
): Promise<void> {
  const discordUserId = interaction.user.id;
  const [linkedUser] = await deps.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUserId))
    .limit(1);

  if (linkedUser) {
    await handleLinkedNoCharRoleSelect(
      interaction,
      eventId,
      deps,
      linkedUser,
      selectedRoles,
      primaryRole,
      rolesLabel,
      signupStatus,
    );
    return;
  }

  // Anonymous user — existing Path B behavior
  await deps.signupsService.signupDiscord(eventId, {
    discordUserId,
    discordUsername: interaction.user.username,
    discordAvatarHash: interaction.user.avatar,
    role:
      selectedRoles.length === 1
        ? (primaryRole as 'tank' | 'healer' | 'dps' | 'flex' | 'player')
        : undefined,
    preferredRoles: selectedRoles,
    status: signupStatus ?? undefined,
  });

  const clientUrl = process.env.CLIENT_URL ?? '';
  const accountLink = clientUrl
    ? `\n[Create an account](${clientUrl}) to manage characters and get reminders.`
    : '';

  await interaction.editReply({
    content:
      signupStatus === 'tentative'
        ? `You're marked as **tentative** (${rolesLabel}).`
        : `You're signed up as **${interaction.user.username}** (${rolesLabel})!${accountLink}`,
    components: [],
  });
  await deps.updateEmbedSignupCount(eventId);
}

/**
 * Role select for linked user without character.
 */
async function handleLinkedNoCharRoleSelect(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  linkedUser: typeof schema.users.$inferSelect,
  selectedRoles: ('tank' | 'healer' | 'dps')[],
  primaryRole: string,
  rolesLabel: string,
  signupStatus?: 'tentative',
): Promise<void> {
  await deps.signupsService.signup(
    eventId,
    linkedUser.id,
    selectedRoles.length === 1
      ? {
          slotRole: primaryRole as
            | 'tank'
            | 'healer'
            | 'dps'
            | 'flex'
            | 'player'
            | 'bench',
          preferredRoles: selectedRoles,
        }
      : { preferredRoles: selectedRoles },
  );

  if (signupStatus === 'tentative') {
    await deps.signupsService.updateStatus(
      eventId,
      { userId: linkedUser.id },
      { status: 'tentative' },
    );
  }

  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);

  const clientUrl = process.env.CLIENT_URL ?? '';
  let nudge = '';
  if (clientUrl) {
    nudge = `\nTip: Create a character at ${clientUrl}/profile to get assigned to a role next time.`;
  }

  await interaction.editReply({
    content:
      signupStatus === 'tentative'
        ? `You're marked as **tentative** for **${event?.title ?? 'the event'}** (${rolesLabel}).`
        : `You're signed up for **${event?.title ?? 'the event'}** (${rolesLabel})!${nudge}`,
    components: [],
  });
  await deps.updateEmbedSignupCount(eventId);
}

/**
 * Handle character selection for linked users.
 */
async function handleCharacterSelectMenu(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  signupStatus?: 'tentative',
): Promise<void> {
  await interaction.deferUpdate();

  const characterId = interaction.values[0];
  const discordUserId = interaction.user.id;

  try {
    const [linkedUser] = await deps.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (!linkedUser) {
      await interaction.editReply({
        content: 'Could not find your linked account. Please try again.',
        components: [],
      });
      return;
    }

    const [event] = await deps.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (event) {
      const slotConfig = event.slotConfig as Record<string, unknown> | null;
      if (slotConfig?.type === 'mmo') {
        const character = await deps.charactersService.findOne(
          linkedUser.id,
          characterId,
        );
        await showRoleSelect(
          interaction,
          eventId,
          deps,
          characterId,
          {
            name: character.name,
            role: character.roleOverride ?? character.role ?? null,
          },
          signupStatus,
        );
        return;
      }
    }

    // Non-MMO: Sign up with selected character immediately
    const signupResult = await deps.signupsService.signup(
      eventId,
      linkedUser.id,
    );
    await deps.signupsService.confirmSignup(
      eventId,
      signupResult.id,
      linkedUser.id,
      { characterId },
    );

    if (signupStatus === 'tentative') {
      await deps.signupsService.updateStatus(
        eventId,
        { userId: linkedUser.id },
        { status: 'tentative' },
      );
    }

    const character = await deps.charactersService.findOne(
      linkedUser.id,
      characterId,
    );

    await interaction.editReply({
      content:
        signupStatus === 'tentative'
          ? `You're marked as **tentative** with **${character.name}**.`
          : `Signed up as **${character.name}**!`,
      components: [],
    });
    await deps.updateEmbedSignupCount(eventId);
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
