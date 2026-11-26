/**
 * ROK-2370: routes the `/login code:` confirm button
 * (`signin-code:approve:<CODE>`) to `LoginCommand.handleSigninCodeButton`.
 * Same `interactionCreate` + `isButton()` pattern as `AiChatListener`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Client, Interaction } from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { LoginCommand } from '../commands/login.command';
import { SIGNIN_CODE_APPROVE_PREFIX } from '../commands/login-code.helpers';

/** Listens for the sign-in code confirm button. */
@Injectable()
export class SigninCodeButtonListener {
  private readonly logger = new Logger(SigninCodeButtonListener.name);
  private handler: ((interaction: Interaction) => void) | null = null;

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly loginCommand: LoginCommand,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;
    this.register(client);
  }

  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.handler = null;
  }

  private register(client: Client): void {
    if (this.handler) client.removeListener('interactionCreate', this.handler);
    this.handler = (interaction: Interaction) => {
      if (!interaction.isButton()) return;
      if (!interaction.customId.startsWith(SIGNIN_CODE_APPROVE_PREFIX)) return;
      this.loginCommand.handleSigninCodeButton(interaction).catch((err) => {
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.error(`Sign-in code button failed: ${reason}`);
      });
    };
    client.on('interactionCreate', this.handler);
  }
}
