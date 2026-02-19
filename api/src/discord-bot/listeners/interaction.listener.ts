import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  type Interaction,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { EventCreateCommand } from '../commands/event-create.command';
import { EventsListCommand } from '../commands/events-list.command';
import { RosterViewCommand } from '../commands/roster-view.command';
import { BindCommand } from '../commands/bind.command';
import { UnbindCommand } from '../commands/unbind.command';
import { BindingsCommand } from '../commands/bindings.command';

/**
 * Describes a command that can handle slash command interactions.
 */
export interface CommandInteractionHandler {
  readonly commandName: string;
  handleInteraction(interaction: ChatInputCommandInteraction): Promise<void>;
  handleAutocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

/**
 * Listens for Discord interactions (slash commands, autocomplete)
 * and routes them to the appropriate command handler.
 */
@Injectable()
export class InteractionListener {
  private readonly logger = new Logger(InteractionListener.name);
  private listenerAttached = false;

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly eventCreateCommand: EventCreateCommand,
    private readonly eventsListCommand: EventsListCommand,
    private readonly rosterViewCommand: RosterViewCommand,
    private readonly bindCommand: BindCommand,
    private readonly unbindCommand: UnbindCommand,
    private readonly bindingsCommand: BindingsCommand,
  ) {}

  private getHandlers(): CommandInteractionHandler[] {
    return [
      this.eventCreateCommand,
      this.eventsListCommand,
      this.rosterViewCommand,
      this.bindCommand,
      this.unbindCommand,
      this.bindingsCommand,
    ];
  }

  /**
   * Attach the interaction listener when the bot connects.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  attachListener(): void {
    const client = this.clientService.getClient();
    if (!client || this.listenerAttached) return;

    client.on(Events.InteractionCreate, (interaction: Interaction) => {
      this.handleInteraction(interaction).catch((err) => {
        this.logger.error('Unhandled error in interaction handler:', err);
      });
    });

    this.listenerAttached = true;
    this.logger.log('Interaction listener attached');
  }

  /**
   * Reset listener state when bot disconnects (will re-attach on reconnect).
   */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  detachListener(): void {
    this.listenerAttached = false;
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      await this.handleCommand(interaction);
    } else if (interaction.isAutocomplete()) {
      await this.handleAutocomplete(interaction);
    }
  }

  private async handleCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const handler = this.getHandlers().find(
      (h) => h.commandName === interaction.commandName,
    );

    if (!handler) {
      this.logger.warn(`No handler for command: ${interaction.commandName}`);
      return;
    }

    try {
      await handler.handleInteraction(interaction);
    } catch (error) {
      this.logger.error(`Error handling /${interaction.commandName}:`, error);

      const content = 'Something went wrong. Please try again later.';
      if (interaction.replied || interaction.deferred) {
        await interaction
          .followUp({ content, ephemeral: true })
          .catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => {});
      }
    }
  }

  private async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const handler = this.getHandlers().find(
      (h) => h.commandName === interaction.commandName,
    );

    if (!handler?.handleAutocomplete) return;

    try {
      await handler.handleAutocomplete(interaction);
    } catch (error) {
      this.logger.error(
        `Error handling autocomplete for /${interaction.commandName}:`,
        error,
      );
      await interaction.respond([]).catch(() => {});
    }
  }
}
