import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { MEMBER_INVITE_BUTTON_IDS } from '../discord-bot.constants';
import type { PugInviteDeps } from './pug-invite.helpers';
import {
  safeDeferReply,
  buildAcceptedEmbed,
  buildDeclinedEmbed,
  safeEditDmEmbed,
  safeErrorReply,
  buildCharacterOptions,
  buildRoleSelectRow,
  buildRoleSelectContent,
} from './pug-invite.helpers';

/** Handle member invite Accept/Decline button interaction. */
export async function handleMemberInviteButton(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts.length < 3) return;
  const [action, eventIdStr] = parts;
  const eventId = parseInt(eventIdStr, 10);
  if (!(await safeDeferReply(interaction, deps.logger))) return;
  try {
    if (action === MEMBER_INVITE_BUTTON_IDS.ACCEPT) {
      await handleMemberAccept(deps, interaction, eventId);
    } else if (action === MEMBER_INVITE_BUTTON_IDS.DECLINE) {
      await handleMemberDecline(deps, interaction, eventId);
    }
  } catch (error) {
    deps.logger.error(
      'Error handling member invite for event %d:',
      eventId,
      error,
    );
    await safeErrorReply(
      interaction,
      'Something went wrong. Please try again.',
    );
  }
}

/** Handle member invite Accept: sign up + character/role selection. */
async function handleMemberAccept(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  eventId: number,
): Promise<void> {
  const linkedUser = await findLinkedUser(deps, interaction.user.id);
  if (!linkedUser) {
    await interaction.editReply({
      content:
        'Could not find your linked account. Please sign up via the web app.',
    });
    return;
  }
  const event = await lookupActiveEvent(deps, eventId);
  if (!event) {
    await interaction.editReply({
      content: 'This event is no longer available.',
    });
    return;
  }
  await routeAcceptFlow(deps, interaction, event, linkedUser, eventId);
}

async function routeAcceptFlow(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  event: typeof schema.events.$inferSelect,
  linkedUser: { id: number },
  eventId: number,
): Promise<void> {
  const sc = event.slotConfig as Record<string, unknown> | null;
  if (
    event.gameId &&
    (await showCharsIfAvailable(deps, interaction, eventId, event, linkedUser))
  ) {
    return;
  }
  if (sc?.type === 'mmo') {
    await showMemberRoleSelect(interaction, eventId, event.title);
    return;
  }
  await finalizeMemberAccept(
    deps,
    interaction,
    eventId,
    linkedUser.id,
    event.title,
  );
}

async function showCharsIfAvailable(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  eventId: number,
  event: typeof schema.events.$inferSelect,
  linkedUser: { id: number },
): Promise<boolean> {
  if (!event.gameId) return false;
  const charList = await deps.charactersService.findAllForUser(
    linkedUser.id,
    event.gameId,
  );
  if (charList.data.length > 0) {
    await showMemberCharacterSelect(
      interaction,
      eventId,
      event.title,
      charList.data,
    );
    return true;
  }
  return false;
}

async function handleMemberDecline(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  eventId: number,
): Promise<void> {
  try {
    await deps.signupsService.cancelByDiscordUser(eventId, interaction.user.id);
    deps.logger.log(
      'Cancelled signup for Discord user %s on event %d via decline',
      interaction.user.id,
      eventId,
    );
  } catch {
    /* No signup to cancel */
  }
  await safeEditDmEmbed(interaction, buildDeclinedEmbed());
  await interaction.editReply({ content: 'Declined.' });
  deps.logger.log('Member declined invite for event %d', eventId);
}

// --- Shared helpers ---

export async function findLinkedUser(
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

export async function lookupActiveEvent(
  deps: PugInviteDeps,
  eventId: number,
): Promise<typeof schema.events.$inferSelect | null> {
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event || event.cancelledAt) return null;
  return event;
}

export async function showMemberCharacterSelect(
  interaction: ButtonInteraction,
  eventId: number,
  eventTitle: string,
  characters: import('@raid-ledger/contract').CharacterDto[],
): Promise<void> {
  const options = buildCharacterOptions(characters);
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`${MEMBER_INVITE_BUTTON_IDS.CHARACTER_SELECT}:${eventId}`)
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

export async function showMemberRoleSelect(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  eventId: number,
  eventTitle: string,
  characterInfo?: { id: string; name: string; role: string | null },
): Promise<void> {
  const customId = characterInfo
    ? `${MEMBER_INVITE_BUTTON_IDS.ROLE_SELECT}:${eventId}:${characterInfo.id}`
    : `${MEMBER_INVITE_BUTTON_IDS.ROLE_SELECT}:${eventId}`;
  const row = buildRoleSelectRow(customId);
  const content = buildRoleSelectContent(
    eventTitle,
    characterInfo
      ? { name: characterInfo.name, role: characterInfo.role }
      : undefined,
  );
  await interaction.editReply({ content, components: [row] });
}

async function finalizeMemberAccept(
  deps: PugInviteDeps,
  interaction: ButtonInteraction,
  eventId: number,
  userId: number,
  eventTitle: string,
): Promise<void> {
  try {
    await deps.signupsService.signup(eventId, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to sign up';
    await interaction.editReply({ content: msg });
    return;
  }
  const embed = buildAcceptedEmbed(
    `You signed up for **${eventTitle}**! See you there!`,
  );
  await safeEditDmEmbed(interaction, embed);
  await interaction.editReply({ content: 'Signed up!' });
}
