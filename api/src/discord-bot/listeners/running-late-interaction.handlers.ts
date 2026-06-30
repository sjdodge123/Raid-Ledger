import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from 'discord.js';
import type { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { RunningLateService } from '../../events/running-late.service';
import type { EventsService } from '../../events/events.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type {
  DiscordEmbedFactory,
  EmbedContext,
  EmbedEventData,
} from '../services/discord-embed.factory';
import type { SettingsService } from '../../settings/settings.service';
import { RUNNING_LATE_BUTTON_IDS } from '../discord-bot.constants';
import type { EmbedState } from '../discord-bot.constants';
import { findLinkedUser } from './signup-interaction.helpers';

/** Dependencies for the running-late interaction handlers (ROK-1379). */
export interface RunningLateDeps {
  db: PostgresJsDatabase<typeof schema>;
  clientService: DiscordBotClientService;
  runningLateService: RunningLateService;
  eventsService: EventsService;
  embedFactory: DiscordEmbedFactory;
  settingsService: SettingsService;
  logger: Logger;
}

/** Minimal event shape used by the running-late flow. */
export interface RunningLateEvent {
  id: number;
  title: string;
  cancelledAt: Date | null;
  duration: Date[];
  creatorId: number;
}

/** Parsed custom-id for a running-late button. */
export interface RunningLateButtonParsed {
  action: string;
  eventId: number;
  minutes?: number;
}

/** Anti-spam cooldown for the marker buttons, keyed `{action}:{userId}:{eventId}`. */
const lateCooldowns = new Map<string, number>();

/** Cooldown window (ms) between repeated marker presses per user per event. */
export const LATE_COOLDOWN_MS = 3000;

/**
 * Returns true if the marker action is still cooling down (and the press
 * should be ignored); otherwise records the press and returns false.
 */
export function checkLateCooldown(key: string): boolean {
  const now = Date.now();
  const last = lateCooldowns.get(key);
  if (last !== undefined && now - last < LATE_COOLDOWN_MS) return true;
  lateCooldowns.set(key, now);
  return false;
}

/** @internal Exposed for testing only — clears the cooldown map. */
export function _resetLateCooldowns(): void {
  lateCooldowns.clear();
}

/** Parse `{action}:{eventId}[:{minutes}]`, claiming only `event_late*` ids. */
export function parseRunningLateButton(
  customId: string,
): RunningLateButtonParsed | null {
  const parts = customId.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const [action, eventIdStr, minutesStr] = parts;
  if (!isRunningLateAction(action)) return null;
  const eventId = parseInt(eventIdStr, 10);
  if (isNaN(eventId)) return null;
  if (action === RUNNING_LATE_BUTTON_IDS.DELAY) {
    if (parts.length !== 3) return null;
    const minutes = parseInt(minutesStr, 10);
    if (isNaN(minutes)) return null;
    return { action, eventId, minutes };
  }
  if (parts.length !== 2) return null;
  return { action, eventId };
}

function isRunningLateAction(action: string): boolean {
  return (
    action === RUNNING_LATE_BUTTON_IDS.LATE ||
    action === RUNNING_LATE_BUTTON_IDS.HERE ||
    action === RUNNING_LATE_BUTTON_IDS.DELAY ||
    action === RUNNING_LATE_BUTTON_IDS.DELAY_CANCEL
  );
}

/** Look up the event for the running-late flow. */
export async function lookupEvent(
  deps: RunningLateDeps,
  eventId: number,
): Promise<RunningLateEvent | null> {
  const [event] = await deps.db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      cancelledAt: schema.events.cancelledAt,
      duration: schema.events.duration,
      creatorId: schema.events.creatorId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
}

/** True when the user has a signup row for the event. */
export async function userHasSignup(
  deps: RunningLateDeps,
  eventId: number,
  userId: number,
): Promise<boolean> {
  const [row] = await deps.db
    .select({ id: schema.eventSignups.id })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .limit(1);
  return !!row;
}

