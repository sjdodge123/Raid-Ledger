import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { PUG_BUTTON_IDS } from '../discord-bot.constants';
import type { CharacterDto } from '@raid-ledger/contract';
import type { PugInviteDeps } from './pug-invite.helpers';
import {
  safeDeferReply,
  buildAcceptedEmbed,
  buildDeclinedEmbed,
  safeEditDmEmbed,
  safeErrorReply,
  buildCharacterOptions,
} from './pug-invite.helpers';
import { showPugRoleSelect } from './pug-invite-pug-select.handlers';
import { createPugSignup } from './pug-invite-signup.helpers';

type PugSlot = typeof schema.pugSlots.$inferSelect;

/** Handle PUG accept/decline button interactions on DMs. */
export async function handlePugButtonInteraction(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts.length !== 2) return;
  const [action, pugSlotId] = parts;
  if (!isPugAction(action)) return;
  if (!(await safeDeferReply(interaction, deps.logger))) return;
  try {
    await routePugAction(deps, interaction, action, pugSlotId);
  } catch (error) {
    deps.logger.error(
      'Error handling PUG button for slot %s:',
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

function isPugAction(action: string): boolean {
  return action === PUG_BUTTON_IDS.ACCEPT || action === PUG_BUTTON_IDS.DECLINE;
}

async function routePugAction(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  action: string,
  pugSlotId: string,
): Promise<void> {
  const slot = await lookupPugSlot(deps, pugSlotId);
  if (!slot) {
    await interaction.editReply({ content: 'This invite is no longer valid.' });
    return;
  }
  if (slot.discordUserId && slot.discordUserId !== interaction.user.id) {
    await interaction.editReply({ content: 'This invite is not for you.' });
    return;
  }
  if (action === PUG_BUTTON_IDS.ACCEPT) {
    await handlePugAccept(deps, interaction, slot);
  } else {
    await handlePugDecline(deps, interaction, slot);
  }
}

interface AcceptContext {
  event: typeof schema.events.$inferSelect;
  linkedUser: { id: number } | null;
  characters: CharacterDto[];
  isMMO: boolean;
}

async function handlePugAccept(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  slot: PugSlot,
): Promise<void> {
  if (slot.status === 'accepted' || slot.status === 'claimed') {
    await interaction.editReply({
      content: "You've already accepted this invite!",
    });
    return;
  }
  const ctx = await resolveAcceptContext(deps, interaction, slot);
  if (!ctx) return;
  await routeAcceptResult(deps, interaction, slot, ctx);
}

async function routeAcceptResult(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  slot: PugSlot,
  ctx: AcceptContext,
): Promise<void> {
  if (ctx.linkedUser && ctx.characters.length > 0) {
    await showPugCharacterSelect(
      interaction,
      slot.id,
      ctx.event.title,
      ctx.characters,
    );
    return;
  }
  if (ctx.isMMO) {
    await showPugRoleSelect(interaction, slot.id, ctx.event.title);
    return;
  }
  await finalizePugAccept(deps, interaction, slot, ctx.event.title);
}

async function handlePugDecline(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  slot: PugSlot,
): Promise<void> {
  if (slot.discordUserId) {
    try {
      await deps.signupsService.cancelByDiscordUser(
        slot.eventId,
        slot.discordUserId,
      );
    } catch {
      /* No signup to cancel */
    }
  }
  await deps.db.delete(schema.pugSlots).where(eq(schema.pugSlots.id, slot.id));
  await safeEditDmEmbed(interaction, buildDeclinedEmbed());
  await interaction.editReply({ content: 'Declined.' });
  deps.logger.log(
    'PUG %s declined invite for event %d (slot: %s)',
    slot.discordUsername,
    slot.eventId,
    slot.id,
  );
}

async function resolveAcceptContext(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  slot: PugSlot,
): Promise<AcceptContext | null> {
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, slot.eventId))
    .limit(1);
  if (!event) {
    await interaction.editReply({ content: 'Event not found.' });
    return null;
  }
  const sc = event.slotConfig as Record<string, unknown> | null;
  const linkedUser = await findLinkedUser(deps, interaction.user.id);
  let characters: CharacterDto[] = [];
  if (linkedUser && event.gameId) {
    const list = await deps.charactersService.findAllForUser(
      linkedUser.id,
      event.gameId,
    );
    characters = list.data;
  }
  return { event, linkedUser, characters, isMMO: sc?.type === 'mmo' };
}

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

async function showPugCharacterSelect(
  interaction: ButtonInteraction,
  pugSlotId: string,
  eventTitle: string,
  characters: CharacterDto[],
): Promise<void> {
  const options = buildCharacterOptions(characters);
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`${PUG_BUTTON_IDS.CHARACTER_SELECT}:${pugSlotId}`)
    .setPlaceholder('Select a character')
    .addOptions(options);
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu,
  );
  await interaction.editReply({
    content: `Pick a character for **${eventTitle}**`,
    components: [row],
  });
}

async function finalizePugAccept(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  slot: PugSlot,
  eventTitle: string,
): Promise<void> {
  await deps.db
    .update(schema.pugSlots)
    .set({ status: 'accepted', updatedAt: new Date() })
    .where(eq(schema.pugSlots.id, slot.id));
  await createPugSignup(deps, slot, slot.role);
  const embed = buildAcceptedEmbed(
    `You accepted the invite for **${eventTitle}**! See you there!`,
  );
  await safeEditDmEmbed(interaction, embed);
  await interaction.editReply({ content: 'Accepted!' });
  deps.logger.log(
    'PUG %s accepted invite for event %d',
    slot.discordUsername,
    slot.eventId,
  );
}
