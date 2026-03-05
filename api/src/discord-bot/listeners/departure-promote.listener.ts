import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  type ButtonInteraction,
} from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { SignupsService } from '../../events/signups.service';
import {
  DISCORD_BOT_EVENTS,
  DEPARTURE_PROMOTE_BUTTON_IDS,
  SIGNUP_EVENTS,
} from '../discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';

/**
 * Handles "Promote from Bench" / "Leave Empty" button interactions
 * on the departure DMs sent to event creators (ROK-596).
 *
 * Follows the RoachOutInteractionListener pattern:
 * - Registers on bot connect, unregisters on reconnect.
 * - Parses customId: `{action}:{eventId}:{role}:{position}`
 * - Promote: FIFO bench player → vacated slot, notify, edit DM
 * - Dismiss: edit DM to confirm slot left empty
 */
@Injectable()
export class DeparturePromoteListener {
  private readonly logger = new Logger(DeparturePromoteListener.name);
  private boundHandler:
    | ((interaction: import('discord.js').Interaction) => void)
    | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly notificationService: NotificationService,
    private readonly signupsService: SignupsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;

    if (this.boundHandler) {
      client.removeListener('interactionCreate', this.boundHandler);
    }

    this.boundHandler = (interaction: import('discord.js').Interaction) => {
      if (interaction.isButton()) {
        void this.handleButtonInteraction(interaction);
      }
    };

