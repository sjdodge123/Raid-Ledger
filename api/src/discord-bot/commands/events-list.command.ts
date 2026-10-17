import { Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  ComponentType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  type Message,
} from 'discord.js';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';
import type { EventResponseDto } from '@raid-ledger/contract';
import { buildListView, buildDetailEmbed } from './events-list.helpers';

const MAX_EVENTS = 10;
const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

      const { embed, components } = buildListView(
        result.data,
        result.meta.total,
      );
      const reply = await interaction.editReply({
        embeds: [embed],
        components,
      });

      this.attachCollector(interaction, reply, result.data);
    } catch (error) {
      this.logger.error('Failed to list events:', error);
      await interaction.editReply(
        'Failed to fetch upcoming events. Please try again later.',
      );
    }
  }

  // ─── Collector ──────────────────────────────────────────

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
      this.routeCollectorEvent(
        i as StringSelectMenuInteraction | ButtonInteraction,
        events,
      );
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  }

  private routeCollectorEvent(
    i: StringSelectMenuInteraction | ButtonInteraction,
    events: EventResponseDto[],
  ): void {
    const handle = async (): Promise<void> => {
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
  }

  // ─── Interaction handlers ──────────────────────────────

  private async handleEventSelect(
    interaction: StringSelectMenuInteraction,
    cachedEvents: EventResponseDto[],
  ): Promise<void> {
    try {
      const eventId = Number(interaction.values[0]);
      const event = await this.fetchOrFallback(eventId, cachedEvents);

      if (!event) {
        await this.restoreListWithMessage(
          interaction,
          cachedEvents,
          'That event is no longer available.',
        );
        return;
      }

      await this.showDetailView(interaction, event);
    } catch (error) {
      this.logger.error('Error showing event detail:', error);
      await this.restoreListWithMessage(
        interaction,
        cachedEvents,
        'Something went wrong loading event details.',
      );
    }
  }

  private async restoreListWithMessage(
    interaction: StringSelectMenuInteraction,
    cachedEvents: EventResponseDto[],
    content: string,
  ): Promise<void> {
    const { embed, components } = buildListView(
      cachedEvents,
      cachedEvents.length,
    );
    await interaction.update({ content, embeds: [embed], components });
  }

  private async showDetailView(
    interaction: StringSelectMenuInteraction,
    event: EventResponseDto,
  ): Promise<void> {
    const eventUrl = await this.resolveEventUrl(event.id, interaction.user.id);
    const { embed, components } = buildDetailEmbed(event, eventUrl);
    await interaction.update({
      content: '',
      embeds: [embed],
      components,
    });
  }

  private async handleBackToList(
    interaction: ButtonInteraction,
    cachedEvents: EventResponseDto[],
  ): Promise<void> {
    const result = await this.fetchUpcomingEvents();

    if (!result || result.data.length === 0) {
      const fallback = result
        ? { data: [], total: 0 }
        : { data: cachedEvents, total: cachedEvents.length };

      if (fallback.data.length === 0) {
        await interaction.update({
          content: 'No upcoming events found.',
          embeds: [],
          components: [],
        });
        return;
      }

      const { embed, components } = buildListView(
        fallback.data,
        fallback.total,
      );
      await interaction.update({ content: '', embeds: [embed], components });
      return;
    }

    const { embed, components } = buildListView(result.data, result.meta.total);
    await interaction.update({ content: '', embeds: [embed], components });
  }

  // ─── Helpers ──────────────────────────────────────────

  private async fetchOrFallback(
    eventId: number,
    cached: EventResponseDto[],
  ): Promise<EventResponseDto | undefined> {
    try {
      return await this.eventsService.findOne(eventId);
    } catch {
      return cached.find((e) => e.id === eventId);
    }
  }

  private async fetchUpcomingEvents(): Promise<{
    data: EventResponseDto[];
    meta: { total: number };
  } | null> {
    try {
      return await this.eventsService.findAll({
        upcoming: 'true',
        limit: MAX_EVENTS,
        page: 1,
      });
    } catch {
      return null;
    }
  }

  private async resolveEventUrl(
    eventId: number,
    discordUserId: string,
  ): Promise<string | null> {
    const clientUrl = process.env.CLIENT_URL ?? null;
    if (!clientUrl) return null;

    const user = await this.usersService.findByDiscordId(discordUserId);
    if (!user) return `${clientUrl}/events/${eventId}`;

    const magicLink = await this.magicLinkService.generateLink(
      user.id,
      `/events/${eventId}`,
      clientUrl,
    );
    return magicLink ?? `${clientUrl}/events/${eventId}`;
  }
}
