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
      await this.showBindings(interaction, guildId);
    } catch (error) {
      this.logger.error('Failed to list bindings:', error);
      await interaction.editReply(
        'Failed to fetch bindings. Please try again.',
      );
    }
  }

  /** Fetch and display bindings for the guild. */
  private async showBindings(
    interaction: ChatInputCommandInteraction,
    guildId: string,
  ): Promise<void> {
    const bindings = await this.channelBindingsService.getBindings(guildId);
    if (bindings.length === 0) {
      await interaction.editReply(
        'No channel bindings configured. Use `/bind` to set one up.',
      );
      return;
    }
    const gameMap = await this.resolveGameNames(bindings);
    const lines = bindings.map((b) => formatBindingLine(b, gameMap));
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.SYSTEM)
      .setTitle('Channel Bindings')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${bindings.length} binding(s) configured` })
      .setTimestamp();
    const components = buildAdminLinkRow();
    await interaction.editReply({ embeds: [embed], components });
  }

  /** Resolve game names for all bindings with a gameId. */
  private async resolveGameNames(
    bindings: import('../services/channel-bindings.service').BindingRecord[],
  ): Promise<Map<number, string>> {
    const ids = [
      ...new Set(
        bindings.map((b) => b.gameId).filter((id): id is number => id !== null),
      ),
    ];
    const map = new Map<number, string>();
    for (const gId of ids) {
      const [game] = await this.db
        .select({ id: schema.games.id, name: schema.games.name })
        .from(schema.games)
        .where(eq(schema.games.id, gId))
        .limit(1);
      if (game) map.set(game.id, game.name);
    }
    return map;
  }
}

function formatBindingLine(
  binding: import('../services/channel-bindings.service').BindingRecord,
  gameMap: Map<number, string>,
): string {
  const gameName = binding.gameId
    ? (gameMap.get(binding.gameId) ?? 'Unknown')
    : 'Any';
  const label =
    binding.bindingPurpose === 'game-announcements'
      ? 'Announcements'
      : binding.bindingPurpose === 'game-voice-monitor'
        ? 'Activity Monitor'
        : binding.bindingPurpose;
  return `<#${binding.channelId}> \u2192 ${gameName} (${label})`;
}

function buildAdminLinkRow(): ActionRowBuilder<ButtonBuilder>[] {
  const clientUrl = process.env.CLIENT_URL ?? null;
  if (!clientUrl) return [];
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Manage in Admin Panel')
      .setStyle(ButtonStyle.Link)
      .setURL(`${clientUrl}/admin/settings/integrations/channel-bindings`),
  );
  return [row];
}
