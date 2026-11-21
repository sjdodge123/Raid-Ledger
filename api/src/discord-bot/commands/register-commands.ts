import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
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
import { LoginCommand } from './login.command';
import {
  declaredFleetClientId,
  guildScopeMessage,
  identityMismatchMessage,
  isFleetSlotBot,
  noGuildMessage,
  staleGlobalMessage,
} from './register-commands.fleet';
import {
  REGISTER_MAX_ATTEMPTS,
  isPermanentRegisterError,
  registerRetryDelayMs,
} from './register-commands.retry';

export {
  REGISTER_MAX_ATTEMPTS,
  REGISTER_RETRY_BASE_MS,
} from './register-commands.retry';

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
export class RegisterCommandsService implements OnApplicationShutdown {
  private readonly logger = new Logger(RegisterCommandsService.name);
  /** Bumped by every connect / disconnect / shutdown; stale loops stop. */
  private registerGen = 0;
  /** The pending backoff timer, so a cancel can clear and wake it. */
  private retryTimer: { handle: NodeJS.Timeout; wake: () => void } | null =
    null;

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
    private readonly loginCommand: LoginCommand,
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
      this.loginCommand,
    ];
  }

  /**
   * CONNECTED handler: registration runs detached (ROK-2204) so a failing
   * retry chain never delays `connect()`. Never rejects.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onConnected(): void {
    this.registerCommands().catch((error: unknown) =>
      this.logger.error('Slash-command registration crashed:', error),
    );
  }

  /** A disconnect cancels any pending registration retry (ROK-2204). */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onDisconnected(): void {
    this.cancelRetries();
  }

  /** Shutdown cancels any pending retry and frees its timer (ROK-2204). */
  onApplicationShutdown(): void {
    this.cancelRetries();
  }

  /**
   * Register all slash commands. Supersedes any earlier, still-retrying run
   * so an old token never keeps PUTting after a reconnect (ROK-2204).
   */
  async registerCommands(): Promise<void> {
    this.cancelRetries();
    const gen = this.registerGen;
    const config = await this.settingsService.getDiscordBotConfig();
    // A disconnect/shutdown during the settings read supersedes this run.
    if (gen !== this.registerGen) return;
    if (!config) {
      this.logger.warn('No bot config found, skipping command registration');
      return;
    }
    const clientId = this.clientService.getClientId();
    if (!clientId) {
      this.logger.warn('No client ID, skipping command registration');
      return;
    }
    if (isFleetSlotBot()) this.warnOnFleetIdentityMismatch(clientId);
    const commands = this.getCommandHandlers().map((h) => h.getDefinition());
    const rest = new REST({ version: '10' }).setToken(config.token);
    await this.withRetry(gen, () =>
      this.registerOnce(rest, clientId, commands),
    );
  }

  /**
   * Run `attempt` up to REGISTER_MAX_ATTEMPTS times with exponential backoff
   * (ROK-2204): a transient `ConnectTimeoutError` on boot used to leave the
   * commands unregistered until the next restart. A permanent 4xx is not
   * retried; a superseded run (`gen` stale) stops silently. Never throws.
   */
  private async withRetry(
    gen: number,
    attempt: () => Promise<void>,
  ): Promise<void> {
    for (let n = 1; n <= REGISTER_MAX_ATTEMPTS; n++) {
      try {
        await attempt();
        return;
      } catch (error) {
        if (gen !== this.registerGen) return;
        if (n === REGISTER_MAX_ATTEMPTS || isPermanentRegisterError(error)) {
          this.logger.error(
            `Failed to register slash commands after ${n} attempt(s):`,
            error,
          );
          return;
        }
        const waitMs = registerRetryDelayMs(n);
        this.logger.warn(
          `Slash-command registration attempt ${n}/${REGISTER_MAX_ATTEMPTS} failed (${String(error)}); retrying in ${waitMs}ms`,
        );
        await this.waitForRetry(waitMs);
        if (gen !== this.registerGen) return;
      }
    }
  }

  /** Backoff timer a cancel can clear and resolve early. */
  private waitForRetry(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const handle = setTimeout(() => {
        this.retryTimer = null;
        resolve();
      }, ms);
      this.retryTimer = { handle, wake: resolve };
    });
  }

  /** Invalidate every running loop and wake + clear its pending timer. */
  private cancelRetries(): void {
    this.registerGen++;
    const timer = this.retryTimer;
    this.retryTimer = null;
    if (!timer) return;
    clearTimeout(timer.handle);
    timer.wake();
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
   * Logged once per registration run, outside the retried attempt (ROK-2204):
   * an env-injected client id that disagrees with the logged-in app.
   */
  private warnOnFleetIdentityMismatch(clientId: string): void {
    const declared = declaredFleetClientId();
    if (declared && declared !== clientId) {
      this.logger.error(identityMismatchMessage(declared, clientId));
    }
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
