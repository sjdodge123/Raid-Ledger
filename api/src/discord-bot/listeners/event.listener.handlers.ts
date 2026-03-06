import type { Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type {
  DiscordEmbedFactory,
  EmbedEventData,
  EmbedContext,
} from '../services/discord-embed.factory';
import type { EmbedPosterService } from '../services/embed-poster.service';
import type { ChannelResolverService } from '../services/channel-resolver.service';
import { EMBED_STATES } from '../discord-bot.constants';
import type { EventPayload } from './event.listener';

/** Dependencies for event listener handlers. */
export interface EventListenerDeps {
  db: PostgresJsDatabase<typeof schema>;
  clientService: DiscordBotClientService;
  embedFactory: DiscordEmbedFactory;
  embedPoster: EmbedPosterService;
  channelResolver: ChannelResolverService;
  logger: Logger;
}

type MessageRecord = typeof schema.discordEventMessages.$inferSelect;

/** Find all Discord message records for an event in the current guild. */
export async function findEventMessages(
  deps: EventListenerDeps,
  eventId: number,
): Promise<MessageRecord[]> {
  const guildId = deps.clientService.getGuildId();
  if (!guildId) return [];
  return deps.db
    .select()
    .from(schema.discordEventMessages)
    .where(
      and(
        eq(schema.discordEventMessages.eventId, eventId),
        eq(schema.discordEventMessages.guildId, guildId),
      ),
    );
}

/** Look up the Discord message record for game affinity notifications. */
export async function findDiscordMessageRecord(
  deps: EventListenerDeps,
  eventId: number,
): Promise<{ guildId: string; channelId: string; messageId: string } | null> {
  const [msgRecord] = await deps.db
    .select({
      guildId: schema.discordEventMessages.guildId,
      channelId: schema.discordEventMessages.channelId,
      messageId: schema.discordEventMessages.messageId,
    })
    .from(schema.discordEventMessages)
    .where(eq(schema.discordEventMessages.eventId, eventId))
    .limit(1);
  return msgRecord ?? null;
}

/** Update a single embed record on edit. */
export async function updateEmbedRecord(
  deps: EventListenerDeps,
  record: MessageRecord,
  eventData: EmbedEventData,
  context: EmbedContext,
  state: (typeof EMBED_STATES)[keyof typeof EMBED_STATES],
  eventId: number,
): Promise<void> {
  const { embed, row } = deps.embedFactory.buildEventEmbed(eventData, context, {
    state,
  });
  await deps.clientService.editEmbed(
    record.channelId,
    record.messageId,
    embed,
    row,
  );
  await deps.db
    .update(schema.discordEventMessages)
    .set({ updatedAt: new Date() })
    .where(eq(schema.discordEventMessages.id, record.id));
  deps.logger.log(
    `Updated event embed for event ${eventId} (msg: ${record.messageId})`,
  );
}

/** Resolve the voice channel ID for a payload. */
export async function resolveVoiceChannel(
  deps: EventListenerDeps,
  payload: EventPayload,
): Promise<string | null> {
  if (payload.notificationChannelOverride) {
    return payload.notificationChannelOverride;
  }
  return deps.channelResolver.resolveVoiceChannelForScheduledEvent(
    payload.gameId,
    payload.recurrenceGroupId,
  );
}

/** Enrich event data with live roster and voice channel. */
export async function enrichEventData(
  deps: EventListenerDeps,
  payload: import('./event.listener').EventPayload,
): Promise<EmbedEventData> {
  const eventData = await deps.embedPoster.enrichWithLiveRoster(
    payload.eventId,
    payload.event,
  );
  const voiceChannelId = await resolveVoiceChannel(deps, payload);
  if (voiceChannelId) eventData.voiceChannelId = voiceChannelId;
  return eventData;
}

/** Cancel embed: update with cancelled state and mark in DB. */
export async function cancelEmbedRecord(
  deps: EventListenerDeps,
  record: MessageRecord,
  event: EmbedEventData,
  context: EmbedContext,
  eventId: number,
): Promise<void> {
  const { embed } = deps.embedFactory.buildEventCancelled(event, context);
  await deps.clientService.editEmbed(record.channelId, record.messageId, embed);
  await deps.db
    .update(schema.discordEventMessages)
    .set({ embedState: EMBED_STATES.CANCELLED, updatedAt: new Date() })
    .where(eq(schema.discordEventMessages.id, record.id));
  deps.logger.log(
    `Cancelled event embed for event ${eventId} (msg: ${record.messageId})`,
  );
}

/** Delete a Discord message and remove the DB record. */
export async function deleteEmbedRecord(
  deps: EventListenerDeps,
  record: MessageRecord,
  eventId: number,
): Promise<void> {
  await deps.clientService.deleteMessage(record.channelId, record.messageId);
  deps.logger.log(
    `Deleted Discord message for event ${eventId} (msg: ${record.messageId})`,
  );
  await deps.db
    .delete(schema.discordEventMessages)
    .where(eq(schema.discordEventMessages.id, record.id));
}

/** Update embed state for all records of an event. */
export async function updateEmbedStateForRecords(
  deps: EventListenerDeps,
  records: MessageRecord[],
  event: EmbedEventData,
  context: EmbedContext,
  newState: (typeof EMBED_STATES)[keyof typeof EMBED_STATES],
  eventId: number,
): Promise<void> {
  for (const record of records) {
    try {
      await updateSingleEmbedState(
        deps,
        record,
        event,
        context,
        newState,
        eventId,
      );
    } catch (error) {
      deps.logger.error(
        `Failed to update embed state for event ${eventId} (msg: ${record.messageId}):`,
        error,
      );
    }
  }
}

async function updateSingleEmbedState(
  deps: EventListenerDeps,
  record: MessageRecord,
  event: EmbedEventData,
  context: EmbedContext,
  newState: (typeof EMBED_STATES)[keyof typeof EMBED_STATES],
  eventId: number,
): Promise<void> {
  const { embed, row } = deps.embedFactory.buildEventEmbed(event, context, {
    state: newState,
  });
  await deps.clientService.editEmbed(
    record.channelId,
    record.messageId,
    embed,
    row,
  );
  await deps.db
    .update(schema.discordEventMessages)
    .set({ embedState: newState, updatedAt: new Date() })
    .where(eq(schema.discordEventMessages.id, record.id));
  deps.logger.log(
    `Updated embed state for event ${eventId} to ${newState} (msg: ${record.messageId})`,
  );
}
