import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  Message,
  Interaction,
  ButtonInteraction,
  Client,
} from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { AiChatService, AiChatResponse } from './ai-chat.service';
import { AI_CHAT_PREFIX, parseAiCustomId } from './ai-chat.constants';

/**
 * Listens for Discord DMs and AI chat button interactions.
 * Delegates all logic to AiChatService.
 */
@Injectable()
export class AiChatListener {
  private readonly logger = new Logger(AiChatListener.name);
  private messageHandler: ((msg: Message) => void) | null = null;
  private interactionHandler: ((interaction: Interaction) => void) | null =
    null;

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly aiChatService: AiChatService,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;
    this.registerMessageHandler(client);
    this.registerInteractionHandler(client);
    this.logger.log('AI chat listener registered');
  }

  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.messageHandler = null;
    this.interactionHandler = null;
  }

  private registerMessageHandler(client: Client): void {
    if (this.messageHandler) {
      client.removeListener('messageCreate', this.messageHandler);
    }
    this.messageHandler = (msg: Message) => {
      if (this.isDmFromUser(msg)) void this.handleDm(msg);
    };
    client.on('messageCreate', this.messageHandler);
  }

  private registerInteractionHandler(client: Client): void {
    if (this.interactionHandler) {
      client.removeListener('interactionCreate', this.interactionHandler);
    }
    this.interactionHandler = (interaction: Interaction) => {
      if (this.isAiButton(interaction)) {
        void this.handleButton(interaction as ButtonInteraction);
      }
    };
    client.on('interactionCreate', this.interactionHandler);
  }

  private isDmFromUser(msg: Message): boolean {
    return !msg.author.bot && msg.channel.isDMBased();
  }

  private isAiButton(interaction: Interaction): boolean {
    if (!interaction.isButton()) return false;
    return interaction.customId.startsWith(`${AI_CHAT_PREFIX}:`);
  }

  private async handleDm(msg: Message): Promise<void> {
    try {
      const res = await this.aiChatService.handleInteraction(
        msg.author.id,
        msg.content,
      );
      await msg.reply(this.buildReplyPayload(res));
    } catch (err) {
      this.logger.error('Error handling AI chat DM', err);
    }
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    try {
      const path = parseAiCustomId(interaction.customId);
      if (!path) return;
      await interaction.deferReply({ ephemeral: true });
      const res = await this.aiChatService.handleInteraction(
        interaction.user.id,
        undefined,
        interaction.customId,
      );
      await interaction.editReply(this.buildReplyPayload(res));
    } catch (err) {
      this.logger.error('Error handling AI chat button', err);
    }
  }

  /** Build a Discord reply payload with content + button rows. */
  private buildReplyPayload(res: AiChatResponse) {
    return {
      content: res.content,
      components: res.rows.length > 0 ? res.rows : undefined,
    };
  }
}