/** Build the host "Delay the event?" prompt row (+15 / +30 / Cancel). */
export function buildDelayRow(
  eventId: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RUNNING_LATE_BUTTON_IDS.DELAY}:${eventId}:15`)
      .setLabel('+15 min')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${RUNNING_LATE_BUTTON_IDS.DELAY}:${eventId}:30`)
      .setLabel('+30 min')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${RUNNING_LATE_BUTTON_IDS.DELAY_CANCEL}:${eventId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Re-render channel embeds after a late/clear/delay change. */
export async function updateChannelEmbeds(
  deps: RunningLateDeps,
  eventId: number,
): Promise<void> {
  try {
    const records = await findGuildEmbedRecords(deps, eventId);
    if (!records || records.length === 0) return;
    const eventData = await deps.eventsService.buildEmbedEventData(eventId);
    const context = await buildEmbedContext(deps);
    for (const record of records) {
      await rerenderRecord(deps, record, eventData, context, eventId);
    }
  } catch (error) {
    deps.logger.error(
      'Failed to update channel embeds for event %d:',
      eventId,
      error,
    );
  }
}

async function findGuildEmbedRecords(
  deps: RunningLateDeps,
  eventId: number,
): Promise<(typeof schema.discordEventMessages.$inferSelect)[] | null> {
  const guildId = deps.clientService.getGuildId();
  if (!guildId) return null;
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

async function buildEmbedContext(deps: RunningLateDeps): Promise<EmbedContext> {
  const [branding, timezone] = await Promise.all([
    deps.settingsService.getBranding(),
    deps.settingsService.getDefaultTimezone(),
  ]);
  return {
    communityName: branding.communityName,
    clientUrl: process.env.CLIENT_URL ?? null,
    timezone,
  };
}

async function rerenderRecord(
  deps: RunningLateDeps,
  record: typeof schema.discordEventMessages.$inferSelect,
  eventData: EmbedEventData,
  context: EmbedContext,
  eventId: number,
): Promise<void> {
  try {
    const state = record.embedState as EmbedState;
    const { embed, row } = deps.embedFactory.buildEventEmbed(
      eventData,
      context,
      {
        state,
      },
    );
    await deps.clientService.editEmbed(
      record.channelId,
      record.messageId,
      embed,
      row,
    );
  } catch (err) {
    deps.logger.warn(
      'Failed to update embed message %s for event %d: %s',
      record.messageId,
      eventId,
      err instanceof Error ? err.message : 'Unknown',
    );
  }
}

/** Safely edit a deferred/replied interaction, swallowing Discord ack races. */
export async function safeEditReply(
  interaction: ButtonInteraction,
  options: Parameters<ButtonInteraction['editReply']>[0],
  logger: Logger,
): Promise<void> {
  try {
    await interaction.editReply(options);
  } catch (error: unknown) {
    if (isDiscordInteractionError(error)) {
      logger.warn(
        'Interaction editReply failed (code %d): %s',
        (error as { code: number }).code,
        (error as Error).message,
      );
      return;
    }
    throw error;
  }
}

/** Code 40060 = already acknowledged, 10062 = expired token. */
export function isDiscordInteractionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code: number }).code === 40060 ||
      (error as { code: number }).code === 10062)
  );
}

/**
 * Auto-clears a user's running-late flag when they join an event's ephemeral
 * voice channel (ROK-1379 AC3). Best-effort — never throws into the voice
 * listener. Matches the per-event channel via `events.ephemeral_voice_channel_id`
 * (the per-event voice channel created by ROK-1352); the manual "I'm here now"
 * button covers any event on a shared/default channel.
 */
export async function clearRunningLateOnVoiceJoin(
  deps: RunningLateDeps,
  discordUserId: string,
  channelId: string,
): Promise<void> {
  try {
    const user = await findLinkedUser(discordUserId, { db: deps.db });
    if (!user) return;
    const events = await deps.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.ephemeralVoiceChannelId, channelId));
    for (const ev of events) {
      const cleared = await deps.runningLateService.clearRunningLate(
        ev.id,
        user.id,
      );
      if (cleared) await updateChannelEmbeds(deps, ev.id);
    }
  } catch (error) {
    deps.logger.warn(
      'Voice-join running-late auto-clear failed: %s',
      error instanceof Error ? error.message : String(error),
    );
  }
}
