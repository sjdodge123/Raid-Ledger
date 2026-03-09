import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
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
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import {
  buildConfirmRow,
  editReminderEmbed as editReminderEmbedHelper,
  updateChannelEmbeds as updateChannelEmbedsHelper,
  safeEditReply as safeEditReplyHelper,
  validateRoachOutContext,
  type RoachOutDeps,
} from './roach-out-interaction.handlers';

/**
 * Handles "Roach Out" button interactions on event reminder DMs (ROK-378).
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

  private get deps(): RoachOutDeps {
    return {
      db: this.db,
      clientService: this.clientService,
      signupsService: this.signupsService,
      eventsService: this.eventsService,
      embedFactory: this.embedFactory,
      settingsService: this.settingsService,
      logger: this.logger,
    };
  }

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;
    if (this.boundHandler) {
      client.removeListener('interactionCreate', this.boundHandler);
    }
    this.boundHandler = (interaction: import('discord.js').Interaction) => {
      if (interaction.isButton())
        void this.handleButtonInteraction(interaction);
    };
    client.on('interactionCreate', this.boundHandler);
    this.logger.log('Registered Roach Out interaction handler');
  }

  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const parsed = parseRoachOutButton(interaction.customId);
    if (!parsed) return;
    if (!(await this.deferRoachOut(interaction, parsed.action))) return;
    try {
      await this.routeRoachOut(interaction, parsed);
    } catch (error) {
      this.logger.error(
        'Error handling roach out for event %d:',
        parsed.eventId,
        error,
      );
      await safeEditReplyHelper(
        interaction,
        { content: 'Something went wrong. Please try again.' },
        this.logger,
      );
    }
  }

  private async deferRoachOut(
    interaction: ButtonInteraction,
    action: string,
  ): Promise<boolean> {
    try {
      if (action === ROACH_OUT_BUTTON_IDS.CANCEL) {
        await interaction.deferUpdate();
      } else {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }
      return true;
    } catch (error) {
      this.logger.warn('Failed to defer roach out interaction: %s', error);
      return false;
    }
  }

  private async routeRoachOut(
    interaction: ButtonInteraction,
    parsed: { action: string; eventId: number },
  ): Promise<void> {
    switch (parsed.action) {
      case ROACH_OUT_BUTTON_IDS.ROACH_OUT:
        await this.handleRoachOutClick(interaction, parsed.eventId);
        break;
      case ROACH_OUT_BUTTON_IDS.CONFIRM:
        await this.handleConfirm(interaction, parsed.eventId);
        break;
      case ROACH_OUT_BUTTON_IDS.CANCEL:
        await interaction.editReply({
          content: 'Cancelled. Your signup is unchanged.',
          components: [],
        });
        break;
    }
  }

  private async handleRoachOutClick(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const event = await validateRoachOutContext(
      this.deps,
      interaction,
      eventId,
    );
    if (!event) return;
    const warning =
      event.duration[0].getTime() <= Date.now()
        ? '\n\n**Warning:** This event has already started.'
        : '';
    await interaction.editReply({
      content: `Are you sure you want to roach out of **${event.title}**?${warning}`,
      components: [buildConfirmRow(eventId)],
    });
  }

  private async handleConfirm(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const event = await validateRoachOutContext(
      this.deps,
      interaction,
      eventId,
      true,
    );
    if (!event) return;
    if (!(await this.tryCancelSignup(interaction, eventId))) return;
    await editReminderEmbedHelper(interaction, event.title, this.logger);
    await interaction.editReply({
      content: `\uD83E\uDEB3 You've roached out of **${event.title}**.`,
      components: [],
    });
    await updateChannelEmbedsHelper(this.deps, eventId);
    this.logger.log(
      'Discord user %s roached out of event %d',
      interaction.user.id,
      eventId,
    );
  }

  /** Test-accessible wrapper: handle cancel action. */
  private async handleCancel(interaction: ButtonInteraction): Promise<void> {
    await interaction.editReply({
      content: 'Cancelled. Your signup is unchanged.',
      components: [],
    });
  }

  /** Test-accessible wrapper: edit reminder embed. */
  private async editReminderEmbed(
    interaction: ButtonInteraction,
    title: string,
  ): Promise<void> {
    await editReminderEmbedHelper(interaction, title, this.logger);
  }

  /** Test-accessible wrapper: update channel embeds. */
  private async updateChannelEmbeds(eventId: number): Promise<void> {
    await updateChannelEmbedsHelper(this.deps, eventId);
  }

  /** Test-accessible wrapper: safe edit reply. */
  private async safeEditReply(
    interaction: ButtonInteraction,
    options: Parameters<ButtonInteraction['editReply']>[0],
  ): Promise<void> {
    await safeEditReplyHelper(interaction, options, this.logger);
  }

  /** Test-accessible wrapper: check Discord interaction error. */
  private isDiscordInteractionError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ((error as { code: number }).code === 40060 ||
        (error as { code: number }).code === 10062)
    );
  }

  private async tryCancelSignup(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<boolean> {
    try {
      await this.signupsService.cancelByDiscordUser(
        eventId,
        interaction.user.id,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        'Failed to cancel signup: %s',
        error instanceof Error ? error.message : 'Unknown',
      );
      await interaction.editReply({
        content: "You're not signed up for this event.",
        components: [],
      });
      return false;
    }
  }
}

interface RoachOutButtonParsed {
  action: string;
  eventId: number;
}

function parseRoachOutButton(customId: string): RoachOutButtonParsed | null {
  const parts = customId.split(':');
  if (parts.length !== 2) return null;
  const [action, eventIdStr] = parts;
  const eventId = parseInt(eventIdStr, 10);
  if (isNaN(eventId)) return null;
  if (!isRoachOutAction(action)) return null;
  return { action, eventId };
}

function isRoachOutAction(action: string): boolean {
  return (
    action === ROACH_OUT_BUTTON_IDS.ROACH_OUT ||
    action === ROACH_OUT_BUTTON_IDS.CONFIRM ||
    action === ROACH_OUT_BUTTON_IDS.CANCEL
  );
}
