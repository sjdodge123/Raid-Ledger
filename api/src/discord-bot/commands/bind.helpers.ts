import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { and, sql, ilike, eq, notInArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schemaType from '../../drizzle/schema';
import * as schema from '../../drizzle/schema';

// Re-export autocomplete functions for backward compatibility
export {
  autocompleteGames,
  autocompleteSeries,
  autocompleteEvents,
} from './bind.autocomplete';

/**
 * Build the success embed for a channel binding.
 */
export function buildBindSuccessEmbed(
  channelName: string,
  behavior: string,
  resolvedSeriesTitle: string | null,
  resolvedGameName: string | null,
  replacedChannelIds: string[],
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
  const description = buildBindDescription(
    channelName,
    behavior,
    resolvedSeriesTitle,
    resolvedGameName,
    replacedChannelIds,
  );
  const embed = new EmbedBuilder()
    .setColor(0x34d399)
    .setTitle('Channel Bound')
    .setDescription(description);
  return { embed, components: buildAdminLinkComponents() };
}

/** Build the description text for a bind success embed. */
function buildBindDescription(
  channelName: string,
  behavior: string,
  seriesTitle: string | null,
  gameName: string | null,
  replacedIds: string[],
): string {
  const behaviorLabels: Record<string, string> = {
    'game-announcements': 'Event Announcements',
    'game-voice-monitor': 'Activity Monitor',
    'general-lobby': 'General Lobby (auto-detect games)',
  };
  const label = behaviorLabels[behavior] ?? 'Activity Monitor';
  return [
    `**#${channelName}** bound for **${label}**`,
    seriesTitle ? `Series: **${seriesTitle}**` : null,
    gameName ? `Game: **${gameName}**` : null,
    replacedIds.length > 0
      ? `\n\u26A0\uFE0F Replaced previous binding from ${replacedIds.map((id) => `<#${id}>`).join(', ')}`
      : null,
    '',
    'Use the web admin panel for fine-tuning settings.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/** Build admin panel link button components. */
function buildAdminLinkComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const clientUrl = process.env.CLIENT_URL ?? null;
  if (clientUrl) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Fine-Tune in Admin Panel')
          .setStyle(ButtonStyle.Link)
          .setURL(`${clientUrl}/admin/settings/integrations/channel-bindings`)
          .setEmoji({ name: '\uD83D\uDD27' }),
      ),
    );
  }
  return components;
}

/**
 * Build the success embed for an event binding update.
 */
export function buildEventBindEmbed(
  eventTitle: string,
  changes: string[],
): EmbedBuilder {
  const description = [
    `**${eventTitle}** updated:`,
    ...changes.map((c) => `- ${c}`),
  ].join('\n');

  return new EmbedBuilder()
    .setColor(0x34d399)
    .setTitle('Event Binding Updated')
    .setDescription(description);
}

/**
 * Fetch the actual signup count for an event (excluding declined/departed).
 */
export async function getSignupCount(
  db: PostgresJsDatabase<typeof schemaType>,
  eventId: number,
): Promise<number> {
  const [result] = await db
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
  return result?.count ?? 0;
}

/**
 * Build an event update payload for emission after bind changes.
 */
export async function buildEventUpdatePayload(
  db: PostgresJsDatabase<typeof schemaType>,
  eventId: number,
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ events: schema.events, games: schema.games })
    .from(schema.events)
    .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!row) return null;
  const signupCount = await getSignupCount(db, eventId);
  return formatUpdatePayload(eventId, row, signupCount);
}

/** Format the raw event+game row into an update payload. */
function formatUpdatePayload(
  eventId: number,
  row: {
    events: typeof schema.events.$inferSelect;
    games: typeof schema.games.$inferSelect | null;
  },
  signupCount: number,
): Record<string, unknown> {
  return {
    eventId,
    event: {
      id: row.events.id,
      title: row.events.title,
      description: row.events.description,
      startTime: row.events.duration[0].toISOString(),
      endTime: row.events.duration[1].toISOString(),
      signupCount,
      maxAttendees: row.events.maxAttendees,
      slotConfig: row.events.slotConfig,
      game: row.games
        ? { name: row.games.name, coverUrl: row.games.coverUrl }
        : null,
    },
    gameId: row.events.gameId ?? null,
    recurrenceGroupId: row.events.recurrenceGroupId ?? null,
    notificationChannelOverride: row.events.notificationChannelOverride ?? null,
  };
}

/** Set a notification channel override on an event. */
export async function setChannelOverride(
  db: PostgresJsDatabase<typeof schemaType>,
  eventId: number,
  channelId: string,
): Promise<void> {
  await db
    .update(schema.events)
    .set({ notificationChannelOverride: channelId, updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
}

/** Apply a game change to an event. Returns a description string or null. */
export async function applyGameChange(
  db: PostgresJsDatabase<typeof schemaType>,
  eventId: number,
  gameName: string,
): Promise<{ change: string } | { error: string } | null> {
  if (
    gameName.toLowerCase() === 'none' ||
    gameName.toLowerCase() === 'general'
  ) {
    await db
      .update(schema.events)
      .set({ gameId: null, updatedAt: new Date() })
      .where(eq(schema.events.id, eventId));
    return { change: 'Game removed (set to General)' };
  }

  const [gameMatch] = await db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(ilike(schema.games.name, gameName))
    .limit(1);

  if (!gameMatch) return { error: `Game "${gameName}" not found.` };

  await db
    .update(schema.events)
    .set({ gameId: gameMatch.id, updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
  return { change: `Game reassigned to **${gameMatch.name}**` };
}
