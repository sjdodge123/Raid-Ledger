/**
 * Recruitment bump reconciliation for the embed-sync job.
 *
 * The "Spots still available" bump (posted by `RecruitmentReminderService`)
 * carries an "N/M spots filled" snapshot. Every embed sync brings it in line
 * with the event, piggybacking the existing job (no timer of its own):
 *
 * - FULL → the bump is deleted and its ids cleared (ROK-728).
 * - otherwise → the card is rebuilt with the SAME builder the reminder used
 *   and edited in place, so its count tracks the event embed (ROK-1812).
 *
 * Nothing here throws: a bump is a side-car to the event embed, and a fault
 * on it must never fail (or retry) the sync. A deleted bump (Discord 10008)
 * clears the stored ids so later syncs stop chasing it.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { isUnknownMessage } from '../discord-bot-client.messages.helpers';
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import type {
  EmbedContext,
  EmbedEventData,
} from '../services/discord-embed.factory';
import {
  buildBumpEmbed,
  type BumpEmbedEvent,
} from '../../notifications/recruitment-reminder.helpers';

type EventMessageRow = typeof schema.discordEventMessages.$inferSelect;

export interface BumpSyncDeps {
  db: PostgresJsDatabase<typeof schema>;
  clientService: Pick<DiscordBotClientService, 'editEmbed' | 'deleteMessage'>;
  logger: { log(message: string): void; warn(message: string): void };
}

export interface BumpSyncInput {
  record: EventMessageRow;
  newState: EmbedState;
  eventData: EmbedEventData;
  context: EmbedContext;
}

/** Delete (FULL) or re-count (any other state) the record's bump. Never throws. */
export async function reconcileBumpMessage(
  deps: BumpSyncDeps,
  input: BumpSyncInput,
): Promise<void> {
  const { record, newState, eventData } = input;
  if (!record.bumpMessageId) return;
  // Legacy rows predating the column fall back to the embed's channel (ROK-1335).
  const channelId = record.bumpChannelId ?? record.channelId;
  const target = { channelId, messageId: record.bumpMessageId };
  if (newState === EMBED_STATES.FULL) {
    await deleteBump(deps, record.id, target, eventData.id);
    return;
  }
  await refreshBumpCount(deps, input, target);
}

interface BumpTarget {
  channelId: string;
  messageId: string;
}

/** ROK-728: the event filled up — the "spots available" card is now wrong. */
async function deleteBump(
  deps: BumpSyncDeps,
  recordId: string,
  target: BumpTarget,
  eventId: number,
): Promise<void> {
  try {
    await deps.clientService.deleteMessage(target.channelId, target.messageId);
    await clearBumpIds(deps.db, recordId);
    deps.logger.log(`Deleted recruitment bump message for event ${eventId}`);
  } catch (err) {
    deps.logger.warn(
      `Failed to delete bump message for event ${eventId} in channel ${target.channelId}: ${errorText(err)}`,
    );
  }
}

/** ROK-1812: rebuild the card with the live count and edit it in place. */
async function refreshBumpCount(
  deps: BumpSyncDeps,
  input: BumpSyncInput,
  target: BumpTarget,
): Promise<void> {
  const bumpEvent = toBumpEvent(input.record, input.eventData);
  const clientUrl = input.context.clientUrl;
  // Without a game or a client URL the reminder could not have built this
  // card either; leave it rather than render a broken one.
  if (!bumpEvent || !clientUrl) return;
  const eventId = input.eventData.id;
  try {
    const { embed, row } = buildBumpEmbed(
      bumpEvent,
      clientUrl,
      input.context.timezone ?? 'UTC',
      input.context.communityName ?? null,
    );
    await deps.clientService.editEmbed(
      target.channelId,
      target.messageId,
      embed,
      row,
    );
  } catch (err) {
    await handleEditFailure(deps, input.record.id, target, eventId, err);
  }
}

/** 10008 → the bump is gone, forget it. Anything else → log and move on. */
async function handleEditFailure(
  deps: BumpSyncDeps,
  recordId: string,
  target: BumpTarget,
  eventId: number,
  err: unknown,
): Promise<void> {
  if (!isUnknownMessage(err)) {
    deps.logger.warn(
      `Failed to refresh bump message for event ${eventId} in channel ${target.channelId}: ${errorText(err)}`,
    );
    return;
  }
  try {
    await clearBumpIds(deps.db, recordId);
    deps.logger.log(
      `Bump message for event ${eventId} no longer exists — cleared its ids`,
    );
  } catch (clearErr) {
    deps.logger.warn(
      `Failed to clear missing bump ids for event ${eventId}: ${errorText(clearErr)}`,
    );
  }
}

/**
 * Project the sync's event data onto the bump card's fields. The count is
 * the event embed's own (`eventData.signupCount`), so the two always agree;
 * the "View in Discord" link points at the tracked embed, as the reminder's did.
 */
function toBumpEvent(
  record: EventMessageRow,
  eventData: EmbedEventData,
): BumpEmbedEvent | null {
  const gameName = eventData.game?.name;
  if (!gameName) return null;
  return {
    id: eventData.id,
    title: eventData.title,
    gameName,
    startTime: eventData.startTime,
    maxAttendees: eventData.maxAttendees ?? null,
    signupCount: eventData.signupCount,
    guildId: record.guildId,
    channelId: record.channelId,
    messageId: record.messageId,
  };
}

async function clearBumpIds(
  db: PostgresJsDatabase<typeof schema>,
  recordId: string,
): Promise<void> {
  await db
    .update(schema.discordEventMessages)
    .set({ bumpMessageId: null, bumpChannelId: null, updatedAt: new Date() })
    .where(eq(schema.discordEventMessages.id, recordId));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown';
}
