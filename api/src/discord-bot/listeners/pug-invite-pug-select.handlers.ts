import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { PUG_BUTTON_IDS } from '../discord-bot.constants';
import type { PugRole } from '@raid-ledger/contract';
import type { PugInviteDeps } from './pug-invite.helpers';
import {
  safeDeferUpdate,
  buildAcceptedEmbed,
  safeEditDmEmbed,
  safeErrorReply,
  buildRoleSelectRow,
  buildRoleSelectContent,
  capitalizeRole,
} from './pug-invite.helpers';
import { createPugSignup } from './pug-invite-signup.helpers';

type PugSlot = typeof schema.pugSlots.$inferSelect;

/** Handle PUG character select menu interaction. */
export async function handlePugCharacterSelectMenu(
  deps: PugInviteDeps,
  interaction: StringSelectMenuInteraction,
  pugSlotId: string,
): Promise<void> {
  if (!(await safeDeferUpdate(interaction, deps.logger))) return;
  try {
    await doPugCharacterSelect(deps, interaction, pugSlotId);
  } catch (error) {
    deps.logger.error(
      'Error handling PUG char select for slot %s:',
      pugSlotId,
      error,
    );
    await safeErrorReply(
      interaction,
      'Something went wrong. Please try again.',
    );
  }
}

/** Handle PUG role select menu interaction. */
export async function handlePugRoleSelectMenu(
  deps: PugInviteDeps,
  interaction: StringSelectMenuInteraction,
  pugSlotId: string,
  characterName?: string,
): Promise<void> {
  if (!(await safeDeferUpdate(interaction, deps.logger))) return;
  try {
    await doPugRoleSelect(deps, interaction, pugSlotId, characterName);
  } catch (error) {
    deps.logger.error(
      'Error handling PUG role select for slot %s:',
      pugSlotId,
      error,
    );
    await safeErrorReply(
      interaction,
      'Something went wrong. Please try again.',
    );
  }
}

// --- Internal helpers ---

async function findLinkedUser(
  deps: PugInviteDeps,
  discordId: string,
): Promise<{ id: number } | null> {
  const [user] = await deps.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  return user ?? null;
}

async function lookupPugSlot(
  deps: PugInviteDeps,
  pugSlotId: string,
): Promise<PugSlot | null> {
  const [slot] = await deps.db
    .select()
    .from(schema.pugSlots)
    .where(eq(schema.pugSlots.id, pugSlotId))
    .limit(1);
  return slot ?? null;
}

/** Show role selection dropdown for PUG flow. */
export async function showPugRoleSelect(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  pugSlotId: string,
  eventTitle: string,
  characterInfo?: { name: string; role: string | null },
): Promise<void> {
  const customId = characterInfo
    ? `${PUG_BUTTON_IDS.ROLE_SELECT}:${pugSlotId}:${characterInfo.name}`
    : `${PUG_BUTTON_IDS.ROLE_SELECT}:${pugSlotId}`;
  const row = buildRoleSelectRow(customId);
  const content = buildRoleSelectContent(eventTitle, characterInfo);
  await interaction.editReply({ content, components: [row] });
}

async function doPugCharacterSelect(
  deps: PugInviteDeps,
  interaction: StringSelectMenuInteraction,
  pugSlotId: string,
): Promise<void> {
  const characterId = interaction.values[0];
  const slot = await lookupPugSlot(deps, pugSlotId);
  if (!slot) {
    await interaction.editReply({
      content: 'This invite is no longer valid.',
      components: [],
    });
    return;
  }
  const linkedUser = await findLinkedUser(deps, interaction.user.id);
  if (!linkedUser) {
    await interaction.editReply({
      content: 'Could not find your linked account.',
      components: [],
    });
    return;
  }
  const character = await deps.charactersService.findOne(
    linkedUser.id,
    characterId,
  );
  await routeCharacterResult(deps, interaction, slot, pugSlotId, character);
}

interface CharFields {
  name: string;
  roleOverride?: string | null;
  role?: string | null;
  class?: string | null;
  spec?: string | null;
}

async function routeCharacterResult(
  deps: PugInviteDeps,
  interaction: StringSelectMenuInteraction,
  slot: PugSlot,
  pugSlotId: string,
  character: CharFields,
): Promise<void> {
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, slot.eventId))
    .limit(1);
  const sc = event?.slotConfig as Record<string, unknown> | null;
  if (sc?.type === 'mmo') {
    await showPugRoleSelect(interaction, pugSlotId, event.title, {
      name: character.name,
      role: character.roleOverride ?? character.role ?? null,
    });
    return;
  }
  await acceptWithCharacter(deps, interaction, slot, pugSlotId, character);
}

