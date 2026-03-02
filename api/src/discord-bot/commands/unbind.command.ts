import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { and, isNotNull, gte, sql, ilike, eq, isNull } from 'drizzle-orm';
import { escapeLikePattern } from '../../common/search.util';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../discord-bot.constants';
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
    private readonly eventEmitter: EventEmitter2,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('unbind')
      .setDescription('Remove a channel binding or event override')
      .setDMPermission(false)
      .addStringOption((opt) =>
        opt
          .setName('event')
          .setDescription(
            'Clear notification channel override for a specific event',
          )
          .setAutocomplete(true),
      )
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

    // ROK-599: Check if this is an event-level unbind
    const eventValue = interaction.options.getString('event');
    if (eventValue) {
      await this.handleEventUnbind(interaction, eventValue);
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

  /**
   * ROK-599: Clear the per-event notification channel override.
   */
  private async handleEventUnbind(
    interaction: ChatInputCommandInteraction,
    eventIdStr: string,
  ): Promise<void> {
    const eventId = parseInt(eventIdStr, 10);
    if (isNaN(eventId)) {
      await interaction.editReply(
        'Invalid event. Use autocomplete to select an event.',
      );
      return;
    }

    // Look up the event
    const [event] = await this.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        creatorId: schema.events.creatorId,
        gameId: schema.events.gameId,
        recurrenceGroupId: schema.events.recurrenceGroupId,
        notificationChannelOverride: schema.events.notificationChannelOverride,
        duration: schema.events.duration,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      await interaction.editReply(
        'Event not found. Use autocomplete to select an event.',
      );
      return;
    }

    // Permission check
    const discordId = interaction.user.id;
    const [user] = await this.db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.discordId, discordId))
      .limit(1);

    if (!user) {
      await interaction.editReply(
        'You need a Raid Ledger account linked to Discord to use this command.',
      );
      return;
    }

    const isAdmin = user.role === 'admin' || user.role === 'operator';
    if (event.creatorId !== user.id && !isAdmin) {
      await interaction.editReply(
        'You can only modify events you created, or you need operator/admin permissions.',
      );
      return;
    }

    if (!event.notificationChannelOverride) {
      await interaction.editReply(
        `**${event.title}** has no notification channel override to clear.`,
      );
      return;
    }

    await this.db
      .update(schema.events)
      .set({
        notificationChannelOverride: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.events.id, eventId));

    // Re-fetch for embed update
    const [updatedEvent] = await this.db
      .select({
        events: schema.events,
        games: schema.games,
      })
      .from(schema.events)
      .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
      .where(eq(schema.events.id, eventId))
      .limit(1);

    // Emit event.updated to trigger embed re-render with default channel resolution
    if (updatedEvent) {
      this.eventEmitter.emit(APP_EVENT_EVENTS.UPDATED, {
        eventId,
        event: {
          id: updatedEvent.events.id,
          title: updatedEvent.events.title,
          description: updatedEvent.events.description,
          startTime: updatedEvent.events.duration[0].toISOString(),
          endTime: updatedEvent.events.duration[1].toISOString(),
          signupCount: 0,
          maxAttendees: updatedEvent.events.maxAttendees,
          slotConfig: updatedEvent.events.slotConfig,
          game: updatedEvent.games
            ? {
                name: updatedEvent.games.name,
                coverUrl: updatedEvent.games.coverUrl,
              }
            : null,
        },
        gameId: updatedEvent.events.gameId ?? null,
        recurrenceGroupId: updatedEvent.events.recurrenceGroupId ?? null,
        notificationChannelOverride: null,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0xef4444) // Red
      .setTitle('Event Override Cleared')
      .setDescription(
        `Notification channel override removed for **${event.title}**.\nEmbeds will now use the default channel resolution.`,
      );

    await interaction.editReply({ embeds: [embed] });
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'event') {
      // ROK-599: Autocomplete for events with notification channel override
      await this.autocompleteEvents(interaction, focused.value);
    } else if (focused.name === 'series') {
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

  /**
   * ROK-599: Autocomplete for upcoming events the user can manage.
   */
  private async autocompleteEvents(
    interaction: AutocompleteInteraction,
    searchValue: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const discordId = interaction.user.id;

    const [user] = await this.db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.discordId, discordId))
      .limit(1);

    const conditions = [
      gte(sql`upper(${schema.events.duration})`, sql`${now}::timestamp`),
      isNull(schema.events.cancelledAt),
    ];

    if (user && user.role !== 'admin' && user.role !== 'operator') {
      conditions.push(eq(schema.events.creatorId, user.id));
    }

    if (searchValue) {
      conditions.push(
        ilike(
          schema.events.title,
          `%${escapeLikePattern(searchValue.toLowerCase())}%`,
        ),
      );
    }

    const results = await this.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        duration: schema.events.duration,
      })
      .from(schema.events)
      .where(and(...conditions))
      .orderBy(sql`lower(${schema.events.duration})`)
      .limit(25);

    await interaction.respond(
      results.map((e) => {
        const date = e.duration[0].toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        const label = `${e.title} (${date})`.slice(0, 100);
        return { name: label, value: String(e.id) };
      }),
    );
  }
}
