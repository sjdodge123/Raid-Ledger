import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Message, Interaction } from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { AiChatService } from './ai-chat.service';
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

  /** Register handlers when the bot connects. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;
    this.registerMessageHandler(client);
    this.registerInteractionHandler(client);
    this.logger.log('AI chat listener registered');
  }

  /** Clean up handlers on disconnect. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.messageHandler = null;
    this.interactionHandler = null;
  }

  /** Register the DM message handler. */
  private registerMessageHandler(client: import('discord.js').Client): void {
    if (this.messageHandler) {
      client.removeListener('messageCreate', this.messageHandler);
    }
    this.messageHandler = (msg: Message) => {
      if (this.isDmFromUser(msg)) {
        void this.handleDm(msg);
      }
    };
    client.on('messageCreate', this.messageHandler);
  }

  /** Register the button interaction handler. */
  private registerInteractionHandler(
    client: import('discord.js').Client,
  ): void {
    if (this.interactionHandler) {
      client.removeListener('interactionCreate', this.interactionHandler);
    }
    this.interactionHandler = (interaction: Interaction) => {
      if (this.isAiButtonInteraction(interaction)) {
        void this.handleButton(
          interaction as import('discord.js').ButtonInteraction,
        );
      }
    };
    client.on('interactionCreate', this.interactionHandler);
  }

  /** Check if a message is a DM from a non-bot user. */
  private isDmFromUser(msg: Message): boolean {
    return !msg.author.bot && msg.channel.isDMBased();
  }

  /** Check if an interaction is an AI chat button click. */
  private isAiButtonInteraction(interaction: Interaction): boolean {
    if (!interaction.isButton()) return false;
    return interaction.customId.startsWith(`${AI_CHAT_PREFIX}:`);
  }

  /** Handle a DM text message. */
  private async handleDm(msg: Message): Promise<void> {
    try {
      const res = await this.aiChatService.handleInteraction(
        msg.author.id,
        msg.content,
      );
      await msg.reply({ content: res.content });
    } catch (err) {
      this.logger.error('Error handling AI chat DM', err);
    }
  }

  /** Handle an AI chat button click. */
  private async handleButton(
    interaction: import('discord.js').ButtonInteraction,
  ): Promise<void> {
    try {
      const path = parseAiCustomId(interaction.customId);
      if (!path) return;
      const res = await this.aiChatService.handleInteraction(
        interaction.user.id,
        undefined,
        interaction.customId,
      );
      await interaction.reply({ content: res.content, ephemeral: true });
    } catch (err) {
      this.logger.error('Error handling AI chat button', err);
    }
  }
}
