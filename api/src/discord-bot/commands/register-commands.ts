import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  REST,
  Routes,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { EventCreateCommand } from './event-create.command';
import { EventsListCommand } from './events-list.command';
import { RosterViewCommand } from './roster-view.command';

/**
 * Describes a slash command handler that can be registered with Discord.
 */
export interface SlashCommandHandler {
  /** The command definition for Discord API registration */
  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody;
}

/**
 * Registers all slash commands with Discord API on bot startup.
 * Provides a framework for other stories (ROK-348) to register commands.
 */
@Injectable()
export class RegisterCommandsService {
  private readonly logger = new Logger(RegisterCommandsService.name);

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
    private readonly eventCreateCommand: EventCreateCommand,
    private readonly eventsListCommand: EventsListCommand,
    private readonly rosterViewCommand: RosterViewCommand,
  ) {}

  /**
   * Collect all command definitions from registered handlers.
   */
  private getCommandHandlers(): SlashCommandHandler[] {
    return [
      this.eventCreateCommand,
      this.eventsListCommand,
      this.rosterViewCommand,
    ];
  }

  /**
   * Register all slash commands when the bot connects.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async registerCommands(): Promise<void> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      this.logger.warn('No guild found, skipping slash command registration');
      return;
    }

    const config = await this.settingsService.getDiscordBotConfig();
    if (!config) {
      this.logger.warn(
        'No bot config found, skipping slash command registration',
      );
      return;
    }

    const handlers = this.getCommandHandlers();
    const commands = handlers.map((h) => h.getDefinition());

    try {
      const rest = new REST({ version: '10' }).setToken(config.token);

      // Use guild-specific registration for instant updates (no 1-hour global cache)
      const clientId = this.clientService.getClientId();
      if (!clientId) {
        this.logger.warn(
          'Cannot determine bot client ID, skipping command registration',
        );
        return;
      }

      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });

      this.logger.log(
        `Registered ${commands.length} slash command(s) in guild ${guildId}`,
      );
    } catch (error) {
      this.logger.error('Failed to register slash commands:', error);
    }
  }
}
