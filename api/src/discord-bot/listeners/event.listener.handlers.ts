import type { Logger } from '@nestjs/common';
import { EmbedBuilder } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type {
  DiscordEmbedFactory,
  EmbedEventData,
  EmbedContext,
} from '../services/discord-embed.factory';
import type { EventEmbedMessageEditor } from '../services/event-embed-message.editor';
import type { EmbedPosterService } from '../services/embed-poster.service';
import type { ChannelResolverService } from '../services/channel-resolver.service';
import type { ScheduledEventService } from '../services/scheduled-event.service';
import { getEphemeralVoiceState } from '../services/ephemeral-voice.db-helpers';
import { applyEmbedVoice } from '../services/embed-voice.helpers';
import {
  findAnnouncementMessage,
  isForumStarterRow,
} from '../services/event-message-rows.helpers';
import type { PlannedVoiceSettingsSource } from '../services/planned-ephemeral-voice.helpers';
import { EMBED_STATES } from '../discord-bot.constants';
import { createChannelEmbed } from '../embeds/embed-chrome.helpers';
import { deleteRecordBump } from '../processors/embed-sync-bump.helpers';
import type { EventPayload } from './event.listener';

/** Dependencies for event listener handlers. */
export interface EventListenerDeps {
  db: PostgresJsDatabase<typeof schema>;
  clientService: DiscordBotClientService;
  embedFactory: DiscordEmbedFactory;
  embedPoster: EmbedPosterService;
  channelResolver: ChannelResolverService;
  /** Planned temporary voice channel settings (2026-11-13). */
  settings: PlannedVoiceSettingsSource;
  /** ROK-2292 D4: routes announcement vs forum-starter rows. */
  messageEditor: Pick<EventEmbedMessageEditor, 'edit'>;
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

/**
 * Codex P2: whether the event still lacks its channel announcement. A forum
 * post's starter row (ROK-2292) is not an announcement, so it must not stop
 * `event.updated` from posting the missing one.
 */
export function lacksAnnouncement(records: readonly MessageRecord[]): boolean {
  return records.every((record) => isForumStarterRow(record));
}

/** Look up the Discord message record for game affinity notifications. */
export async function findDiscordMessageRecord(
  deps: EventListenerDeps,
  eventId: number,
): Promise<{ guildId: string; channelId: string; messageId: string } | null> {
  return findAnnouncementMessage(deps.db, eventId);
}

/** Fetch the event's current reschedulingPollId (ROK-1370). */
export async function getReschedulingPollId(
  deps: EventListenerDeps,
  eventId: number,
): Promise<number | null> {
  const [row] = await deps.db
    .select({ reschedulingPollId: schema.events.reschedulingPollId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row?.reschedulingPollId ?? null;
}

/**
 * ROK-1766: whether an event is ad-hoc (Quick Play). Its card is owned by
 * `AdHocNotificationService`; the scheduled builders here would revert it.
 * Bind/unbind UPDATED payloads leave `isAdHoc` unset, so the flag is read
 * from the DB. A missing row reads as "not ad-hoc" (nothing to protect).
 */
export async function isAdHocEvent(
  deps: EventListenerDeps,
  eventId: number,
): Promise<boolean> {
  const [row] = await deps.db
    .select({ isAdHoc: schema.events.isAdHoc })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row?.isAdHoc === true;
}

/**
 * Resolve the embed state to render on an `event.updated` re-render (ROK-1370).
 * While a reschedule poll is open the embed must stay RESCHEDULING regardless
 * of its stored state; once the poll clears, a stuck RESCHEDULING record is
 * reset to POSTED so the event re-appears live. Any other state passes through.
 */
export function resolveEmbedStateForUpdate(
  recordState: string,
  isRescheduling: boolean,
): (typeof EMBED_STATES)[keyof typeof EMBED_STATES] {
  if (isRescheduling) return EMBED_STATES.RESCHEDULING;
  if (recordState === EMBED_STATES.RESCHEDULING) return EMBED_STATES.POSTED;
  return recordState as (typeof EMBED_STATES)[keyof typeof EMBED_STATES];
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
  const built = deps.embedFactory.buildEventEmbed(eventData, context, {
    state,
  });
  await deps.messageEditor.edit(record, built, { withContent: true });
  // ROK-1370: persist the resolved state so a RESCHEDULING↔POSTED transition
  // sticks across re-renders (a no-op when state matches the stored value).
  await deps.db
    .update(schema.discordEventMessages)
    .set({ embedState: state, updatedAt: new Date() })
    .where(eq(schema.discordEventMessages.id, record.id));
  deps.logger.log(
    `Updated event embed for event ${eventId} (msg: ${record.messageId})`,
  );
}

/**
 * Re-render every embed record for an `event.updated`, honoring rescheduling
 * state (ROK-1370). Extracted from DiscordEventListener to keep it under the
 * 300-line limit.
 */
export async function applyEmbedUpdates(
  deps: EventListenerDeps,
  records: MessageRecord[],
  eventData: EmbedEventData,
  context: EmbedContext,
  isRescheduling: boolean,
  eventId: number,
): Promise<void> {
  for (const record of records) {
    try {
      const state = resolveEmbedStateForUpdate(
        record.embedState,
        isRescheduling,
      );
      await updateEmbedRecord(deps, record, eventData, context, state, eventId);
    } catch (error) {
      deps.logger.error(`Failed to update embed for event ${eventId}:`, error);
    }
  }
}

/**
 * Enrich event data with live roster and voice. The voice side is the shared
 * embed decision (`applyEmbedVoice`), so an edit before the temporary channel
 * exists keeps the planned line instead of linking the default room; a live
 * ephemeral channel still wins (ROK-1352) and a text override never does.
 */
export async function enrichEventData(
  deps: EventListenerDeps,
  payload: EventPayload,
): Promise<EmbedEventData> {
  const eventData = await deps.embedPoster.enrichWithLiveRoster(
    payload.eventId,
    payload.event,
  );
  const ephemeral = await getEphemeralVoiceState(deps.db, payload.eventId);
  await applyEmbedVoice(deps, eventData, {
    gameId: payload.gameId,
    recurrenceGroupId: payload.recurrenceGroupId,
    notificationChannelOverride: payload.notificationChannelOverride,
    ephemeral,
  });
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
  try {
    // A cancelled card carries no buttons on either row kind (pre-ROK-2292
    // announcement behaviour), whatever rows the factory would attach.
    const { embed, content } = deps.embedFactory.buildEventCancelled(
      event,
      context,
    );
    const card = content ? { embed, content } : { embed };
    const edit = await deps.messageEditor.edit(record, card, {
      withContent: true,
    });
    if (edit === 'gone') return;
    await deps.db
      .update(schema.discordEventMessages)
      .set({ embedState: EMBED_STATES.CANCELLED, updatedAt: new Date() })
      .where(eq(schema.discordEventMessages.id, record.id));
    deps.logger.log(
      `Cancelled event embed for event ${eventId} (msg: ${record.messageId})`,
    );
  } finally {
    // ROK-1812: the embed sync skips cancelled events, so this is the only
    // place a cancel can take down the "Spots still available" card — even
    // when the embed edit above fails (Codex r3): a cancelled event must not
    // keep advertising spots. deleteRecordBump never throws.
    await deleteRecordBump(deps, record, eventId);
  }
}

/** The button-free card a deleted event's forum post is left showing. */
export function removedStarterEmbed(): EmbedBuilder {
  return createChannelEmbed({ state: EMBED_STATES.CANCELLED, timestamp: false })
    .setTitle('Event removed')
    .setDescription('This event was deleted. Signups are closed.');
}

/**
 * Delete a Discord message and remove the DB record. A forum post's starter
 * row (ROK-2292) is never deleted on Discord (that would delete the whole
 * post; the forum lifecycle closes it): its card is edited to a button-free
 * "removed" card first so nobody signs up to a deleted event.
 */
export async function deleteEmbedRecord(
  deps: EventListenerDeps,
  record: MessageRecord,
  eventId: number,
): Promise<void> {
  if (isForumStarterRow(record)) {
    await retireStarterCard(deps, record, eventId);
  } else {
    await deps.clientService.deleteMessage(record.channelId, record.messageId);
    deps.logger.log(
      `Deleted Discord message for event ${eventId} (msg: ${record.messageId})`,
    );
  }
  await deps.db
    .delete(schema.discordEventMessages)
    .where(eq(schema.discordEventMessages.id, record.id));
}

/** Best effort: a failed edit is logged and the row is still dropped. */
async function retireStarterCard(
  deps: EventListenerDeps,
  record: MessageRecord,
  eventId: number,
): Promise<void> {
  try {
    await deps.messageEditor.edit(record, { embed: removedStarterEmbed() });
  } catch (error) {
    deps.logger.warn(
      `Failed to retire forum starter for deleted event ${eventId}: ${String(error)}`,
    );
  }
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
  const built = deps.embedFactory.buildEventEmbed(event, context, {
    state: newState,
  });
  await deps.messageEditor.edit(record, built, { withContent: true });
  await deps.db
    .update(schema.discordEventMessages)
    .set({ embedState: newState, updatedAt: new Date() })
    .where(eq(schema.discordEventMessages.id, record.id));
  deps.logger.log(
    `Updated embed state for event ${eventId} to ${newState} (msg: ${record.messageId})`,
  );
}

/**
 * Fire-and-forget Discord Scheduled Event sync for an updated event; a failure
 * is only logged. Moved out of the listener (ROK-2201) to keep it under the
 * file-size limit.
 */
export function fireScheduledEventUpdate(
  scheduledEvents: Pick<ScheduledEventService, 'updateScheduledEvent'>,
  logger: Logger,
  payload: EventPayload,
): void {
  scheduledEvents
    .updateScheduledEvent(
      payload.eventId,
      payload.event,
      payload.gameId,
      payload.isAdHoc,
    )
    .catch((err: unknown) => {
      logger.warn(
        `Failed to update scheduled event for ${payload.eventId}: ${String(err)}`,
      );
    });
}
