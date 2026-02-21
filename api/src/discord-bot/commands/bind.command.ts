import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { and, ilike } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { buildWordMatchFilters } from '../../common/search.util';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';
import type { ChannelType as BindingChannelType } from '@raid-ledger/contract';

@Injectable()
export class BindCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'bind';
  private readonly logger = new Logger(BindCommand.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly channelBindingsService: ChannelBindingsService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('bind')
      .setDescription('Bind a Discord channel to a game/behavior')
      .setDMPermission(false)
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel to bind (defaults to current)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice),
      )
      .addStringOption((opt) =>
        opt.setName('game').setDescription('Game name').setAutocomplete(true),
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

    // Resolve target channel
    const channelOption = interaction.options.getChannel('channel');
    const targetChannel = channelOption ?? interaction.channel;
    if (!targetChannel) {
      await interaction.editReply('Could not determine the target channel.');
      return;
    }

    const channelId = targetChannel.id;
    const channelName =
      'name' in targetChannel ? targetChannel.name : channelId;

    // Determine channel type for binding
    let bindingChannelType: BindingChannelType = 'text';
    if (channelOption) {
      bindingChannelType =
        channelOption.type === ChannelType.GuildVoice ? 'voice' : 'text';
    } else if (interaction.channel) {
      bindingChannelType =
        interaction.channel.type === ChannelType.GuildVoice ? 'voice' : 'text';
    }

    // Resolve game from the IGDB games catalog (matches /event create behavior)
    const gameName = interaction.options.getString('game');
    let gameId: number | null = null;
    let resolvedGameName: string | null = null;

    if (gameName) {
      const [match] = await this.db
        .select({ id: schema.games.id, name: schema.games.name })
        .from(schema.games)
        .where(ilike(schema.games.name, gameName))
        .limit(1);

      if (match) {
        gameId = match.id;
        resolvedGameName = match.name;
      } else {
        await interaction.editReply(
          `Game "${gameName}" not found. Use autocomplete to find available games.`,
        );
        return;
      }
    }

    // Detect behavior based on channel type
    const behavior =
      this.channelBindingsService.detectBehavior(bindingChannelType);

    // Create/update the binding
    try {
      await this.channelBindingsService.bind(
        guildId,
        channelId,
        bindingChannelType,
        behavior,
        gameId,
      );

      const behaviorLabel =
        behavior === 'game-announcements'
          ? 'Event Announcements'
          : 'Event Announcements';

      const description = [
        `**#${channelName}** bound for **${behaviorLabel}**`,
        resolvedGameName ? `Game: **${resolvedGameName}**` : null,
        '',
        'Use the web admin panel for fine-tuning settings.',
      ]
        .filter((line) => line !== null)
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor(0x34d399) // Emerald
        .setTitle('Channel Bound')
        .setDescription(description);

      const components: ActionRowBuilder<ButtonBuilder>[] = [];
      const clientUrl = process.env.CLIENT_URL ?? null;
      if (clientUrl) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Fine-Tune in Admin Panel')
            .setStyle(ButtonStyle.Link)
            .setURL(`${clientUrl}/admin/settings/integrations/channel-bindings`)
            .setEmoji({ name: '\uD83D\uDD27' }),
        );
        components.push(row);
      }

      await interaction.editReply({
        embeds: [embed],
        components,
      });
    } catch (error) {
      this.logger.error('Failed to create channel binding:', error);
      await interaction.editReply(
        'Failed to bind channel. Please try again or use the web admin panel.',
      );
    }
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'game') {
      const filters = buildWordMatchFilters(schema.games.name, focused.value);
      const results = await this.db
        .select({
          id: schema.games.id,
          name: schema.games.name,
        })
        .from(schema.games)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .limit(25);

      await interaction.respond(
        results.map((g) => ({ name: g.name, value: g.name })),
      );
    }
  }
}
