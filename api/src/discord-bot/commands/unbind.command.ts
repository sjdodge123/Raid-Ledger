import { Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

@Injectable()
export class UnbindCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'unbind';
  private readonly logger = new Logger(UnbindCommand.name);

  constructor(
    private readonly channelBindingsService: ChannelBindingsService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('unbind')
      .setDescription('Remove a channel binding')
      .setDMPermission(false)
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel to unbind (defaults to current)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice),
      )
      .toJSON();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }

    const channelOption = interaction.options.getChannel('channel');
    const targetChannel = channelOption ?? interaction.channel;
    if (!targetChannel) {
      await interaction.editReply('Could not determine the target channel.');
      return;
    }

    const channelId = targetChannel.id;
    const channelName =
      'name' in targetChannel ? targetChannel.name : channelId;

    try {
      const removed = await this.channelBindingsService.unbind(
        guildId,
        channelId,
      );

      if (removed) {
        const embed = new EmbedBuilder()
          .setColor(0xef4444) // Red
          .setTitle('Channel Unbound')
          .setDescription(`Removed binding for **#${channelName}**.`);

        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply(
          `No binding found for **#${channelName}**.`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to unbind channel:', error);
      await interaction.editReply(
        'Failed to unbind channel. Please try again.',
      );
    }
  }
}
