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
import { and, ilike, isNotNull, gte, sql, eq } from 'drizzle-orm';
import { escapeLikePattern } from '../../common/search.util';
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
      .setDescription('Bind a Discord channel to a game or event series')
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
      .addStringOption((opt) =>
        opt
          .setName('series')
          .setDescription('Event series (recurrence group)')
          .setAutocomplete(true),
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

    // ROK-435: Resolve series (recurrence group) from autocomplete
    const seriesValue = interaction.options.getString('series');
    let recurrenceGroupId: string | null = null;
    let resolvedSeriesTitle: string | null = null;

    if (seriesValue) {
      // The autocomplete value is the recurrence group UUID
      const [seriesMatch] = await this.db
        .select({
          recurrenceGroupId: schema.events.recurrenceGroupId,
          title: schema.events.title,
        })
        .from(schema.events)
        .where(eq(schema.events.recurrenceGroupId, seriesValue))
        .limit(1);

      if (seriesMatch?.recurrenceGroupId) {
        recurrenceGroupId = seriesMatch.recurrenceGroupId;
        resolvedSeriesTitle = seriesMatch.title;
      } else {
        await interaction.editReply(
          'Event series not found. Use autocomplete to find available series.',
        );
        return;
      }
    }

    // Detect behavior based on channel type and game
    const behavior = this.channelBindingsService.detectBehavior(
      bindingChannelType,
      gameId,
    );

    // Create/update the binding
    try {
      const { replacedChannelIds } = await this.channelBindingsService.bind(
        guildId,
        channelId,
        bindingChannelType,
        behavior,
        gameId,
        undefined,
        recurrenceGroupId,
      );

      const behaviorLabels: Record<string, string> = {
        'game-announcements': 'Event Announcements',
        'game-voice-monitor': 'Activity Monitor',
        'general-lobby': 'General Lobby (auto-detect games)',
      };
      const behaviorLabel = behaviorLabels[behavior] ?? 'Activity Monitor';

      const description = [
        `**#${channelName}** bound for **${behaviorLabel}**`,
        resolvedSeriesTitle ? `Series: **${resolvedSeriesTitle}**` : null,
        resolvedGameName ? `Game: **${resolvedGameName}**` : null,
        replacedChannelIds.length > 0
          ? `\n⚠️ Replaced previous binding from ${replacedChannelIds.map((id) => `<#${id}>`).join(', ')}`
          : null,
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
    } else if (focused.name === 'series') {
      // ROK-435: Autocomplete for event series — show active recurrence groups with future instances
      const now = new Date().toISOString();
      const searchValue = focused.value.toLowerCase();

      const results = await this.db
        .selectDistinctOn([schema.events.recurrenceGroupId], {
          recurrenceGroupId: schema.events.recurrenceGroupId,
          title: schema.events.title,
          recurrenceRule: schema.events.recurrenceRule,
        })
        .from(schema.events)
        .where(
          and(
            isNotNull(schema.events.recurrenceGroupId),
            gte(sql`upper(${schema.events.duration})`, sql`${now}::timestamp`),
            sql`${schema.events.cancelledAt} IS NULL`,
            searchValue
              ? ilike(
                  schema.events.title,
                  `%${escapeLikePattern(searchValue)}%`,
                )
              : undefined,
          ),
        )
        .limit(25);

      await interaction.respond(
        results
          .filter(
            (r): r is typeof r & { recurrenceGroupId: string } =>
              r.recurrenceGroupId !== null,
          )
          .map((r) => {
            const rule = r.recurrenceRule as {
              frequency?: string;
            } | null;
            const freq = rule?.frequency ? ` (${rule.frequency})` : '';
            const label = `${r.title}${freq}`.slice(0, 100);
            return {
              name: label,
              value: r.recurrenceGroupId,
            };
          }),
      );
    }
  }
}