    client.on('interactionCreate', this.boundHandler);
    this.logger.log('Registered departure promote interaction handler');
  }

  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const customId = interaction.customId;
    const parts = customId.split(':');
    if (parts.length !== 4) return;

    const [action, eventIdStr, role, positionStr] = parts;
    const eventId = parseInt(eventIdStr, 10);
    const position = parseInt(positionStr, 10);
    if (isNaN(eventId) || isNaN(position)) return;

    if (
      action !== DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE &&
      action !== DEPARTURE_PROMOTE_BUTTON_IDS.DISMISS
    ) {
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch (error) {
      this.logger.warn(
        'Failed to defer departure promote interaction %s: %s',
        interaction.id,
        error,
      );
      return;
    }

    try {
      if (action === DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE) {
        await this.handlePromote(interaction, eventId);
      } else {
        await this.handleDismiss(interaction, eventId, role, position);
      }
    } catch (error) {
      this.logger.error(
        'Error handling departure promote interaction for event %d:',
        eventId,
        error,
      );
      await this.editDMResult(
        interaction,
        'Something went wrong. Please try again.',
      );
    }
  }

  /**
   * Promote a bench player using the role calculation engine.
   * Finds the FIFO bench player, runs autoAllocateSignup for optimal placement,
   * and notifies the promoted player.
   */
  private async handlePromote(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    // 1. Find FIFO bench player (exclude departed/declined)
    const benchPlayers = await this.db
      .select({
        signupId: schema.rosterAssignments.signupId,
        userId: schema.eventSignups.userId,
      })
      .from(schema.rosterAssignments)
      .innerJoin(
        schema.eventSignups,
        eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
      )
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.role, 'bench'),
          eq(schema.eventSignups.status, 'signed_up'),
        ),
      )
      .orderBy(schema.eventSignups.signedUpAt)
      .limit(1);

    if (benchPlayers.length === 0) {
      await this.editDMResult(interaction, 'No bench players available.');
      return;
    }

    const benchPlayer = benchPlayers[0];

    // 2. Use role calculation engine for optimal placement
    const result = await this.signupsService.promoteFromBench(
      eventId,
      benchPlayer.signupId,
    );

    if (!result || result.role === 'bench') {
      await this.editDMResult(
        interaction,
        result?.warning ??
          `Could not find a suitable roster slot for the bench player.`,
      );
      return;
    }

    this.logger.log(
      `Creator promoted ${result.username} (signup ${benchPlayer.signupId}) to ${result.role}:${result.position} for event ${eventId} via role calculation`,
    );

    // 3. Notify the promoted player
    if (benchPlayer.userId) {
      const [event] = await this.db
        .select({ title: schema.events.title })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      const discordUrl =
        await this.notificationService.getDiscordEmbedUrl(eventId);
      const voiceChannelId =
        await this.notificationService.resolveVoiceChannelForEvent(eventId);

      await this.notificationService.create({
        userId: benchPlayer.userId,
        type: 'bench_promoted',
        title: 'Promoted from Bench!',
        message: `A slot opened up in "${event?.title ?? 'event'}" and you've been moved from the bench to the roster as **${result.role}**!`,
        payload: {
          eventId,
          role: result.role,
          position: result.position,
          ...(discordUrl ? { discordUrl } : {}),
          ...(voiceChannelId ? { voiceChannelId } : {}),
        },
      });
    }

    // 4. Emit signup event for Discord embed sync
    this.eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId: benchPlayer.userId,
      signupId: benchPlayer.signupId,
      action: 'bench_promoted',
    } satisfies SignupEventPayload);

    // 5. Edit original DM to show result
    let dmText = `**${result.username}** has been promoted to **${result.role}** (position ${result.position}).`;
    if (result.warning) {
      dmText += `\n\n⚠️ ${result.warning}`;
    }

    await this.editDMResult(interaction, dmText, eventId);
  }

  /**
   * Dismiss — leave the slot empty, edit DM to confirm.
   */
  private async handleDismiss(
    interaction: ButtonInteraction,
    eventId: number,
    vacatedRole: string,
    vacatedPosition: number,
  ): Promise<void> {
    await this.editDMResult(
      interaction,
      `Slot left empty (**${vacatedRole}** position ${vacatedPosition}).`,
      eventId,
    );
  }

  /**
   * Edit the original DM: append result text and disable all buttons.
   */
  private async editDMResult(
    interaction: ButtonInteraction,
    resultText: string,
    eventId?: number,
  ): Promise<void> {
    try {
      const originalMessage = interaction.message;
      const originalEmbed = originalMessage.embeds[0];

      // Rebuild embed with appended result
      const updatedEmbed = originalEmbed
        ? EmbedBuilder.from(originalEmbed).setDescription(
            `${originalEmbed.description ?? ''}\n\n${resultText}`,
          )
        : new EmbedBuilder().setDescription(resultText);

      // Disable action buttons, keep link buttons as-is
      const updatedComponents: ActionRowBuilder<ButtonBuilder>[] = [];

      for (const row of originalMessage.components) {
        if (row.type !== ComponentType.ActionRow) continue;
        const newRow = new ActionRowBuilder<ButtonBuilder>();
        for (const component of row.components) {
          if (component.type === ComponentType.Button) {
            const btn = ButtonBuilder.from(component);
            // Only disable non-link buttons (keep View Event clickable)
            if (component.style !== ButtonStyle.Link) {
              btn.setDisabled(true);
            }
            newRow.addComponents(btn);
          }
        }
        if (newRow.components.length > 0) {
          updatedComponents.push(newRow);
        }
      }

      // Add View Event link if not already present and eventId is available
      const clientUrl = process.env.CLIENT_URL;
      const hasLinkButton = originalMessage.components.some(
        (row) =>
          row.type === ComponentType.ActionRow &&
          row.components.some(
            (c) =>
              c.type === ComponentType.Button && c.style === ButtonStyle.Link,
          ),
      );
      if (clientUrl && eventId && !hasLinkButton) {
        updatedComponents.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setLabel('View Event')
              .setStyle(ButtonStyle.Link)
              .setURL(`${clientUrl}/events/${eventId}`),
          ),
        );
      }

      await originalMessage.edit({
        embeds: [updatedEmbed],
        components: updatedComponents,
      });
    } catch (error) {
      this.logger.warn(
        'Failed to edit departure promote DM: %s',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }
}
