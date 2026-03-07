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

interface RoleSelectInfo {
  selectedRoles: ('tank' | 'healer' | 'dps')[];
  primaryRole: string;
  rolesLabel: string;
}

/** Parse role values from the interaction into a reusable context. */
function parseRoleValues(
  interaction: StringSelectMenuInteraction,
): RoleSelectInfo {
  const selectedRoles = interaction.values as ('tank' | 'healer' | 'dps')[];
  const primaryRole = selectedRoles[0];
  const rolesLabel = selectedRoles
    .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
    .join(', ');
  return { selectedRoles, primaryRole, rolesLabel };
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
    await dispatchRoleSelect(
      interaction,
      eventId,
      deps,
      roleCtx,
      characterId,
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

async function dispatchRoleSelect(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  roleCtx: RoleSelectInfo,
  characterId?: string,
  signupStatus?: 'tentative',
): Promise<void> {
  if (characterId) {
    await handleLinkedRoleSelect(
      interaction,
      eventId,
      deps,
      characterId,
      roleCtx,
      signupStatus,
    );
  } else {
    await handleUnlinkedRoleSelect(
      interaction,
      eventId,
      deps,
      roleCtx,
      signupStatus,
    );
  }
}

type SlotRole = 'tank' | 'healer' | 'dps' | 'flex' | 'player' | 'bench';

/** Build the signup options object from selected roles. */
function buildRoleSignupOptions(
  selectedRoles: ('tank' | 'healer' | 'dps')[],
  primaryRole: string,
): { slotRole?: SlotRole; preferredRoles: ('tank' | 'healer' | 'dps')[] } {
  if (selectedRoles.length === 1) {
    return {
      slotRole: primaryRole as SlotRole,
      preferredRoles: selectedRoles,
    };
  }
  return { preferredRoles: selectedRoles };
}

/**
 * Role select for a linked user with a character.
 */
async function handleLinkedRoleSelect(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  characterId: string,
  roleCtx: RoleSelectInfo,
  signupStatus?: 'tentative',
): Promise<void> {
  const linkedUser = await findLinkedUser(interaction.user.id, deps);
  if (!linkedUser) {
    await replyNoLinkedAccount(interaction);
    return;
  }
  const opts = buildRoleSignupOptions(
    roleCtx.selectedRoles,
    roleCtx.primaryRole,
  );
  await signupWithCharacter(
    deps,
    eventId,
    linkedUser.id,
    characterId,
    opts,
    signupStatus,
  );
  await confirmCharRoleSignup(
    interaction,
    eventId,
    deps,
    linkedUser.id,
    characterId,
    roleCtx.rolesLabel,
    signupStatus,
  );
}

async function confirmCharRoleSignup(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  userId: number,
  characterId: string,
  rolesLabel: string,
  signupStatus?: 'tentative',
): Promise<void> {
  const character = await deps.charactersService.findOne(userId, characterId);
  await interaction.editReply({
    content: formatRoleConfirmation(signupStatus, character.name, rolesLabel),
    components: [],
  });
  await deps.updateEmbedSignupCount(eventId);
}

async function replyWithRoleConfirmation(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  charName: string,
  rolesLabel: string,
  signupStatus?: 'tentative',
): Promise<void> {
  await interaction.editReply({
    content: formatRoleConfirmation(signupStatus, charName, rolesLabel),
    components: [],
  });
  await deps.updateEmbedSignupCount(eventId);
}

async function replyNoLinkedAccount(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  await interaction.editReply({
    content: 'Could not find your linked account. Please try again.',
    components: [],
  });
}

/** Sign up a user and confirm with a character, optionally marking tentative. */
async function signupWithCharacter(
  deps: SignupInteractionDeps,
  eventId: number,
  userId: number,
  characterId: string,
  opts: { slotRole?: SlotRole; preferredRoles?: ('tank' | 'healer' | 'dps')[] },
  signupStatus?: 'tentative',
): Promise<void> {
  const signupResult = await deps.signupsService.signup(eventId, userId, opts);
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
}

function formatRoleConfirmation(
  signupStatus: 'tentative' | undefined,
  charName: string,
  rolesLabel: string,
): string {
  return signupStatus === 'tentative'
    ? `You're marked as **tentative** with **${charName}** (${rolesLabel}).`
    : `Signed up as **${charName}** (${rolesLabel})!`;
}

/** Find a linked user by Discord ID. */
async function findLinkedUser(
  discordUserId: string,
  deps: SignupInteractionDeps,
): Promise<typeof schema.users.$inferSelect | null> {
  const [user] = await deps.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUserId))
    .limit(1);
  return user ?? null;
}

