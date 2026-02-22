import { Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  type Message,
} from 'discord.js';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { EMBED_COLORS } from '../discord-bot.constants';
import { toDiscordTimestamp } from '../utils/time-parser';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';
import type { EventResponseDto } from '@raid-ledger/contract';

const MAX_EVENTS = 10;
const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DESCRIPTION_MAX_LENGTH = 1024;

@Injectable()
export class EventsListCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'events';
  private readonly logger = new Logger(EventsListCommand.name);

  constructor(
    private readonly eventsService: EventsService,
    private readonly usersService: UsersService,
    private readonly magicLinkService: MagicLinkService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('events')
      .setDescription('List upcoming events')
      .setDMPermission(true)
      .toJSON();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await this.eventsService.findAll({
        upcoming: 'true',
        limit: MAX_EVENTS,
        page: 1,
      });

      if (result.data.length === 0) {
        await interaction.editReply('No upcoming events found.');
        return;
      }

      const { embed: listEmbed, components: listComponents } =
        this.buildListView(result.data, result.meta.total);

      const reply = await interaction.editReply({
        embeds: [listEmbed],
        components: listComponents,
      });

      this.attachCollector(interaction, reply, result.data);
    } catch (error) {
      this.logger.error('Failed to list events:', error);
      await interaction.editReply(
        'Failed to fetch upcoming events. Please try again later.',
      );
    }
  }

  private buildListView(
    events: EventResponseDto[],
    total: number,
  ): {
    embed: EmbedBuilder;
    components: (
      | ActionRowBuilder<StringSelectMenuBuilder>
      | ActionRowBuilder<ButtonBuilder>
    )[];
  } {
    const clientUrl = process.env.CLIENT_URL ?? null;

    const lines = events.map((event) => {
      const startDate = new Date(event.startTime);
      const gameName = event.game?.name ?? 'No game';
      const roster = event.maxAttendees
        ? `${event.signupCount}/${event.maxAttendees}`
        : `${event.signupCount} signed up`;

      return [
        `**${event.title}**`,
        `${gameName} | ${toDiscordTimestamp(startDate, 'f')} | ${roster}`,
      ].join('\n');
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.ANNOUNCEMENT)
      .setTitle('Upcoming Events')
      .setDescription(lines.join('\n\n'))
      .setFooter({
        text: `Showing ${events.length} of ${total} upcoming events`,
      })
      .setTimestamp();

    const components: (
      | ActionRowBuilder<StringSelectMenuBuilder>
      | ActionRowBuilder<ButtonBuilder>
    )[] = [];

    // Dropdown to select an event
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('event_select')
      .setPlaceholder('Select an event for details...')
      .addOptions(
        events.map((event) => {
          const startDate = new Date(event.startTime);
          const gameName = event.game?.name ?? 'No game';
          const dateStr = startDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          return {
            label: event.title.slice(0, 100),
            value: String(event.id),
            description: `${gameName} — ${dateStr}`.slice(0, 100),
          };
        }),
      );

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
    );

    if (clientUrl) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('View All in Raid Ledger')
            .setStyle(ButtonStyle.Link)
            .setURL(`${clientUrl}/events`),
        ),
      );
    }

    return { embed, components };
  }

  private async buildDetailView(
    event: EventResponseDto,
    discordUserId: string,
  ): Promise<{
    embed: EmbedBuilder;
    components: ActionRowBuilder<ButtonBuilder>[];
  }> {
    const clientUrl = process.env.CLIENT_URL ?? null;
    const startDate = new Date(event.startTime);
    const endDate = new Date(event.endTime);
    const durationMs = endDate.getTime() - startDate.getTime();
    const durationHours = Math.round((durationMs / (1000 * 60 * 60)) * 10) / 10;
    const durationStr =
      durationHours === 1 ? '1 hour' : `${durationHours} hours`;

    const gameName = event.game?.name ?? 'No game';
    const roster = event.maxAttendees
      ? `${event.signupCount}/${event.maxAttendees}`
      : `${event.signupCount} signed up`;
    const creatorName = event.creator?.username ?? 'Unknown';

    const descriptionLines = [
      `**Game:** ${gameName}`,
      `**When:** ${toDiscordTimestamp(startDate, 'F')} (${toDiscordTimestamp(startDate, 'R')})`,
      `**Duration:** ${durationStr}`,
      `**Signups:** ${roster}`,
      `**Created by:** ${creatorName}`,
    ];

    if (event.description) {
      const truncated =
        event.description.length > DESCRIPTION_MAX_LENGTH
          ? event.description.slice(0, DESCRIPTION_MAX_LENGTH - 3) + '...'
          : event.description;
      descriptionLines.push('', truncated);
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.ANNOUNCEMENT)
      .setTitle(event.title)
      .setDescription(descriptionLines.join('\n'))
      .setTimestamp();

    if (event.game?.coverUrl) {
      embed.setThumbnail(event.game.coverUrl);
    }

    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    const buttons: ButtonBuilder[] = [];

    // Magic link or plain link button
    if (clientUrl) {
      let eventUrl = `${clientUrl}/events/${event.id}`;
      const user = await this.usersService.findByDiscordId(discordUserId);
      if (user) {
        const magicLink = await this.magicLinkService.generateLink(
          user.id,
          `/events/${event.id}`,
          clientUrl,
        );
        if (magicLink) {
          eventUrl = magicLink;
        }
      }

      buttons.push(
        new ButtonBuilder()
          .setLabel('View in Raid Ledger')
          .setStyle(ButtonStyle.Link)
          .setURL(eventUrl),
      );
    }

    // Back to list button
    buttons.push(
      new ButtonBuilder()
        .setCustomId('events_back')
        .setLabel('Back to list')
        .setStyle(ButtonStyle.Secondary),
    );

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
    );

    return { embed, components };
  }

  private attachCollector(
    interaction: ChatInputCommandInteraction,
    reply: Message,
    events: EventResponseDto[],
  ): void {
    const collector = reply.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: COLLECTOR_TIMEOUT_MS,
    });

    collector.on('collect', (i) => {
      const handle = async () => {
        if (
          i.componentType === ComponentType.StringSelect &&
          i.customId === 'event_select'
        ) {
          await this.handleEventSelect(i, events);
        } else if (
          i.componentType === ComponentType.Button &&
          i.customId === 'events_back'
        ) {
          await this.handleBackToList(i, events);
        }
      };
      handle().catch((error) => {
        this.logger.error('Error handling events interaction:', error);
      });
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  }

  private async handleEventSelect(
    interaction: StringSelectMenuInteraction,
    cachedEvents: EventResponseDto[],
  ): Promise<void> {
    const eventId = Number(interaction.values[0]);

    try {
      // Try to fetch fresh data; fall back to cached if event was deleted
      let event: EventResponseDto | undefined;
      try {
        event = await this.eventsService.findOne(eventId);
      } catch {
        // Event may have been deleted between list and selection
        event = cachedEvents.find((e) => e.id === eventId);
      }

      if (!event) {
        // Event was deleted and not in cache — restore list view
        const total = cachedEvents.length;
        const { embed, components } = this.buildListView(cachedEvents, total);
        await interaction.update({
          content: 'That event is no longer available.',
          embeds: [embed],
          components,
        });
        return;
      }

      const { embed, components } = await this.buildDetailView(
        event,
        interaction.user.id,
      );
      await interaction.update({
        content: '',
        embeds: [embed],
        components,
      });
    } catch (error) {
      this.logger.error('Error showing event detail:', error);
      const total = cachedEvents.length;
      const { embed, components } = this.buildListView(cachedEvents, total);
      await interaction.update({
        content: 'Something went wrong loading event details.',
        embeds: [embed],
        components,
      });
    }
  }

  private async handleBackToList(
    interaction: ButtonInteraction,
    cachedEvents: EventResponseDto[],
  ): Promise<void> {
    // Re-fetch to get the latest list
    try {
      const result = await this.eventsService.findAll({
        upcoming: 'true',
        limit: MAX_EVENTS,
        page: 1,
      });

      if (result.data.length === 0) {
        await interaction.update({
          content: 'No upcoming events found.',
          embeds: [],
          components: [],
        });
        return;
      }

      const { embed, components } = this.buildListView(
        result.data,
        result.meta.total,
      );
      await interaction.update({
        content: '',
        embeds: [embed],
        components,
      });
    } catch {
      // Fallback to cached events
      const total = cachedEvents.length;
      const { embed, components } = this.buildListView(cachedEvents, total);
      await interaction.update({
        content: '',
        embeds: [embed],
        components,
      });
    }
  }
}
