import type { StringSelectMenuInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { SignupInteractionDeps } from './signup-interaction.types';

type SlotRole = 'tank' | 'healer' | 'dps' | 'flex' | 'player' | 'bench';

export interface RoleSelectInfo {
  selectedRoles: ('tank' | 'healer' | 'dps')[];
  primaryRole: string;
  rolesLabel: string;
}

/** Parse role values from the interaction into a reusable context. */
export function parseRoleValues(
  interaction: StringSelectMenuInteraction,
): RoleSelectInfo {
  const selectedRoles = interaction.values as ('tank' | 'healer' | 'dps')[];
  const primaryRole = selectedRoles[0];
  const rolesLabel = selectedRoles
    .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
    .join(', ');
  return { selectedRoles, primaryRole, rolesLabel };
}

/** Build the signup options object from selected roles. */
export function buildRoleSignupOptions(
  selectedRoles: ('tank' | 'healer' | 'dps')[],
  primaryRole: string,
): { slotRole?: SlotRole; preferredRoles: ('tank' | 'healer' | 'dps')[] } {
  if (selectedRoles.length === 1) {
    return { slotRole: primaryRole as SlotRole, preferredRoles: selectedRoles };
  }
  return { preferredRoles: selectedRoles };
}

/** Find a linked user by Discord ID. */
export async function findLinkedUser(
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

/** Sign up a user and confirm with a character, optionally marking tentative. */
export async function signupWithCharacter(
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

interface LinkedRoleSelectArgs {
  interaction: StringSelectMenuInteraction;
  eventId: number;
  deps: SignupInteractionDeps;
  characterId: string;
  roleCtx: RoleSelectInfo;
  signupStatus?: 'tentative';
}

/** Role select for a linked user with a character. */
export async function handleLinkedRoleSelect(
  a: LinkedRoleSelectArgs,
): Promise<void> {
  const { interaction, deps, characterId, roleCtx, signupStatus } = a;
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
    a.eventId,
    linkedUser.id,
    characterId,
    opts,
    signupStatus,
  );
  await confirmCharRoleSignup(
    interaction,
    a.eventId,
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

export async function replyNoLinkedAccount(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  await interaction.editReply({
    content: 'Could not find your linked account. Please try again.',
    components: [],
  });
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

/** Role select for unlinked user or linked user without character. */
export async function handleUnlinkedRoleSelect(
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

/** Role select for linked user without character. */
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