/**
 * Role select for an unlinked user or linked user without character.
 */
async function handleUnlinkedRoleSelect(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  roleCtx: RoleSelectInfo,
  signupStatus?: 'tentative',
): Promise<void> {
  const linkedUser = await findLinkedUser(interaction.user.id, deps);
  if (linkedUser) {
    await handleLinkedNoCharRoleSelect(
      interaction,
      eventId,
      deps,
      linkedUser,
      roleCtx,
      signupStatus,
    );
    return;
  }
  await signupAnonymousWithRoles(
    interaction,
    eventId,
    deps,
    roleCtx,
    signupStatus,
  );
}

/** Anonymous user signup with roles (Path B). */
async function signupAnonymousWithRoles(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  roleCtx: RoleSelectInfo,
  signupStatus?: 'tentative',
): Promise<void> {
  await deps.signupsService.signupDiscord(eventId, {
    discordUserId: interaction.user.id,
    discordUsername: interaction.user.username,
    discordAvatarHash: interaction.user.avatar,
    role:
      roleCtx.selectedRoles.length === 1
        ? (roleCtx.primaryRole as 'tank' | 'healer' | 'dps' | 'flex' | 'player')
        : undefined,
    preferredRoles: roleCtx.selectedRoles,
    status: signupStatus ?? undefined,
  });
  await interaction.editReply({
    content: formatAnonymousRoleConfirmation(
      interaction.user.username,
      roleCtx.rolesLabel,
      signupStatus,
    ),
    components: [],
  });
  await deps.updateEmbedSignupCount(eventId);
}

function formatAnonymousRoleConfirmation(
  username: string,
  rolesLabel: string,
  status?: 'tentative',
): string {
  if (status === 'tentative')
    return `You're marked as **tentative** (${rolesLabel}).`;
  const clientUrl = process.env.CLIENT_URL ?? '';
  const link = clientUrl
    ? `\n[Create an account](${clientUrl}) to manage characters and get reminders.`
    : '';
  return `You're signed up as **${username}** (${rolesLabel})!${link}`;
}

/**
 * Role select for linked user without character.
 */
async function handleLinkedNoCharRoleSelect(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  linkedUser: typeof schema.users.$inferSelect,
  roleCtx: RoleSelectInfo,
  signupStatus?: 'tentative',
): Promise<void> {
  const opts = buildRoleSignupOptions(
    roleCtx.selectedRoles,
    roleCtx.primaryRole,
  );
  await deps.signupsService.signup(eventId, linkedUser.id, opts);
  if (signupStatus === 'tentative')
    await markTentative(deps, eventId, linkedUser.id);

  await confirmNoCharSignup(
    interaction,
    eventId,
    deps,
    roleCtx.rolesLabel,
    signupStatus,
  );
}

async function markTentative(
  deps: SignupInteractionDeps,
  eventId: number,
  userId: number,
): Promise<void> {
  await deps.signupsService.updateStatus(
    eventId,
    { userId },
    { status: 'tentative' },
  );
}

async function confirmNoCharSignup(
  interaction: StringSelectMenuInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
  rolesLabel: string,
  signupStatus?: 'tentative',
): Promise<void> {
  const eventTitle = await fetchEventTitle(eventId, deps);
  await interaction.editReply({
    content: formatNoCharConfirmation(signupStatus, eventTitle, rolesLabel),
    components: [],
  });
  await deps.updateEmbedSignupCount(eventId);
}

async function fetchEventTitle(
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<string> {
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event?.title ?? 'the event';
}

function formatNoCharConfirmation(
  signupStatus: 'tentative' | undefined,
  eventTitle: string,
  rolesLabel: string,
): string {
  const clientUrl = process.env.CLIENT_URL ?? '';
  const nudge = clientUrl
    ? `\nTip: Create a character at ${clientUrl}/profile to get assigned to a role next time.`
    : '';
  return signupStatus === 'tentative'
    ? `You're marked as **tentative** for **${eventTitle}** (${rolesLabel}).`
    : `You're signed up for **${eventTitle}** (${rolesLabel})!${nudge}`;
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

  const character = await deps.charactersService.findOne(userId, characterId);
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
  return true;
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
  const signupResult = await deps.signupsService.signup(eventId, userId);
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
  const character = await deps.charactersService.findOne(userId, characterId);

  await interaction.editReply({
    content:
      signupStatus === 'tentative'
        ? `You're marked as **tentative** with **${character.name}**.`
        : `Signed up as **${character.name}**!`,
    components: [],
  });
  await deps.updateEmbedSignupCount(eventId);
}
