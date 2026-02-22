import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import {
  DISCORD_BOT_EVENTS,
  ROACH_OUT_BUTTON_IDS,
} from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';

/**
 * Handles "Roach Out" button interactions on event reminder DMs (ROK-378).
 *
 * Flow:
 * 1. User clicks "Roach Out" on reminder DM
 * 2. Bot sends ephemeral confirmation prompt
 * 3. On confirm: removes signup, edits original embed, disables button
 * 4. On cancel: dismisses ephemeral, no changes
 */
@Injectable()
export class RoachOutInteractionListener {
  private readonly logger = new Logger(RoachOutInteractionListener.name);
  private boundHandler:
    | ((interaction: import('discord.js').Interaction) => void)
    | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly signupsService: SignupsService,
    private readonly eventsService: EventsService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Register the interaction handler when the bot connects.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;

    // Remove previous listener to prevent duplicates on reconnect
    if (this.boundHandler) {
      client.removeListener('interactionCreate', this.boundHandler);
    }

    this.boundHandler = (interaction: import('discord.js').Interaction) => {
      if (interaction.isButton()) {
        void this.handleButtonInteraction(interaction);
      }
    };

    client.on('interactionCreate', this.boundHandler);
    this.logger.log('Registered Roach Out interaction handler');
  }

  /**
   * Handle button clicks for roach out flow.
   */
  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const customId = interaction.customId;
    const parts = customId.split(':');
    if (parts.length !== 2) return;

    const [action, eventIdStr] = parts;
    const eventId = parseInt(eventIdStr, 10);
    if (isNaN(eventId)) return;

    // Only handle roach out buttons
    if (
      action !== ROACH_OUT_BUTTON_IDS.ROACH_OUT &&
      action !== ROACH_OUT_BUTTON_IDS.CONFIRM &&
      action !== ROACH_OUT_BUTTON_IDS.CANCEL
    ) {
      return;
    }

    // Defer immediately to avoid 3-second timeout
    try {
      if (action === ROACH_OUT_BUTTON_IDS.CANCEL) {
        // Cancel just dismisses — use deferUpdate to prevent new message
        await interaction.deferUpdate();
      } else {
        await interaction.deferReply({ ephemeral: true });
      }
    } catch (error) {
      this.logger.warn(
        'Failed to defer for roach out interaction %s: %s',
        interaction.id,
        error,
      );
      return;
    }

    try {
      switch (action) {
        case ROACH_OUT_BUTTON_IDS.ROACH_OUT:
          await this.handleRoachOutClick(interaction, eventId);
          break;
        case ROACH_OUT_BUTTON_IDS.CONFIRM:
          await this.handleConfirm(interaction, eventId);
          break;
        case ROACH_OUT_BUTTON_IDS.CANCEL:
          await this.handleCancel(interaction);
          break;
      }
    } catch (error) {
      this.logger.error(
        'Error handling roach out interaction for event %d:',
        eventId,
        error,
      );
      await this.safeEditReply(interaction, {
        content: 'Something went wrong. Please try again.',
      });
    }
  }

  /**
   * Handle initial "Roach Out" button click — show confirmation prompt.
   */
  private async handleRoachOutClick(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    // Look up event
    const [event] = await this.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        cancelledAt: schema.events.cancelledAt,
        duration: schema.events.duration,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      await interaction.editReply({ content: 'Event not found.' });
      return;
    }

    // Edge case: Event cancelled
    if (event.cancelledAt) {
      await interaction.editReply({
        content: 'This event has been cancelled.',
      });
      return;
    }

    // Edge case: User not signed up
    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      interaction.user.id,
    );

    if (!existingSignup) {
      await interaction.editReply({
        content: "You're not signed up for this event.",
      });
      return;
    }

    // Build confirmation prompt
    let warningText = '';
    const now = new Date();
    const startTime = event.duration[0];
    if (startTime.getTime() <= now.getTime()) {
      warningText = '\n\n**Warning:** This event has already started.';
    }

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${ROACH_OUT_BUTTON_IDS.CONFIRM}:${eventId}`)
        .setLabel('Confirm Roach Out')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${ROACH_OUT_BUTTON_IDS.CANCEL}:${eventId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      content: `Are you sure you want to roach out of **${event.title}**?${warningText}`,
      components: [confirmRow],
    });
  }

  /**
   * Handle "Confirm Roach Out" — remove signup, edit original embed, disable button.
   */
  private async handleConfirm(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    // Look up event
    const [event] = await this.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        cancelledAt: schema.events.cancelledAt,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      await interaction.editReply({
        content: 'Event not found.',
        components: [],
      });
      return;
    }

    if (event.cancelledAt) {
      await interaction.editReply({
        content: 'This event has been cancelled.',
        components: [],
      });
      return;
    }

    // Check if user is still signed up
    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      interaction.user.id,
    );

    if (!existingSignup) {
      await interaction.editReply({
        content: "You're not signed up for this event.",
        components: [],
      });
      return;
    }

    // Remove the signup
    try {
      await this.signupsService.cancelByDiscordUser(
        eventId,
        interaction.user.id,
      );
    } catch (error) {
      this.logger.warn(
        'Failed to cancel signup for Discord user %s on event %d: %s',
        interaction.user.id,
        eventId,
        error instanceof Error ? error.message : 'Unknown error',
      );
      await interaction.editReply({
        content: "You're not signed up for this event.",
        components: [],
      });
      return;
    }

    // Edit the original reminder DM embed to show roached-out state
    await this.editReminderEmbed(interaction, event.title);

    // Reply with confirmation
    await interaction.editReply({
      content: `\uD83E\uDEB3 You've roached out of **${event.title}**.`,
      components: [],
    });

    // Update channel embed signup count if applicable (ROK-119 sync)
    await this.updateChannelEmbeds(eventId);

    this.logger.log(
      'Discord user %s roached out of event %d (%s)',
      interaction.user.id,
      eventId,
      event.title,
    );
  }

  /**
   * Handle "Cancel" — dismiss the ephemeral confirmation (deferUpdate already called).
   */
  private async handleCancel(interaction: ButtonInteraction): Promise<void> {
    // deferUpdate was called, so just edit to remove components
    await interaction.editReply({
      content: 'Cancelled. Your signup is unchanged.',
      components: [],
    });
  }

  /**
   * Edit the original reminder DM embed to show roached-out state.
   * Modifies the description to show strikethrough on signup status
   * and disables the Roach Out button.
   */
  private async editReminderEmbed(
    interaction: ButtonInteraction,
    eventTitle: string,
  ): Promise<void> {
    try {
      const originalMessage = interaction.message;
      const originalEmbed = originalMessage.embeds[0];

      if (!originalEmbed) return;

      // Reconstruct embed with roached-out indicator
      const { EmbedBuilder } = await import('discord.js');
      const updatedEmbed = EmbedBuilder.from(originalEmbed);

      // Update the description to append roached-out status
      const originalDescription = originalEmbed.description ?? '';
      updatedEmbed.setDescription(
        `${originalDescription}\n\n**\uD83E\uDEB3 Roached out**`,
      );

      // Build disabled button rows — disable Roach Out, keep URL buttons
      const updatedComponents: ActionRowBuilder<ButtonBuilder>[] = [];
      const { ComponentType } = await import('discord.js');

      for (const row of originalMessage.components) {
        // Only process ActionRow components (type 1)
        if (row.type !== ComponentType.ActionRow) continue;

        const newRow = new ActionRowBuilder<ButtonBuilder>();
        for (const component of row.components) {
          if (component.type === ComponentType.Button) {
            const btn = ButtonBuilder.from(component);
            // Disable the Roach Out button
            if (
              'customId' in component &&
              typeof component.customId === 'string' &&
              component.customId.startsWith(ROACH_OUT_BUTTON_IDS.ROACH_OUT)
            ) {
              btn.setDisabled(true);
            }
            newRow.addComponents(btn);
          }
        }
        if (newRow.components.length > 0) {
          updatedComponents.push(newRow);
        }
      }

      await originalMessage.edit({
        embeds: [updatedEmbed],
        components: updatedComponents,
      });
    } catch (error) {
      // DM edit may fail if message was deleted or bot lacks access
      this.logger.warn(
        'Failed to edit reminder embed for event "%s": %s',
        eventTitle,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  /**
   * Update channel embed signup counts after a roach out (ROK-119 sync).
   */
  private async updateChannelEmbeds(eventId: number): Promise<void> {
    try {
      const eventData = await this.eventsService.buildEmbedEventData(eventId);

      const guildId = this.clientService.getGuildId();
      if (!guildId) return;

      const records = await this.db
        .select()
        .from(schema.discordEventMessages)
        .where(
          and(
            eq(schema.discordEventMessages.eventId, eventId),
            eq(schema.discordEventMessages.guildId, guildId),
          ),
        );

      if (records.length === 0) return;

      const [branding, timezone] = await Promise.all([
        this.settingsService.getBranding(),
        this.settingsService.getDefaultTimezone(),
      ]);
      const context: EmbedContext = {
        communityName: branding.communityName,
        clientUrl: process.env.CLIENT_URL ?? null,
        timezone,
      };

      for (const record of records) {
        try {
          const currentState =
            record.embedState as import('../discord-bot.constants').EmbedState;
          const { embed, row } = this.embedFactory.buildEventEmbed(
            eventData,
            context,
            { state: currentState },
          );

          await this.clientService.editEmbed(
            record.channelId,
            record.messageId,
            embed,
            row,
          );
        } catch (err) {
          this.logger.warn(
            'Failed to update embed message %s for event %d: %s',
            record.messageId,
            eventId,
            err instanceof Error ? err.message : 'Unknown',
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to update channel embeds for event %d:',
        eventId,
        error,
      );
    }
  }

  /**
   * Safely edit a deferred/replied interaction, catching Discord API errors.
   */
  private async safeEditReply(
    interaction: ButtonInteraction,
    options: Parameters<ButtonInteraction['editReply']>[0],
  ): Promise<void> {
    try {
      await interaction.editReply(options);
    } catch (error: unknown) {
      if (this.isDiscordInteractionError(error)) {
        this.logger.warn(
          'Interaction editReply failed (code %d): %s',
          (error as { code: number }).code,
          (error as Error).message,
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Check if an error is a Discord API error for interaction race conditions.
   */
  private isDiscordInteractionError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ((error as { code: number }).code === 40060 ||
        (error as { code: number }).code === 10062)
    );
  }
}
