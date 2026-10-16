/**
 * Recruitment bump reconciliation for the embed-sync job.
 *
 * The "Spots still available" bump (posted by `RecruitmentReminderService`)
 * carries an "N/M spots filled" snapshot. Every embed sync brings it in line
 * with the event, piggybacking the existing job (no timer of its own):
 *
 * - FULL / CANCELLED / COMPLETED → the bump is deleted and its ids cleared
 *   (ROK-728; a cancelled or finished event has no spots to advertise either).
 * - otherwise → the card is rebuilt with the SAME builder the reminder used
 *   and edited in place, so its count tracks the event embed (ROK-1812).
 *   The edit is skipped when the posted card already reads the same: the
 *   message is fetched anyway (an edit needs it), so comparing against it
 *   costs no extra Discord call and saves the PATCH on every sync that did
 *   not move the count (title edits, role moves, state transitions).
 *
 * Nothing here throws: a bump is a side-car to the event embed, and a fault
 * on it must never fail (or retry) the sync. A deleted bump (Discord 10008)
 * clears the stored ids so later syncs stop chasing it.
 */
import { eq } from 'drizzle-orm';
import type { EmbedBuilder, Message } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import {
  fetchMessageOrNull,
  isUnknownMessage,
} from '../discord-bot-client.messages.helpers';
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
  clientService: Pick<DiscordBotClientService, 'getClient' | 'deleteMessage'>;
  logger: { log(message: string): void; warn(message: string): void };
}

export interface BumpSyncInput {
  record: EventMessageRow;
  newState: EmbedState;
  eventData: EmbedEventData;
  context: EmbedContext;
}

/** States in which a "Spots still available" card is wrong — delete it. */
const BUMP_DELETE_STATES: ReadonlySet<EmbedState> = new Set<EmbedState>([
  EMBED_STATES.FULL,
  EMBED_STATES.CANCELLED,
  EMBED_STATES.COMPLETED,
]);

/** Delete (FULL/CANCELLED/COMPLETED) or re-count the record's bump. Never throws. */
export async function reconcileBumpMessage(
  deps: BumpSyncDeps,
  input: BumpSyncInput,
): Promise<void> {
  const { record, newState, eventData } = input;
  if (!record.bumpMessageId) return;
  // Legacy rows predating the column fall back to the embed's channel (ROK-1335).
  const channelId = record.bumpChannelId ?? record.channelId;
  const target = { channelId, messageId: record.bumpMessageId };
  if (BUMP_DELETE_STATES.has(newState)) {
    await deleteBump(deps, record.id, target, eventData.id);
    return;
  }
  await refreshBumpCount(deps, input, target);
}

interface BumpTarget {
  channelId: string;
  messageId: string;
}

/** ROK-728: the event filled up (or ended) — the "spots available" card is now wrong. */
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
    const message = await fetchMessageOrNull(
      deps.clientService.getClient(),
      target.channelId,
      target.messageId,
    );
    if (!message) {
      await forgetMissingBump(deps, input.record.id, eventId);
      return;
    }
    if (cardUnchanged(message, embed)) return;
    await message.edit({ embeds: [embed], components: [row] });
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
  await forgetMissingBump(deps, recordId, eventId);
}

/** The bump is gone (10008) — clear its ids so later syncs stop chasing it. */
async function forgetMissingBump(
  deps: BumpSyncDeps,
  recordId: string,
  eventId: number,
): Promise<void> {
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
 * Does the posted card already show what we would render? Compares every
 * text slot the builder fills (title, description, fields); the buttons
 * depend only on ids and the client URL, never on the count.
 */
function cardUnchanged(message: Message, embed: EmbedBuilder): boolean {
  const current = message.embeds[0];
  if (!current) return false;
  const next = embed.data;
  return (
    current.title === (next.title ?? null) &&
    current.description === (next.description ?? null) &&
    fieldsKey(current.fields) === fieldsKey(next.fields ?? [])
  );
}

function fieldsKey(fields: readonly { name: string; value: string }[]): string {
  return JSON.stringify(fields.map((f) => [f.name, f.value]));
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
