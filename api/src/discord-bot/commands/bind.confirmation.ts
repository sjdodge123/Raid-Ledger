/**
 * Multi-binding confirmation flow for /bind command (ROK-959).
 * When a second game-voice-monitor is added to a channel that already
 * has one, shows a warning + Continue/Cancel confirmation.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schemaType from '../../drizzle/schema';
import * as schema from '../../drizzle/schema';
import {
  BIND_CONFIRM_BUTTON_IDS,
  EMBED_COLORS,
} from '../discord-bot.constants';

/** Find all game-voice-monitor bindings on a channel (ROK-959). */
export async function findVoiceMonitorBindings(
  db: PostgresJsDatabase<typeof schemaType>,
  guildId: string,
  channelId: string,
): Promise<{ id: string; gameId: number | null }[]> {
  return db
    .select({
      id: schema.channelBindings.id,
      gameId: schema.channelBindings.gameId,
    })
    .from(schema.channelBindings)
    .where(
      and(
        eq(schema.channelBindings.guildId, guildId),
        eq(schema.channelBindings.channelId, channelId),
        eq(schema.channelBindings.bindingPurpose, 'game-voice-monitor'),
      ),
    );
}

/** Full multi-monitor confirmation flow. Returns true if bind should proceed. */
export async function confirmMultiMonitor(
  db: PostgresJsDatabase<typeof schemaType>,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  channelId: string,
  behavior: string,
  gameId: number | null,
): Promise<boolean> {
  const existing = await findVoiceMonitorBindings(db, guildId, channelId);
  const check = checkMultiMonitor(existing, behavior, gameId);
  if (check.action === 'reject') {
    await replyReject(interaction, check.message);
    return false;
  }
  if (check.action === 'confirm') return awaitConfirmation(interaction);
  return true;
}

/** Result of pre-bind multi-monitor check. */
export type MultiMonitorCheck =
  | { action: 'proceed' }
  | { action: 'reject'; message: string }
  | { action: 'confirm'; gameName: string };

/** Check if binding a voice monitor would conflict with existing ones. */
export function checkMultiMonitor(
  existingBindings: { id: string; gameId: number | null }[],
  behavior: string,
  newGameId: number | null,
): MultiMonitorCheck {
  if (behavior !== 'game-voice-monitor') return { action: 'proceed' };
  if (existingBindings.length === 0) return { action: 'proceed' };
  const sameGame = existingBindings.find((b) => b.gameId === newGameId);
  if (sameGame) {
    return {
      action: 'reject',
      message:
        'This channel is already bound to this game. Use `/unbind` first.',
    };
  }
  return { action: 'confirm', gameName: '' };
}

/** Show a rejection embed for duplicate game binding. */
export async function replyReject(
  interaction: ChatInputCommandInteraction,
  message: string,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.ERROR)
    .setTitle('Binding Conflict')
    .setDescription(message);
  await interaction.editReply({ embeds: [embed] });
}

/** Show warning and wait for Continue/Cancel. Returns true if user confirmed. */
export async function awaitConfirmation(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const embed = buildWarningEmbed();
  const row = buildConfirmButtons();
  const reply = await interaction.editReply({
    embeds: [embed],
    components: [row],
  });
  try {
    const btn = await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 60_000,
      filter: (i) => i.user.id === interaction.user.id,
    });
    await btn.deferUpdate();
    const confirmed = btn.customId === BIND_CONFIRM_BUTTON_IDS.CONTINUE;
    if (!confirmed) {
      await interaction.editReply({
        content: 'Binding cancelled.',
        embeds: [],
        components: [],
      });
    }
    return confirmed;
  } catch {
    await interaction.editReply({
      content: 'Confirmation timed out. Binding cancelled.',
      embeds: [],
      components: [],
    });
    return false;
  }
}

/** Build the warning embed for multi-monitor confirmation. */
function buildWarningEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.REMINDER)
    .setTitle('Multiple Game Monitors')
    .setDescription(
      'This voice channel already has an activity monitor for a different game. ' +
        'Adding another means scheduled events for **either** game will suppress Quick Play for **all** games on this channel.\n\n' +
        'Continue?',
    );
}

/** Build the Continue/Cancel button row. */
function buildConfirmButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BIND_CONFIRM_BUTTON_IDS.CONTINUE)
      .setLabel('Continue')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(BIND_CONFIRM_BUTTON_IDS.CANCEL)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}
