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
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { AI_MANIFEST } from '../../ai/ai-manifest';

/** Ephemeral answer to an `ai:*` button while chat or the AI plugin is off. */
export const AI_CHAT_DISABLED_COPY = 'AI chat is currently disabled.';

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
    private readonly plugins: PluginRegistryService,
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

  /** True while the AI plugin is active (ROK-2354 entry-point gate). */
  private isPluginActive(): boolean {
    return this.plugins.isActive(AI_MANIFEST.id);
  }

  /** Answer one DM. Silent while the AI plugin is off (ROK-2354). */
  async handleDm(msg: Message): Promise<void> {
    if (!this.isPluginActive()) return;
    try {
      const res = await this.aiChatService.handleInteraction(
        msg.author.id,
        msg.content,
      );
      if (!res) return; // feature disabled — ignore DM silently
      await msg.reply(this.buildReplyPayload(res));
    } catch (err) {
      this.logger.error('Error handling AI chat DM', err);
    }
  }

  /** Answer one `ai:*` press; refuses ephemerally while the plugin is off. */
  async handleButton(interaction: ButtonInteraction): Promise<void> {
    try {
      const path = parseAiCustomId(interaction.customId);
      if (!path) return;
      await interaction.deferReply({ ephemeral: true });
      if (!this.isPluginActive()) {
        await interaction.editReply({ content: AI_CHAT_DISABLED_COPY });
        return;
      }
      const res = await this.aiChatService.handleInteraction(
        interaction.user.id,
        undefined,
        interaction.customId,
      );
      if (!res) {
        await interaction.editReply({ content: AI_CHAT_DISABLED_COPY });
        return;
      }
      await interaction.editReply(this.buildReplyPayload(res));
    } catch (err) {
      this.logger.error('Error handling AI chat button', err);
    }
  }

  /** Build a Discord reply payload with content + button rows. */
  private buildReplyPayload(res: AiChatResponse) {
    return res.rows.length > 0
      ? { content: res.content, components: res.rows }
      : { content: res.content };
  }
}
