import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { and, isNotNull, gte, sql, ilike, eq } from 'drizzle-orm';
import { escapeLikePattern } from '../../common/search.util';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
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
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
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
      .addStringOption((opt) =>
        opt
          .setName('series')
          .setDescription(
            'Unbind only a specific event series (leave empty to unbind game binding)',
          )
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

    const channelOption = interaction.options.getChannel('channel');
    const targetChannel = channelOption ?? interaction.channel;
    if (!targetChannel) {
      await interaction.editReply('Could not determine the target channel.');
      return;
    }

    const channelId = targetChannel.id;
    const channelName =
      'name' in targetChannel ? targetChannel.name : channelId;

    // ROK-435: Resolve optional series parameter
    const seriesValue = interaction.options.getString('series');
    let recurrenceGroupId: string | null = null;
    let resolvedSeriesTitle: string | null = null;

    if (seriesValue) {
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
      }
    }

    try {
      const removed = await this.channelBindingsService.unbind(
        guildId,
        channelId,
        recurrenceGroupId,
      );

      if (removed) {
        const suffix = resolvedSeriesTitle
          ? ` (series: **${resolvedSeriesTitle}**)`
          : '';
        const embed = new EmbedBuilder()
          .setColor(0xef4444) // Red
          .setTitle('Channel Unbound')
          .setDescription(`Removed binding for **#${channelName}**${suffix}.`);

        await interaction.editReply({ embeds: [embed] });
      } else {
        const suffix = resolvedSeriesTitle
          ? ` for series **${resolvedSeriesTitle}**`
          : '';
        await interaction.editReply(
          `No binding found for **#${channelName}**${suffix}.`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to unbind channel:', error);
      await interaction.editReply(
        'Failed to unbind channel. Please try again.',
      );
    }
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'series') {
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
