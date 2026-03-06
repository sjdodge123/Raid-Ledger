import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '../discord-bot.constants';
import { toDiscordTimestamp } from '../utils/time-parser';
import type { EventResponseDto } from '@raid-ledger/contract';

const DESCRIPTION_MAX_LENGTH = 1024;

/**
 * Build the list view embed and components.
 */
export function buildListView(
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
  const lines = events.map(formatEventLine);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.ANNOUNCEMENT)
    .setTitle('Upcoming Events')
    .setDescription(lines.join('\n\n'))
    .setFooter({
      text: `Showing ${events.length} of ${total} upcoming events`,
    })
    .setTimestamp();

  const components = buildListComponents(events, clientUrl);
  return { embed, components };
}

function formatEventLine(event: EventResponseDto): string {
  const startDate = new Date(event.startTime);
  const gameName = event.game?.name ?? 'No game';
  const roster = event.maxAttendees
    ? `${event.signupCount}/${event.maxAttendees}`
    : `${event.signupCount} signed up`;
  return [
    `**${event.title}**`,
    `${gameName} | ${toDiscordTimestamp(startDate, 'f')} | ${roster}`,
  ].join('\n');
}

function buildListComponents(
  events: EventResponseDto[],
  clientUrl: string | null,
): (
  | ActionRowBuilder<StringSelectMenuBuilder>
  | ActionRowBuilder<ButtonBuilder>
)[] {
  const components: (
    | ActionRowBuilder<StringSelectMenuBuilder>
    | ActionRowBuilder<ButtonBuilder>
  )[] = [];

  const selectMenu = buildEventSelectMenu(events);
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

  return components;
}

function buildEventSelectMenu(
  events: EventResponseDto[],
): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
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
          description: `${gameName} \u2014 ${dateStr}`.slice(0, 100),
        };
      }),
    );
}

/**
 * Build the detail view embed and components for a single event.
 */
export function buildDetailEmbed(
  event: EventResponseDto,
  eventUrl: string | null,
): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = buildDetailEmbedBody(event);
  const components = buildDetailButtons(eventUrl);
  return { embed, components };
}

function buildDetailEmbedBody(event: EventResponseDto): EmbedBuilder {
  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);
  const durationMs = endDate.getTime() - startDate.getTime();
  const durationHours = Math.round((durationMs / (1000 * 60 * 60)) * 10) / 10;
  const durationStr = durationHours === 1 ? '1 hour' : `${durationHours} hours`;

  const descriptionLines = buildDescriptionLines(event, startDate, durationStr);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.ANNOUNCEMENT)
    .setTitle(event.title)
    .setDescription(descriptionLines.join('\n'))
    .setTimestamp();

  if (event.game?.coverUrl) embed.setThumbnail(event.game.coverUrl);
  return embed;
}

function buildDescriptionLines(
  event: EventResponseDto,
  startDate: Date,
  durationStr: string,
): string[] {
  const gameName = event.game?.name ?? 'No game';
  const roster = event.maxAttendees
    ? `${event.signupCount}/${event.maxAttendees}`
    : `${event.signupCount} signed up`;
  const creatorName = event.creator?.username ?? 'Unknown';

  const lines = [
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
    lines.push('', truncated);
  }

  return lines;
}

function buildDetailButtons(
  eventUrl: string | null,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons: ButtonBuilder[] = [];
  if (eventUrl) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('View in Raid Ledger')
        .setStyle(ButtonStyle.Link)
        .setURL(eventUrl),
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId('events_back')
      .setLabel('Back to list')
      .setStyle(ButtonStyle.Secondary),
  );

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}
