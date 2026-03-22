import { Injectable, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SettingsService } from '../settings/settings.service';
import {
  FakeInteraction,
  FakeAutocompleteInteraction,
  type CapturedResponse,
} from './fake-interaction';
import type { CommandInteractionHandler } from '../discord-bot/listeners/interaction.listener';

// Lazy-imported handler classes (resolved via ModuleRef)
import { HelpCommand } from '../discord-bot/commands/help.command';
import { EventCreateCommand } from '../discord-bot/commands/event-create.command';
import { EventsListCommand } from '../discord-bot/commands/events-list.command';
import { RosterViewCommand } from '../discord-bot/commands/roster-view.command';
import { BindCommand } from '../discord-bot/commands/bind.command';
import { UnbindCommand } from '../discord-bot/commands/unbind.command';
import { BindingsCommand } from '../discord-bot/commands/bindings.command';
import { InviteCommand } from '../discord-bot/commands/invite.command';
import { PlayingCommand } from '../discord-bot/commands/playing.command';

type HandlerClass = new (...args: unknown[]) => CommandInteractionHandler;

/** Map command names to their NestJS provider classes. */
const HANDLER_MAP: Record<string, HandlerClass> = {
  help: HelpCommand,
  event: EventCreateCommand,
  events: EventsListCommand,
  roster: RosterViewCommand,
  bind: BindCommand,
  unbind: UnbindCommand,
  bindings: BindingsCommand,
  invite: InviteCommand,
  playing: PlayingCommand,
};

export interface ExecuteCommandDto {
  commandName: string;
  subcommand?: string;
  options?: Record<string, unknown>;
  discordUserId?: string;
  guildId?: string;
  channelId?: string;
}

export interface ExecuteAutocompleteDto {
  commandName: string;
  focusedOption: string;
  value: string;
  subcommand?: string;
  discordUserId?: string;
  guildId?: string;
}

/**
 * Executes slash command handlers via FakeInteraction objects.
 * DEMO_MODE only — used by smoke tests.
 */
@Injectable()
export class SlashCommandTestService {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly settingsService: SettingsService,
  ) {}

  /** Execute a slash command and return the captured response. */
  async executeCommand(dto: ExecuteCommandDto): Promise<CapturedResponse> {
    await this.assertDemoMode();
    const handler = this.resolveHandler(dto.commandName);
    const interaction = new FakeInteraction({
      commandName: dto.commandName,
      subcommand: dto.subcommand,
      options: dto.options,
      discordUserId: dto.discordUserId,
      guildId: dto.guildId,
      channelId: dto.channelId,
    });
    await handler.handleInteraction(interaction as never);
    return interaction.toResponse();
  }

  /** Execute an autocomplete handler and return choices. */
  async executeAutocomplete(
    dto: ExecuteAutocompleteDto,
  ): Promise<{ choices: { name: string; value: unknown }[] }> {
    await this.assertDemoMode();
    const handler = this.resolveHandler(dto.commandName);
    if (!handler.handleAutocomplete) {
      return { choices: [] };
    }
    const interaction = new FakeAutocompleteInteraction({
      commandName: dto.commandName,
      focusedOption: dto.focusedOption,
      value: dto.value,
      subcommand: dto.subcommand,
      discordUserId: dto.discordUserId,
      guildId: dto.guildId,
    });
    await handler.handleAutocomplete(interaction as never);
    return { choices: interaction.capturedChoices };
  }

  /** Resolve a command handler from the NestJS DI container. */
  private resolveHandler(commandName: string): CommandInteractionHandler {
    const HandlerClass = HANDLER_MAP[commandName];
    if (!HandlerClass) {
      throw new Error(`Unknown command: ${commandName}`);
    }
    return this.moduleRef.get(HandlerClass, { strict: false });
  }

  /** Assert DEMO_MODE is enabled (env + DB). */
  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    const demoMode = await this.settingsService.getDemoMode();
    if (!demoMode) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }
}
