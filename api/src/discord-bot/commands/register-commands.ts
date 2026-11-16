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
import { BindCommand } from './bind.command';
import { UnbindCommand } from './unbind.command';
import { BindingsCommand } from './bindings.command';
import { InviteCommand } from './invite.command';
import { HelpCommand } from './help.command';
import { PlayingCommand } from './playing.command';
import { LfgCommand } from './lfg.command';
import { LfgLeaveCommand } from './lfg-leave.command';
import {
  declaredFleetClientId,
  guildScopeMessage,
  identityMismatchMessage,
  isFleetSlotBot,
  noGuildMessage,
  staleGlobalMessage,
} from './register-commands.fleet';

/** Registration attempts per CONNECTED event before giving up (ROK-2204). */
export const REGISTER_MAX_ATTEMPTS = 3;

/** First retry delay; doubles per attempt (2s, then 4s) (ROK-2204). */
export const REGISTER_RETRY_BASE_MS = 2000;

/** Resolve after `ms` — a timer, so fake timers drive it in specs. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    private readonly bindCommand: BindCommand,
    private readonly unbindCommand: UnbindCommand,
    private readonly bindingsCommand: BindingsCommand,
    private readonly inviteCommand: InviteCommand,
    private readonly helpCommand: HelpCommand,
    private readonly playingCommand: PlayingCommand,
    private readonly lfgCommand: LfgCommand,
    private readonly lfgLeaveCommand: LfgLeaveCommand,
  ) {}

  /**
   * Collect all command definitions from registered handlers.
   */
  private getCommandHandlers(): SlashCommandHandler[] {
    return [
      this.eventCreateCommand,
      this.eventsListCommand,
      this.rosterViewCommand,
      this.bindCommand,
      this.unbindCommand,
      this.bindingsCommand,
      this.inviteCommand,
      this.helpCommand,
      this.playingCommand,
      this.lfgCommand,
      this.lfgLeaveCommand,
    ];
  }

  /**
   * Register all slash commands when the bot connects.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async registerCommands(): Promise<void> {
    const config = await this.settingsService.getDiscordBotConfig();
    if (!config) {
      this.logger.warn('No bot config found, skipping command registration');
      return;
    }
    const clientId = this.clientService.getClientId();
    if (!clientId) {
      this.logger.warn('No client ID, skipping command registration');
      return;
    }
    const commands = this.getCommandHandlers().map((h) => h.getDefinition());
    await this.withRetry(() => {
      const rest = new REST({ version: '10' }).setToken(config.token);
      return this.registerOnce(rest, clientId, commands);
    });
  }

  /**
   * Run `attempt` up to REGISTER_MAX_ATTEMPTS times with exponential backoff
   * (ROK-2204): a transient `ConnectTimeoutError` on boot used to leave the
   * commands unregistered until the next restart. Never throws.
   */
  private async withRetry(attempt: () => Promise<void>): Promise<void> {
    for (let n = 1; n <= REGISTER_MAX_ATTEMPTS; n++) {
      try {
        await attempt();
        return;
      } catch (error) {
        if (n === REGISTER_MAX_ATTEMPTS) {
          this.logger.error(
            `Failed to register slash commands after ${n} attempts:`,
            error,
          );
          return;
        }
        const waitMs = REGISTER_RETRY_BASE_MS * 2 ** (n - 1);
        this.logger.warn(
          `Slash-command registration attempt ${n}/${REGISTER_MAX_ATTEMPTS} failed (${String(error)}); retrying in ${waitMs}ms`,
        );
        await delay(waitMs);
      }
    }
  }

  /** One registration attempt: guild-scoped for fleet slots, else global. */
  private async registerOnce(
    rest: REST,
    clientId: string,
    commands: RESTPostAPIChatInputApplicationCommandsJSONBody[],
  ): Promise<void> {
    if (isFleetSlotBot()) {
      await this.registerFleetGuildCommands(rest, clientId, commands);
      return;
    }
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    await this.clearStaleGuildCommands(rest, clientId);
    this.logger.log(`Registered ${commands.length} global slash command(s)`);
  }

  /**
   * Fleet slot bots (ROK-1469) register GUILD-scoped, never globally.
   *
   * NOTE ON DETECTING A COLLIDING APPLICATION: Discord exposes no endpoint for
   * listing the commands OTHER applications have registered in a guild — an app
   * token can only read and write its own. So "another app already claimed
   * /bind here" is not observable from inside this process, and any code
   * claiming to detect it would be lying. What IS observable is logged loudly
   * instead: which application id owns these commands, in which guild, under
   * which scope, with which names — and the one true ambiguity, an env-injected
   * client id that disagrees with the app the token logged in as.
   */
  private async registerFleetGuildCommands(
    rest: REST,
    clientId: string,
    commands: RESTPostAPIChatInputApplicationCommandsJSONBody[],
  ): Promise<void> {
    const declared = declaredFleetClientId();
    if (declared && declared !== clientId) {
      this.logger.error(identityMismatchMessage(declared, clientId));
    }
    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      this.logger.error(noGuildMessage(clientId));
      await this.clearOwnGlobalCommands(rest, clientId);
      return;
    }
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    const names = commands.map((c) => c.name);
    this.logger.log(guildScopeMessage(clientId, guildId, names));
    await this.clearOwnGlobalCommands(rest, clientId);
  }

  /**
   * Delete this slot app's own leftover GLOBAL registrations. They are what put
   * the duplicate, never-responding entries in the picker, and they outlive the
   * env that made them. Best-effort: a failure here must not take the boot down.
   */
  private async clearOwnGlobalCommands(
    rest: REST,
    clientId: string,
  ): Promise<void> {
    try {
      const existing = (await rest.get(
        Routes.applicationCommands(clientId),
      )) as { name?: string }[] | undefined;
      if (!Array.isArray(existing) || existing.length === 0) return;
      const names = existing.map((c) => c?.name ?? '<unnamed>');
      this.logger.warn(staleGlobalMessage(clientId, names));
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
    } catch (error) {
      this.logger.warn(
        `[fleet] Could not clear global commands for application ${clientId}:`,
        error,
      );
    }
  }

  /** Remove stale guild-scoped commands from previous registrations. */
  private async clearStaleGuildCommands(
    rest: REST,
    clientId: string,
  ): Promise<void> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) return;
    await rest
      .put(Routes.applicationGuildCommands(clientId, guildId), { body: [] })
      .catch(() => {
        /* guild cleanup is best-effort */
      });
  }
}
