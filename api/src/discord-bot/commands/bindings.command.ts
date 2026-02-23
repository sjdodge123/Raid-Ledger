import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { EMBED_COLORS } from '../discord-bot.constants';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

@Injectable()
export class BindingsCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'bindings';
  private readonly logger = new Logger(BindingsCommand.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly channelBindingsService: ChannelBindingsService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('bindings')
      .setDescription('List all active channel bindings for this server')
      .setDMPermission(false)
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

    try {
      const bindings = await this.channelBindingsService.getBindings(guildId);

      if (bindings.length === 0) {
        await interaction.editReply(
          'No channel bindings configured. Use `/bind` to set one up.',
        );
        return;
      }

      // Resolve game names for bindings with gameId
      const gameIds = bindings
        .map((b) => b.gameId)
        .filter((id): id is number => id !== null);

      const gameMap = new Map<number, string>();
      for (const gId of [...new Set(gameIds)]) {
        const [game] = await this.db
          .select({
            id: schema.games.id,
            name: schema.games.name,
          })
          .from(schema.games)
          .where(eq(schema.games.id, gId))
          .limit(1);
        if (game) {
          gameMap.set(game.id, game.name);
        }
      }

      const lines = bindings.map((binding) => {
        const gameName = binding.gameId
          ? (gameMap.get(binding.gameId) ?? 'Unknown')
          : 'Any';
        const behaviorLabel =
          binding.bindingPurpose === 'game-announcements'
            ? 'Announcements'
            : binding.bindingPurpose === 'game-voice-monitor'
              ? 'Activity Monitor'
              : binding.bindingPurpose;

        return `<#${binding.channelId}> → ${gameName} (${behaviorLabel})`;
      });

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SYSTEM)
        .setTitle('Channel Bindings')
        .setDescription(lines.join('\n'))
        .setFooter({
          text: `${bindings.length} binding(s) configured`,
        })
        .setTimestamp();

      const components: ActionRowBuilder<ButtonBuilder>[] = [];
      const clientUrl = process.env.CLIENT_URL ?? null;
      if (clientUrl) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Manage in Admin Panel')
            .setStyle(ButtonStyle.Link)
            .setURL(
              `${clientUrl}/admin/settings/integrations/channel-bindings`,
            ),
        );
        components.push(row);
      }

      await interaction.editReply({
        embeds: [embed],
        components,
      });
    } catch (error) {
      this.logger.error('Failed to list bindings:', error);
      await interaction.editReply(
        'Failed to fetch bindings. Please try again.',
      );
    }
  }
}
