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
import {
  and,
  ilike,
  isNotNull,
  gte,
  sql,
  eq,
  isNull,
  notInArray,
} from 'drizzle-orm';
import { escapeLikePattern } from '../../common/search.util';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { buildWordMatchFilters } from '../../common/search.util';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../discord-bot.constants';
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
    private readonly eventEmitter: EventEmitter2,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('bind')
      .setDescription(
        'Bind a Discord channel to a game, event series, or event',
      )
      .setDMPermission(false)
      .addStringOption((opt) =>
        opt
          .setName('event')
          .setDescription('Specific event to override channel or game for')
          .setAutocomplete(true),
      )
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

    // ROK-599: Check if this is an event-level bind
    const eventValue = interaction.options.getString('event');
    if (eventValue) {
      await this.handleEventBind(interaction, guildId, eventValue);
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

  /**
   * ROK-599: Handle per-event bind operations — notification channel override and/or game reassignment.
   */
  private async handleEventBind(
    interaction: ChatInputCommandInteraction,
    guildId: string,
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

    // Permission check: only event creator, operator, or admin
    const discordId = interaction.user.id;
    const [user] = await this.db
      .select({
        id: schema.users.id,
        role: schema.users.role,
      })
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

    const channelOption = interaction.options.getChannel('channel');
    const gameName = interaction.options.getString('game');

    if (!channelOption && !gameName) {
      await interaction.editReply(
        'When using `/bind event`, provide `channel` (notification override) and/or `game` (reassign game).',
      );
      return;
    }

    const changes: string[] = [];

    // Part 1: Notification channel override
    if (channelOption) {
      const channelId = channelOption.id;
      const channelName =
        'name' in channelOption ? channelOption.name : channelId;

      await this.db
        .update(schema.events)
        .set({
          notificationChannelOverride: channelId,
          updatedAt: new Date(),
        })
        .where(eq(schema.events.id, eventId));

      changes.push(
        `Notification channel set to **#${channelName}** (<#${channelId}>)`,
      );
    }

    // Part 2: Game reassignment
    let newGameId = event.gameId;
    if (gameName) {
      if (
        gameName.toLowerCase() === 'none' ||
        gameName.toLowerCase() === 'general'
      ) {
        // Remove game association
        await this.db
          .update(schema.events)
          .set({ gameId: null, updatedAt: new Date() })
          .where(eq(schema.events.id, eventId));
        newGameId = null;
        changes.push('Game removed (set to General)');
      } else {
        const [gameMatch] = await this.db
          .select({ id: schema.games.id, name: schema.games.name })
          .from(schema.games)
          .where(ilike(schema.games.name, gameName))
          .limit(1);

        if (!gameMatch) {
          await interaction.editReply(
            `Game "${gameName}" not found. Use autocomplete to find available games.`,
          );
          return;
        }

        await this.db
          .update(schema.events)
          .set({ gameId: gameMatch.id, updatedAt: new Date() })
          .where(eq(schema.events.id, eventId));
        newGameId = gameMatch.id;
        changes.push(`Game reassigned to **${gameMatch.name}**`);
      }
    }

    // Re-fetch the updated event to get fresh data for the embed update
    const [updatedEvent] = await this.db
      .select({
        events: schema.events,
        games: schema.games,
      })
      .from(schema.events)
      .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
      .where(eq(schema.events.id, eventId))
      .limit(1);

    // Fetch actual signup count (exclude declined/roached_out)
    const [signupResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          notInArray(schema.eventSignups.status, [
            'declined',
            'roached_out',
            'departed',
          ]),
        ),
      );
    const signupCount = signupResult?.count ?? 0;

    // Emit event.updated to trigger embed re-render with new channel/game
    if (updatedEvent) {
      this.eventEmitter.emit(APP_EVENT_EVENTS.UPDATED, {
        eventId,
        event: {
          id: updatedEvent.events.id,
          title: updatedEvent.events.title,
          description: updatedEvent.events.description,
          startTime: updatedEvent.events.duration[0].toISOString(),
          endTime: updatedEvent.events.duration[1].toISOString(),
          signupCount,
          maxAttendees: updatedEvent.events.maxAttendees,
          slotConfig: updatedEvent.events.slotConfig,
          game: updatedEvent.games
            ? {
                name: updatedEvent.games.name,
                coverUrl: updatedEvent.games.coverUrl,
              }
            : null,
        },
        gameId: newGameId,
        recurrenceGroupId: updatedEvent.events.recurrenceGroupId ?? null,
        notificationChannelOverride:
          updatedEvent.events.notificationChannelOverride ?? null,
      });
    }

    const description = [
      `**${event.title}** updated:`,
      ...changes.map((c) => `- ${c}`),
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x34d399) // Emerald
      .setTitle('Event Binding Updated')
      .setDescription(description);

    await interaction.editReply({ embeds: [embed] });
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'event') {
      // ROK-599: Autocomplete for upcoming events the user can manage
      await this.autocompleteEvents(interaction, focused.value);
    } else if (focused.name === 'game') {
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

  /**
   * ROK-599: Autocomplete for upcoming events the user can manage.
   * Shows events created by the user, plus all upcoming events for admin/operator.
   */
  private async autocompleteEvents(
    interaction: AutocompleteInteraction,
    searchValue: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const discordId = interaction.user.id;

    // Look up the user to check permissions
    const [user] = await this.db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.discordId, discordId))
      .limit(1);

    const conditions = [
      gte(sql`upper(${schema.events.duration})`, sql`${now}::timestamp`),
      isNull(schema.events.cancelledAt),
    ];

    // Non-admin users only see their own events
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
