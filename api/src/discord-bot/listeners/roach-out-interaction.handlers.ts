import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  type ButtonInteraction,
} from 'discord.js';
import type { Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { SignupsService } from '../../events/signups.service';
import type { EventsService } from '../../events/events.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type {
  DiscordEmbedFactory,
  EmbedContext,
} from '../services/discord-embed.factory';
import type { SettingsService } from '../../settings/settings.service';
import { ROACH_OUT_BUTTON_IDS } from '../discord-bot.constants';
import type { EmbedState } from '../discord-bot.constants';

/** Dependencies for roach-out handlers. */
export interface RoachOutDeps {
  db: PostgresJsDatabase<typeof schema>;
  clientService: DiscordBotClientService;
  signupsService: SignupsService;
  eventsService: EventsService;
  embedFactory: DiscordEmbedFactory;
  settingsService: SettingsService;
  logger: Logger;
}

/** Look up an event for the roach-out flow. */
export async function lookupEventForRoachOut(
  deps: RoachOutDeps,
  eventId: number,
): Promise<{
  id: number;
  title: string;
  cancelledAt: Date | null;
  duration: Date[];
} | null> {
  const [event] = await deps.db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      cancelledAt: schema.events.cancelledAt,
      duration: schema.events.duration,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
}

/** Build the confirmation prompt row. */
export function buildConfirmRow(
  eventId: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ROACH_OUT_BUTTON_IDS.CONFIRM}:${eventId}`)
      .setLabel('Confirm Roach Out')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${ROACH_OUT_BUTTON_IDS.CANCEL}:${eventId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Edit the original DM embed to show roached-out state. */
export async function editReminderEmbed(
  interaction: ButtonInteraction,
  eventTitle: string,
  logger: Logger,
): Promise<void> {
  try {
    const msg = interaction.message;
    const originalEmbed = msg.embeds[0];
    if (!originalEmbed) return;
    const updatedEmbed = EmbedBuilder.from(originalEmbed);
    updatedEmbed.setDescription(
      `${originalEmbed.description ?? ''}\n\n**\uD83E\uDEB3 Roached out**`,
    );
    const components = disableRoachOutButtons(msg.components);
    await msg.edit({ embeds: [updatedEmbed], components });
  } catch (error) {
    logger.warn(
      'Failed to edit reminder embed for event "%s": %s',
      eventTitle,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

/** Disable roach-out buttons in component rows. */
function disableRoachOutButtons(
  originalComponents: ButtonInteraction['message']['components'],
): ActionRowBuilder<ButtonBuilder>[] {
  const updated: ActionRowBuilder<ButtonBuilder>[] = [];
  for (const row of originalComponents) {
    if (row.type !== ComponentType.ActionRow) continue;
    const newRow = new ActionRowBuilder<ButtonBuilder>();
    for (const component of row.components) {
      if (component.type === ComponentType.Button) {
        const btn = ButtonBuilder.from(component);
        if (isRoachOutButton(component as unknown as { customId?: string })) btn.setDisabled(true);
        newRow.addComponents(btn);
      }
    }
    if (newRow.components.length > 0) updated.push(newRow);
  }
  return updated;
}

/** Check if a component is a roach-out button by customId prefix. */
function isRoachOutButton(component: { customId?: string }): boolean {
  return (
    'customId' in component &&
    typeof component.customId === 'string' &&
    component.customId.startsWith(ROACH_OUT_BUTTON_IDS.ROACH_OUT)
  );
}

/** Update channel embed signup counts after a roach out. */
export async function updateChannelEmbeds(
  deps: RoachOutDeps,
  eventId: number,
): Promise<void> {
  try {
    const records = await findGuildEmbedRecords(deps, eventId);
    if (!records || records.length === 0) return;
    const eventData = await deps.eventsService.buildEmbedEventData(eventId);
    const context = await buildEmbedContext(deps);
    await rerenderEmbedRecords(deps, records, eventData, context, eventId);
  } catch (error) {
    deps.logger.error(
      'Failed to update channel embeds for event %d:',
      eventId,
      error,
    );
  }
}

async function findGuildEmbedRecords(
  deps: RoachOutDeps,
  eventId: number,
): Promise<(typeof schema.discordEventMessages.$inferSelect)[] | null> {
  const guildId = deps.clientService.getGuildId();
  if (!guildId) return null;
  return deps.db
    .select()
    .from(schema.discordEventMessages)
    .where(
      and(
        eq(schema.discordEventMessages.eventId, eventId),
        eq(schema.discordEventMessages.guildId, guildId),
      ),
    );
}

async function buildEmbedContext(deps: RoachOutDeps): Promise<EmbedContext> {
  const [branding, timezone] = await Promise.all([
    deps.settingsService.getBranding(),
    deps.settingsService.getDefaultTimezone(),
  ]);
  return {
    communityName: branding.communityName,
    clientUrl: process.env.CLIENT_URL ?? null,
    timezone,
  };
}

async function rerenderEmbedRecords(
  deps: RoachOutDeps,
  records: (typeof schema.discordEventMessages.$inferSelect)[],
  eventData: import('../services/discord-embed.factory').EmbedEventData,
  context: EmbedContext,
  eventId: number,
): Promise<void> {
  for (const record of records) {
    await rerenderSingleRecord(deps, record, eventData, context, eventId);
  }
}

async function rerenderSingleRecord(
  deps: RoachOutDeps,
  record: typeof schema.discordEventMessages.$inferSelect,
  eventData: import('../services/discord-embed.factory').EmbedEventData,
  context: EmbedContext,
  eventId: number,
): Promise<void> {
  try {
    const state = record.embedState as EmbedState;
    const { embed, row } = deps.embedFactory.buildEventEmbed(
      eventData,
      context,
      { state },
    );
    await deps.clientService.editEmbed(
      record.channelId,
      record.messageId,
      embed,
      row,
    );
  } catch (err) {
    deps.logger.warn(
      'Failed to update embed message %s for event %d: %s',
      record.messageId,
      eventId,
      err instanceof Error ? err.message : 'Unknown',
    );
  }
}

type RoachOutEvent = {
  title: string;
  duration: Date[];
  cancelledAt: Date | null;
};

/** Validate event + signup for roach-out flow. Returns event or null. */
export async function validateRoachOutContext(
  deps: RoachOutDeps,
  interaction: ButtonInteraction,
  eventId: number,
  clearComponents = false,
): Promise<RoachOutEvent | null> {
  const event = await lookupEventForRoachOut(deps, eventId);
  if (!event)
    return replyNull(interaction, 'Event not found.', clearComponents);
  if (event.cancelledAt)
    return replyNull(
      interaction,
      'This event has been cancelled.',
      clearComponents,
    );
  const signup = await deps.signupsService.findByDiscordUser(
    eventId,
    interaction.user.id,
  );
  if (!signup)
    return replyNull(
      interaction,
      "You're not signed up for this event.",
      clearComponents,
    );
  return event;
}

async function replyNull(
  interaction: ButtonInteraction,
  content: string,
  clearComponents: boolean,
): Promise<null> {
  const opts = clearComponents ? { components: [] as [] } : {};
  await interaction.editReply({ content, ...opts });
  return null;
}

/** Safely edit a deferred/replied interaction. */
export async function safeEditReply(
  interaction: ButtonInteraction,
  options: Parameters<ButtonInteraction['editReply']>[0],
  logger: Logger,
): Promise<void> {
  try {
    await interaction.editReply(options);
  } catch (error: unknown) {
    if (isDiscordInteractionError(error)) {
      logger.warn(
        'Interaction editReply failed (code %d): %s',
        (error as { code: number }).code,
        (error as Error).message,
      );
      return;
    }
    throw error;
  }
}

function isDiscordInteractionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code: number }).code === 40060 ||
      (error as { code: number }).code === 10062)
  );
}
