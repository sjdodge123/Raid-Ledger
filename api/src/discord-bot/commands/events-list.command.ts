import { Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { EventsService } from '../../events/events.service';
import { EMBED_COLORS } from '../discord-bot.constants';
import { toDiscordTimestamp } from '../utils/time-parser';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

const MAX_EVENTS = 5;

@Injectable()
export class EventsListCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'events';
  private readonly logger = new Logger(EventsListCommand.name);

  constructor(private readonly eventsService: EventsService) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('events')
      .setDescription('List upcoming events')
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

      const clientUrl = process.env.CLIENT_URL ?? null;

      const lines = result.data.map((event) => {
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
          text: `Showing ${result.data.length} of ${result.meta.total} upcoming events`,
        })
        .setTimestamp();

      const components: ActionRowBuilder<ButtonBuilder>[] = [];
      if (clientUrl) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('View All in Raid Ledger')
            .setStyle(ButtonStyle.Link)
            .setURL(`${clientUrl}/events`),
        );
        components.push(row);
      }

      await interaction.editReply({
        embeds: [embed],
        components,
      });
    } catch (error) {
      this.logger.error('Failed to list events:', error);
      await interaction.editReply(
        'Failed to fetch upcoming events. Please try again later.',
      );
    }
  }
}