async function acceptWithCharacter(
  deps: PugInviteDeps,
  interaction: StringSelectMenuInteraction,
  slot: PugSlot,
  pugSlotId: string,
  character: CharFields,
): Promise<void> {
  const effectiveRole = character.roleOverride ?? character.role ?? 'dps';
  await updateSlotAccepted(deps, pugSlotId, effectiveRole, character);
  await createPugSignup(deps, slot, effectiveRole);
  await replyCharAccepted(interaction, deps, slot, character.name);
}

async function updateSlotAccepted(
  deps: PugInviteDeps,
  pugSlotId: string,
  role: string,
  character: { class?: string | null; spec?: string | null },
): Promise<void> {
  await deps.db
    .update(schema.pugSlots)
    .set({
      role,
      class: character.class ?? null,
      spec: character.spec ?? null,
      status: 'accepted',
      updatedAt: new Date(),
    })
    .where(eq(schema.pugSlots.id, pugSlotId));
}

async function replyCharAccepted(
  interaction: StringSelectMenuInteraction,
  deps: PugInviteDeps,
  slot: PugSlot,
  charName: string,
): Promise<void> {
  const embed = buildAcceptedEmbed(
    `You accepted the invite as **${charName}**! See you at the raid!`,
  );
  await safeEditDmEmbed(interaction, embed);
  await interaction.editReply({
    content: `Accepted as **${charName}**!`,
    components: [],
  });
  deps.logger.log(
    'PUG %s accepted invite as %s for event %d',
    slot.discordUsername,
    charName,
    slot.eventId,
  );
}

async function doPugRoleSelect(
  deps: PugInviteDeps,
  interaction: StringSelectMenuInteraction,
  pugSlotId: string,
  characterName?: string,
): Promise<void> {
  const selectedRole = interaction.values[0] as PugRole;
  const slot = await lookupPugSlot(deps, pugSlotId);
  if (!slot) {
    await interaction.editReply({
      content: 'This invite is no longer valid.',
      components: [],
    });
    return;
  }
  const charInfo = characterName
    ? await resolveCharClassSpec(deps, interaction.user.id, slot, characterName)
    : null;
  await updateSlotWithRole(deps, pugSlotId, selectedRole, charInfo);
  await createPugSignup(deps, slot, selectedRole);
  await replyRoleAccepted(interaction, deps, slot, selectedRole, characterName);
}

async function updateSlotWithRole(
  deps: PugInviteDeps,
  pugSlotId: string,
  role: string,
  charInfo: { charClass: string | null; charSpec: string | null } | null,
): Promise<void> {
  await deps.db
    .update(schema.pugSlots)
    .set({
      role,
      class: charInfo?.charClass ?? null,
      spec: charInfo?.charSpec ?? null,
      status: 'accepted',
      updatedAt: new Date(),
    })
    .where(eq(schema.pugSlots.id, pugSlotId));
}

async function replyRoleAccepted(
  interaction: StringSelectMenuInteraction,
  deps: PugInviteDeps,
  slot: PugSlot,
  selectedRole: string,
  characterName?: string,
): Promise<void> {
  const roleDisplay = capitalizeRole(selectedRole);
  const charDisplay = characterName ? ` as **${characterName}**` : '';
  const embed = buildAcceptedEmbed(
    `You accepted the invite${charDisplay} (${roleDisplay})! See you at the raid!`,
  );
  await safeEditDmEmbed(interaction, embed);
  await interaction.editReply({
    content: `Accepted${charDisplay} (${roleDisplay})!`,
    components: [],
  });
  deps.logger.log(
    'PUG %s accepted invite as %s for event %d',
    slot.discordUsername,
    selectedRole,
    slot.eventId,
  );
}

async function resolveCharClassSpec(
  deps: PugInviteDeps,
  discordUserId: string,
  slot: PugSlot,
  characterName: string,
): Promise<{ charClass: string | null; charSpec: string | null } | null> {
  const linkedUser = await findLinkedUser(deps, discordUserId);
  if (!linkedUser || !slot.eventId) return null;
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, slot.eventId))
    .limit(1);
  if (!event?.gameId) return null;
  const charList = await deps.charactersService.findAllForUser(
    linkedUser.id,
    event.gameId,
  );
  const char = charList.data.find((c) => c.name === characterName);
  if (!char) return null;
  return { charClass: char.class ?? null, charSpec: char.spec ?? null };
}
