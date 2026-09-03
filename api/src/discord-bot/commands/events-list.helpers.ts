/**
 * ROK-1462 (slice D) — `/events` list + detail rendering.
 *
 * Both views moved onto the shared command-reply chrome (D5/AC2): slate `done`
 * with the state in the author line, instead of the announcement blue and the
 * bespoke `Upcoming Events` title they used to own. This file never calls
 * `.setColor` — the chrome owns the colour (D9/D10).
 */
import { absoluteEmbedImageUrl } from '../services/embed-thumbnail.helpers';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import {
  COMMAND_REPLY_AUTHORS,
  eventsListAuthorLine,
  eventsListFooterLabel,
} from './command-reply-chrome.helpers';
import { toDiscordTimestamp } from '../utils/time-parser';
import type { EventResponseDto } from '@raid-ledger/contract';

const DESCRIPTION_MAX_LENGTH = 1024;

/**
 * Build the `/events` list view embed and components.
 *
 * The count lives in the chrome (author line + footer label), so the view
 * carries no title of its own — one statement of the count, not three.
 *
 * @param events - The page of upcoming events being rendered.
 * @param total - How many upcoming events matched overall.
 * @returns The reply embed and its select-menu / link-button rows.
 */
export function buildListView(
  events: EventResponseDto[],
  total: number,
): {
  embed: ChannelEmbed;
  components: (
    ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>
  )[];
} {
  const clientUrl = process.env.CLIENT_URL ?? null;
  const lines = events.map(formatEventLine);

  const embed = createChannelEmbed({
    state: 'done',
    authorLine: eventsListAuthorLine(events.length, total),
    footerLabel: eventsListFooterLabel(events.length, total),
  });
  embed.setDescription(lines.join('\n\n'));

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
  ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>
)[] {
  const components: (
    ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>
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
 * Build the `/events` detail view embed and components for a single event.
 *
 * @param event - The selected event.
 * @param eventUrl - Absolute URL to the event page, when a web origin exists.
 * @returns The reply embed and its View / Back button row.
 */
export function buildDetailEmbed(
  event: EventResponseDto,
  eventUrl: string | null,
): {
  embed: ChannelEmbed;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = buildDetailEmbedBody(event);
  const components = buildDetailButtons(eventUrl);
  return { embed, components };
}

function buildDetailEmbedBody(event: EventResponseDto): ChannelEmbed {
  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);
  const durationMs = endDate.getTime() - startDate.getTime();
  const durationHours = Math.round((durationMs / (1000 * 60 * 60)) * 10) / 10;
  const durationStr = durationHours === 1 ? '1 hour' : `${durationHours} hours`;

  const descriptionLines = buildDescriptionLines(event, startDate, durationStr);

  const embed = createChannelEmbed({
    state: 'done',
    authorLine: COMMAND_REPLY_AUTHORS.EVENT_DETAIL,
  });
  embed.setTitle(event.title).setDescription(descriptionLines.join('\n'));

  const thumbnail = absoluteEmbedImageUrl(event.game?.coverUrl);
  if (thumbnail) embed.setThumbnail(thumbnail);
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
